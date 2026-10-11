// The visible order of src/tui/record-view.ts: arrival, time and field orders in both directions, missing values
// last, ties in arrival order, filters, eviction, and the incremental merge that runs once per revision.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fieldReader } from '../src/field-path.js'
import { parseEntry, timeKey, type LogEntry } from '../src/log.js'
import { RecordStore } from '../src/store.js'
import { RecordView, type ViewOrder, type ViewQuery } from '../src/tui/record-view.js'

const viewOf = (store: RecordStore): RecordView => new RecordView(store, text => parseEntry(text, undefined))

// Appends records as the ingestion does: the record's text, its time key, its source and record number.
const append = (store: RecordStore, source: number, records: readonly object[]): void => {
  for (const record of records) {
    const recordNumber = store.seen + 1
    store.append({ source, recordNumber, bytes: Buffer.from(JSON.stringify(record)), time: timeKey(record), level: 6, firstLine: 1, lastLine: 1 })
  }
}

const query = (order: ViewOrder, isKept?: (entry: LogEntry) => boolean, revision = 0): ViewQuery => ({ revision, order, isKept })

// The messages of the visible records in the order of the query.
const messages = (view: RecordView, viewQuery: ViewQuery): unknown[] => view.order(viewQuery).map(sequence => view.entry(sequence).message)

const timed = (minute: number, message: string, level?: string): object =>
  ({ timestamp: `2026-10-11T10:${String(minute).padStart(2, '0')}:00.000Z`, ...(level !== undefined && { level }), message })

const isNoDebug = (entry: LogEntry): boolean => entry.level !== 'debug'

describe('record view', () => {
  it('shows records in arrival order in both directions', () => {
    const store = new RecordStore()
    append(store, 0, [timed(2, 'a'), timed(1, 'b'), timed(3, 'c')])
    const view = viewOf(store)
    assert.deepEqual(messages(view, query({ kind: 'arrival', isDescending: false })), ['a', 'b', 'c'])
    assert.deepEqual(messages(view, query({ kind: 'arrival', isDescending: true }, undefined, 1)), ['c', 'b', 'a'])
  })

  it('orders by time with missing and invalid times last in both directions and ties in arrival order', () => {
    const store = new RecordStore()
    append(store, 0, [
      timed(2, 'two'), { message: 'none' }, timed(1, 'one'), { timestamp: '2017-12-06 09:23:42.253060', message: 'naive' },
      timed(2, 'two again'), { timestamp: 1_791_712_920_000, message: 'epoch 10:02' }, timed(3, 'three')
    ])
    const view = viewOf(store)
    assert.deepEqual(messages(view, query({ kind: 'time', isDescending: true })),
      ['three', 'two', 'two again', 'epoch 10:02', 'one', 'none', 'naive'])
    assert.deepEqual(messages(view, query({ kind: 'time', isDescending: false }, undefined, 1)),
      ['one', 'two', 'two again', 'epoch 10:02', 'three', 'none', 'naive'])
  })

  it('orders by a field with missing values last in both directions and ties in arrival order', () => {
    const store = new RecordStore()
    append(store, 0, [timed(1, 'a', 'warn'), timed(2, 'b'), timed(3, 'c', 'debug'), timed(4, 'd', 'warn'), { level: null, message: 'e' }])
    const view = viewOf(store)
    const read = fieldReader('level')
    assert.deepEqual(messages(view, query({ kind: 'field', isDescending: false, read })), ['c', 'a', 'd', 'b', 'e'])
    assert.deepEqual(messages(view, query({ kind: 'field', isDescending: true, read }, undefined, 1)), ['a', 'd', 'c', 'b', 'e'])
  })

  it('merges two sources by time within the retained records', () => {
    const store = new RecordStore({ maximumRecords: 5 })
    append(store, 0, [timed(0, 'a0'), timed(2, 'a2'), timed(4, 'a4'), timed(6, 'a6')])
    append(store, 1, [timed(1, 'b1'), timed(3, 'b3'), timed(5, 'b5'), timed(7, 'b7')])
    const view = viewOf(store)
    // The store keeps the last five records it received, not the five newest times.
    assert.deepEqual(messages(view, query({ kind: 'time', isDescending: true })), ['b7', 'a6', 'b5', 'b3', 'b1'])
    assert.deepEqual([store.seen, store.retained, store.evicted], [8, 5, 3])
  })

  it('keeps only the records that pass the filter', () => {
    const store = new RecordStore()
    append(store, 0, [timed(1, 'a', 'warn'), timed(2, 'b', 'info'), timed(3, 'c', 'warn')])
    const view = viewOf(store)
    assert.deepEqual(messages(view, query({ kind: 'time', isDescending: true }, entry => entry.level === 'warn')), ['c', 'a'])
  })

  it('computes the order once per revision of the data or the query', () => {
    const store = new RecordStore()
    append(store, 0, [timed(1, 'a')])
    const view = viewOf(store)
    const first = query({ kind: 'time', isDescending: true })
    view.order(first)
    view.order(first)
    assert.equal(view.computations, 1)
    append(store, 0, [timed(2, 'b')])
    assert.equal(view.isStale(first), true)
    assert.deepEqual(messages(view, first), ['b', 'a'])
    view.order(first)
    assert.equal(view.computations, 2)
    view.order(query({ kind: 'arrival', isDescending: false }, undefined, 1))
    assert.equal(view.computations, 3)
  })

  it('drops evicted records and merges new ones into the same order as a full sort', () => {
    const store = new RecordStore({ maximumRecords: 40 })
    const view = viewOf(store)
    const orders: readonly ViewOrder[] = [
      { kind: 'time', isDescending: true },
      { kind: 'time', isDescending: false },
      { kind: 'field', isDescending: true, read: fieldReader('level') },
      { kind: 'arrival', isDescending: true }
    ]
    const levels = ['debug', 'info', 'warn', undefined, 'error']
    let state = 7
    const next = (modulo: number): number => {
      state = (state * 48_271) % 2_147_483_647
      return state % modulo
    }
    for (const [revision, order] of orders.entries()) {
      for (let round = 0; round < 30; round += 1) {
        const records = Array.from({ length: 1 + next(7) }, () => {
          const minute = next(5)
          return minute === 0 ? { level: levels[next(5)], message: 'no time' } : timed(minute, `m${String(next(1000))}`, levels[next(5)])
        })
        append(store, next(2), records)
        const incremental = view.order(query(order, isNoDebug, revision))
        const fresh = viewOf(store).order(query(order, isNoDebug, revision))
        assert.deepEqual(incremental, fresh, `order ${String(revision)}, round ${String(round)}`)
        assert.ok(incremental.every(sequence => store.has(sequence)))
      }
    }
  })
})
