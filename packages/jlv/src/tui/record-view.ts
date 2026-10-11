// The order in which the main panel shows the records of the store (plan section 6.1). The view filters and sorts
// the retained records once per pair of the store's data revision and the query's revision, and never on cursor
// moves or renders. While records arrive, it only looks at the new ones: it drops the evicted records from its order,
// sorts the new records that pass the filter and merges them in.
//
// Orders, each ascending or descending:
// - arrival: the order in which the records arrived; follow and live input show it by default.
// - time: the store's time key of each record, epoch milliseconds or NaN; finite files show it descending.
// - field: any other field of the legacy row, compared as lodash.sortBy did.
// Records without a value for the order (a missing or invalid time, an undefined or null field) come after all others
// in both directions, and records with equal values keep their arrival order in both directions.
import type { LogEntry } from '../log.js'
import type { RecordStore } from '../store.js'
import { compareAscending } from './row-order.js'

type ViewOrder =
  | { readonly kind: 'arrival' | 'time', readonly isDescending: boolean }
  | { readonly kind: 'field', readonly isDescending: boolean, readonly read: (entry: LogEntry) => unknown }

interface ViewQuery {
  // Changes whenever the order or the filter changes.
  readonly revision: number
  readonly order: ViewOrder
  // Keeps a record in the view; undefined keeps all records.
  readonly isKept: ((entry: LogEntry) => boolean) | undefined
}

// A value that sorts after all others in both directions.
const isMissing = (value: unknown): boolean => value === undefined || value === null || Number.isNaN(value)

// Missing values last, then the direction. The caller breaks ties by arrival order.
const compareValues = (left: unknown, right: unknown, isDescending: boolean): number => {
  const isLeftMissing = isMissing(left)
  const isRightMissing = isMissing(right)
  if (isLeftMissing || isRightMissing) {
    return Number(isLeftMissing) - Number(isRightMissing)
  }
  const ascending = compareAscending(left, right)
  return isDescending ? -ascending : ascending
}

// The same for time keys, which are numbers or NaN.
const compareTimes = (left: number, right: number, isDescending: boolean): number => {
  const isLeftMissing = Number.isNaN(left)
  const isRightMissing = Number.isNaN(right)
  if (isLeftMissing || isRightMissing) {
    return Number(isLeftMissing) - Number(isRightMissing)
  }
  return isDescending ? right - left : left - right
}

class RecordView {
  readonly #parse: (text: string) => LogEntry
  #order: readonly number[] = []
  // The field values of the records in the order, for a field order.
  #values = new Map<number, unknown>()
  // The records below this sequence have been looked at for the current query.
  #evaluatedEnd = 0
  #dataRevision = -1
  #queryRevision = -1
  readonly store: RecordStore
  // How often the order was computed, once per pair of revisions.
  computations = 0

  constructor (store: RecordStore, parse: (text: string) => LogEntry) {
    this.store = store
    this.#parse = parse
  }

  #compare (order: ViewOrder, left: number, right: number): number {
    switch (order.kind) {
      case 'arrival': {
        return order.isDescending ? right - left : left - right
      }
      case 'time': {
        return compareTimes(this.store.timeAt(left), this.store.timeAt(right), order.isDescending) || left - right
      }
      case 'field': {
        return compareValues(this.#values.get(left), this.#values.get(right), order.isDescending) || left - right
      }
    }
  }

  // Merges the sorted new records into the order. Ties cannot occur, since every comparison ends with the sequence.
  #merge (sorted: readonly number[], added: readonly number[], order: ViewOrder): readonly number[] {
    if (added.length === 0) {
      return sorted
    }
    if (sorted.length === 0) {
      return added
    }
    const merged: number[] = []
    let left = 0
    let right = 0
    while (left < sorted.length && right < added.length) {
      const leftSequence = sorted[left] ?? 0
      const rightSequence = added[right] ?? 0
      if (this.#compare(order, leftSequence, rightSequence) <= 0) {
        merged.push(leftSequence)
        left += 1
      } else {
        merged.push(rightSequence)
        right += 1
      }
    }
    return [...merged, ...sorted.slice(left), ...added.slice(right)]
  }

  // Whether the next call of order() computes the order again.
  isStale (query: ViewQuery): boolean {
    return this.#dataRevision !== this.store.dataRevision || this.#queryRevision !== query.revision
  }

  // The parsed row of a retained record.
  entry (sequence: number): LogEntry {
    return this.#parse(this.store.textAt(sequence))
  }

  // The sequences of the records to show, in order.
  order (query: ViewQuery): readonly number[] {
    if (!this.isStale(query)) {
      return this.#order
    }
    const { store } = this
    if (this.#queryRevision !== query.revision) {
      this.#order = []
      this.#values.clear()
      this.#evaluatedEnd = store.firstSequence
    }
    const { firstSequence } = store
    if (this.#order.some(sequence => sequence < firstSequence)) {
      this.#order = this.#order.filter(sequence => sequence >= firstSequence)
      for (const sequence of this.#values.keys()) {
        if (sequence >= firstSequence) {
          break
        }
        this.#values.delete(sequence)
      }
    }
    const added: number[] = []
    const { order, isKept } = query
    for (let sequence = Math.max(this.#evaluatedEnd, firstSequence); sequence < store.endSequence; sequence += 1) {
      const entry = isKept !== undefined || order.kind === 'field' ? this.entry(sequence) : undefined
      if (entry !== undefined && isKept !== undefined && !isKept(entry)) {
        continue
      }
      if (entry !== undefined && order.kind === 'field') {
        this.#values.set(sequence, order.read(entry))
      }
      added.push(sequence)
    }
    this.#evaluatedEnd = store.endSequence
    this.#order = this.#merge(this.#order, added.toSorted((left, right) => this.#compare(order, left, right)), order)
    this.#dataRevision = store.dataRevision
    this.#queryRevision = query.revision
    this.computations += 1
    return this.#order
  }
}

export { RecordView, compareValues }
export type { ViewOrder, ViewQuery }
