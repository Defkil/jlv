// The bounded record store of src/store.ts: count and byte limits, eviction of the oldest records, the arena's
// growth and wrap-around, identifiers and revisions (plan sections 6.1 and 0.9).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RecordStore, defaultMaximumBytes, defaultMaximumRecords } from '../src/store.js'

const record = (text: string, recordNumber = 1, source = 0, time = NaN): Parameters<RecordStore['append']>[0] =>
  ({ source, recordNumber, bytes: Buffer.from(text, 'utf8'), time })

const retainedTexts = (store: RecordStore): string[] => {
  const texts: string[] = []
  for (let sequence = store.firstSequence; sequence < store.endSequence; sequence += 1) {
    texts.push(store.textAt(sequence))
  }
  return texts
}

// A deterministic pseudo-random sequence, so that a failure can be reproduced.
const randomLengths = (count: number, maximum: number): number[] => {
  let state = 42
  return Array.from({ length: count }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return 1 + (state % maximum)
  })
}

describe('record store', () => {
  it('starts empty with the default limits of 50,000 records and 64 MiB', () => {
    const store = new RecordStore()
    assert.equal(store.maximumRecords, defaultMaximumRecords)
    assert.equal(store.maximumRecords, 50_000)
    assert.equal(store.maximumBytes, defaultMaximumBytes)
    assert.equal(store.maximumBytes, 64 * 1024 * 1024)
    assert.deepEqual([store.seen, store.retained, store.evicted, store.retainedBytes, store.dataRevision], [0, 0, 0, 0, 0])
  })

  it('evicts the oldest records beyond the record limit and counts seen, retained and evicted records', () => {
    const store = new RecordStore({ maximumRecords: 3 })
    for (let index = 1; index <= 5; index += 1) {
      store.append(record(`r${String(index)}`, index))
    }
    assert.deepEqual([store.seen, store.retained, store.evicted], [5, 3, 2])
    assert.deepEqual([store.firstSequence, store.endSequence], [2, 5])
    assert.deepEqual(retainedTexts(store), ['r3', 'r4', 'r5'])
    assert.equal(store.has(1), false)
    assert.throws(() => store.textAt(1), RangeError)
  })

  it('evicts the oldest records beyond the byte limit', () => {
    const store = new RecordStore({ maximumBytes: 100 })
    for (let index = 0; index < 4; index += 1) {
      store.append(record(String(index).repeat(30), index + 1))
      assert.ok(store.retainedBytes <= 100)
    }
    assert.deepEqual(retainedTexts(store), ['1'.repeat(30), '2'.repeat(30), '3'.repeat(30)])
    assert.deepEqual([store.seen, store.retained, store.evicted, store.retainedBytes], [4, 3, 1, 90])
  })

  it('keeps the bytes of every retained record intact while the arena wraps around', () => {
    const store = new RecordStore({ maximumBytes: 128, maximumRecords: 1000 })
    const appended: string[] = []
    for (const [index, length] of randomLengths(2000, 40).entries()) {
      const text = String.fromCodePoint(0x61 + (index % 26)).repeat(length - 1) + 'é'.slice(0, length > 1 ? 1 : 0)
      appended.push(text)
      store.append(record(text, index + 1))
      const texts = retainedTexts(store)
      // The retained records are the newest ones, in order.
      assert.deepEqual(texts, appended.slice(appended.length - texts.length))
      assert.equal(store.retainedBytes, texts.reduce((sum, retained) => sum + Buffer.byteLength(retained), 0))
      assert.ok(store.retainedBytes <= 128)
      // Once the arena is full, at most about one record's size is lost at its end when it wraps around.
      assert.ok(store.evicted === 0 || store.retainedBytes > 128 - 2 * 41, `only ${String(store.retainedBytes)} bytes retained`)
    }
    assert.equal(store.seen, 2000)
    assert.equal(store.evicted, 2000 - store.retained)
  })

  it('grows the arena and the slots up to the limits without evicting', () => {
    const store = new RecordStore({ maximumBytes: 4 * 1024 * 1024, maximumRecords: 5000 })
    const text = 'x'.repeat(500)
    for (let index = 0; index < 5000; index += 1) {
      store.append(record(`${text}${String(index)}`, index + 1))
    }
    assert.deepEqual([store.retained, store.evicted], [5000, 0])
    assert.equal(store.textAt(0), `${text}0`)
    assert.equal(store.textAt(4999), `${text}4999`)
    store.append(record('next', 5001))
    assert.deepEqual([store.retained, store.evicted, store.firstSequence], [5000, 1, 1])
  })

  it('counts a record larger than the byte limit as seen and evicted and keeps the others', () => {
    const store = new RecordStore({ maximumBytes: 10 })
    store.append(record('small'))
    assert.equal(store.append(record('far too large for the store')), undefined)
    assert.deepEqual([store.seen, store.retained, store.evicted], [2, 1, 1])
    assert.deepEqual(retainedTexts(store), ['small'])
  })

  it('changes the data revision with every append, also when it evicts', () => {
    const store = new RecordStore({ maximumRecords: 1 })
    store.append(record('a'))
    store.append(record('b'))
    assert.equal(store.dataRevision, 2)
  })

  it('identifies records by source and record number and finds them again', () => {
    const store = new RecordStore({ maximumRecords: 4 })
    store.append(record('a1', 1, 0, 10))
    store.append(record('b1', 1, 1, 20))
    store.append(record('a2', 2, 0))
    assert.deepEqual([0, 1, 2].map(sequence => store.identifierAt(sequence)), ['1:1', '2:1', '1:2'])
    assert.deepEqual([store.sourceAt(1), store.recordNumberAt(1), store.timeAt(1)], [1, 1, 20])
    assert.ok(Number.isNaN(store.timeAt(2)))
    assert.equal(store.sequenceOf('2:1'), 1)
    assert.equal(store.sequenceOf('3:1'), undefined)
    store.append(record('a3', 3, 0))
    store.append(record('a4', 4, 0))
    assert.equal(store.sequenceOf('1:1'), undefined)
    assert.equal(store.sequenceOf('1:4'), 4)
  })

  it('rejects limits that are not positive integers', () => {
    assert.throws(() => new RecordStore({ maximumRecords: 0 }), RangeError)
    assert.throws(() => new RecordStore({ maximumBytes: 1.5 }), RangeError)
    assert.throws(() => new RecordStore({ maximumBytes: 2 ** 32 }), RangeError)
  })
})
