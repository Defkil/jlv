// The records that the viewer keeps (plan sections 6.1 and 0.9): the last ingested records under a count and a byte
// limit, 50,000 records and 64 MiB by default. A record's JSON text lives in one byte arena outside the JavaScript
// heap, a ring buffer that grows up to the byte limit; typed arrays hold its place, its normalized time and level,
// its source, record number and lines. Only what the viewer shows is parsed and normalized again. Retaining parsed records instead peaked above the 256 MiB target of
// the phase 0 benchmark, because the collector keeps evicted records around; the arena stays far below it.
//
// Records get sequence numbers in arrival order. The store keeps a contiguous range of them: appending beyond a
// limit evicts the oldest records. Every append changes dataRevision, so a view recomputes its order once per
// revision and never on cursor moves.

import type { RecordPosition } from './api.js'

const defaultMaximumRecords = 50_000
const defaultMaximumBytes = 64 * 1024 * 1024

// The first sizes of the arena and of the slot arrays; both double as needed, up to the limits.
const initialArenaBytes = 256 * 1024
const initialSlots = 1024

interface StoreLimits {
  readonly maximumRecords?: number | undefined
  readonly maximumBytes?: number | undefined
}

interface StoredRecord {
  // The position of the source among the inputs, from 0.
  readonly source: number
  // The number of the record within its source, from 1; it goes on across file replacements.
  readonly recordNumber: number
  // The record's JSON text as UTF-8, which the store copies.
  readonly bytes: Uint8Array
  // The record's normalized time in epoch milliseconds, NaN without a valid time.
  readonly time: number
  // The severity of the record's normalized level, from 0 for trace to 6 for unknown.
  readonly level: number
  // The first and the last line of the record in its file.
  readonly firstLine: number
  readonly lastLine: number
}

const checkLimit = (name: string, value: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`The ${name} must be a positive integer up to ${String(maximum)}, not ${String(value)}.`)
  }
  return value
}

// The identifier of a record (plan section 5): its source's identifier, which is the source's position from 1, and
// its record number.
const recordIdentifier = (source: number, recordNumber: number): string => `${String(source + 1)}:${String(recordNumber)}`

class RecordStore {
  #arena: Buffer
  // Where the next record goes: the end of the newest record.
  #head = 0
  // While the newest records have wrapped around to the start of the arena, the sequence of the first of them.
  #wrapSequence: number | undefined
  #slots: number
  #offsets: Float64Array
  #lengths: Uint32Array
  #times: Float64Array
  #sources: Uint32Array
  #recordNumbers: Float64Array
  #levels: Uint8Array
  #firstLines: Float64Array
  #lastLines: Float64Array
  #firstSequence = 0
  #endSequence = 0
  readonly maximumRecords: number
  readonly maximumBytes: number
  // Records appended, records no longer retained, and the bytes of the retained ones.
  seen = 0
  evicted = 0
  retainedBytes = 0
  dataRevision = 0

  constructor (limits: StoreLimits = {}) {
    this.maximumRecords = checkLimit('record limit', limits.maximumRecords ?? defaultMaximumRecords, 2 ** 32 - 1)
    this.maximumBytes = checkLimit('byte limit', limits.maximumBytes ?? defaultMaximumBytes, 2 ** 32 - 1)
    this.#arena = Buffer.allocUnsafeSlow(Math.min(initialArenaBytes, this.maximumBytes))
    this.#slots = Math.min(initialSlots, this.maximumRecords)
    this.#offsets = new Float64Array(this.#slots)
    this.#lengths = new Uint32Array(this.#slots)
    this.#times = new Float64Array(this.#slots)
    this.#sources = new Uint32Array(this.#slots)
    this.#recordNumbers = new Float64Array(this.#slots)
    this.#levels = new Uint8Array(this.#slots)
    this.#firstLines = new Float64Array(this.#slots)
    this.#lastLines = new Float64Array(this.#slots)
  }

  #slot (sequence: number): number {
    return sequence % this.#slots
  }

  #check (sequence: number): number {
    if (!this.has(sequence)) {
      throw new RangeError(`The store does not retain record ${String(sequence)}.`)
    }
    return this.#slot(sequence)
  }

  #evictOldest (): void {
    const slot = this.#slot(this.#firstSequence)
    this.retainedBytes -= this.#lengths[slot] ?? 0
    this.#firstSequence += 1
    this.evicted += 1
    if (this.retained === 0) {
      this.#head = 0
      this.#wrapSequence = undefined
    } else if (this.#firstSequence === this.#wrapSequence) {
      // The records at the end of the arena are gone; the rest starts at its beginning.
      this.#wrapSequence = undefined
    }
  }

  // The offset for a record of the given size, or undefined while the retained records leave no room for it.
  #place (length: number): number | undefined {
    if (this.retained === 0) {
      return length <= this.#arena.length ? 0 : undefined
    }
    const tail = this.#offsets[this.#slot(this.#firstSequence)] ?? 0
    if (this.#wrapSequence !== undefined) {
      return this.#head + length <= tail ? this.#head : undefined
    }
    if (this.#head + length <= this.#arena.length) {
      return this.#head
    }
    if (length <= tail) {
      this.#wrapSequence = this.#endSequence
      return 0
    }
    return undefined
  }

  // Moves the retained records, in order, to the start of a larger arena.
  #growArena (length: number): void {
    const size = Math.min(this.maximumBytes, Math.max(this.#arena.length * 2, this.retainedBytes + length))
    const arena = Buffer.allocUnsafeSlow(size)
    let offset = 0
    for (let sequence = this.#firstSequence; sequence < this.#endSequence; sequence += 1) {
      const slot = this.#slot(sequence)
      const start = this.#offsets[slot] ?? 0
      const recordLength = this.#lengths[slot] ?? 0
      this.#arena.copy(arena, offset, start, start + recordLength)
      this.#offsets[slot] = offset
      offset += recordLength
    }
    this.#arena = arena
    this.#head = offset
    this.#wrapSequence = undefined
  }

  // Moves the slots of the retained records into arrays of twice the size.
  #growSlots (): void {
    const slots = Math.min(this.maximumRecords, this.#slots * 2)
    const offsets = new Float64Array(slots)
    const lengths = new Uint32Array(slots)
    const times = new Float64Array(slots)
    const sources = new Uint32Array(slots)
    const recordNumbers = new Float64Array(slots)
    const levels = new Uint8Array(slots)
    const firstLines = new Float64Array(slots)
    const lastLines = new Float64Array(slots)
    for (let sequence = this.#firstSequence; sequence < this.#endSequence; sequence += 1) {
      const from = this.#slot(sequence)
      const to = sequence % slots
      offsets[to] = this.#offsets[from] ?? 0
      lengths[to] = this.#lengths[from] ?? 0
      times[to] = this.#times[from] ?? NaN
      sources[to] = this.#sources[from] ?? 0
      recordNumbers[to] = this.#recordNumbers[from] ?? 0
      levels[to] = this.#levels[from] ?? 0
      firstLines[to] = this.#firstLines[from] ?? 0
      lastLines[to] = this.#lastLines[from] ?? 0
    }
    this.#slots = slots
    this.#offsets = offsets
    this.#lengths = lengths
    this.#times = times
    this.#sources = sources
    this.#recordNumbers = recordNumbers
    this.#levels = levels
    this.#firstLines = firstLines
    this.#lastLines = lastLines
  }

  get retained (): number {
    return this.#endSequence - this.#firstSequence
  }

  // The sequence of the oldest retained record; with endSequence, the range of the retained records.
  get firstSequence (): number {
    return this.#firstSequence
  }

  // One more than the sequence of the newest retained record.
  get endSequence (): number {
    return this.#endSequence
  }

  // Keeps the record and evicts the oldest records beyond the limits. A record larger than the byte limit is counted
  // as seen and evicted at once; the others stay. Returns the record's sequence, or undefined for such a record.
  append (record: StoredRecord): number | undefined {
    this.seen += 1
    this.dataRevision += 1
    const { length } = record.bytes
    if (length > this.maximumBytes) {
      this.evicted += 1
      return undefined
    }
    if (this.retained === this.maximumRecords) {
      this.#evictOldest()
    }
    let offset = this.#place(length)
    while (offset === undefined) {
      if (this.#arena.length < this.maximumBytes) {
        this.#growArena(length)
      } else {
        this.#evictOldest()
      }
      offset = this.#place(length)
    }
    if (this.retained === this.#slots) {
      this.#growSlots()
    }
    const sequence = this.#endSequence
    const slot = this.#slot(sequence)
    this.#arena.set(record.bytes, offset)
    this.#offsets[slot] = offset
    this.#lengths[slot] = length
    this.#times[slot] = record.time
    this.#sources[slot] = record.source
    this.#recordNumbers[slot] = record.recordNumber
    this.#levels[slot] = record.level
    this.#firstLines[slot] = record.firstLine
    this.#lastLines[slot] = record.lastLine
    this.#head = offset + length
    this.#endSequence += 1
    this.retainedBytes += length
    return sequence
  }

  has (sequence: number): boolean {
    return Number.isSafeInteger(sequence) && sequence >= this.#firstSequence && sequence < this.#endSequence
  }

  textAt (sequence: number): string {
    const slot = this.#check(sequence)
    const offset = this.#offsets[slot] ?? 0
    return this.#arena.toString('utf8', offset, offset + (this.#lengths[slot] ?? 0))
  }

  timeAt (sequence: number): number {
    return this.#times[this.#check(sequence)] ?? NaN
  }

  sourceAt (sequence: number): number {
    return this.#sources[this.#check(sequence)] ?? 0
  }

  recordNumberAt (sequence: number): number {
    return this.#recordNumbers[this.#check(sequence)] ?? 0
  }

  levelAt (sequence: number): number {
    return this.#levels[this.#check(sequence)] ?? 0
  }

  // The record's number in its source and its first and last line.
  positionAt (sequence: number): RecordPosition {
    const slot = this.#check(sequence)
    return {
      recordNumber: this.#recordNumbers[slot] ?? 0,
      firstLine: this.#firstLines[slot] ?? 0,
      lastLine: this.#lastLines[slot] ?? 0
    }
  }

  identifierAt (sequence: number): string {
    return recordIdentifier(this.sourceAt(sequence), this.recordNumberAt(sequence))
  }

  // The sequence of the retained record with the identifier, or undefined.
  sequenceOf (identifier: string): number | undefined {
    for (let sequence = this.#endSequence - 1; sequence >= this.#firstSequence; sequence -= 1) {
      if (this.identifierAt(sequence) === identifier) {
        return sequence
      }
    }
    return undefined
  }
}

export { RecordStore, defaultMaximumBytes, defaultMaximumRecords, recordIdentifier }
export type { StoredRecord, StoreLimits }
