// The value comparison that replaces lodash.sortBy's. The expected orders were recorded from lodash 4.17.11 with the
// same rows, including mixed types whose order depends on the sort algorithm. Directions, missing values and ties
// of the viewer's orders are tested with the record view.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fieldReader } from '../src/field-path.js'
import { compareAscending } from '../src/tui/row-order.js'

const values: readonly unknown[] = [
  'b', 'a', 'B', 10, 9, '10', '9', null, undefined, NaN, true, false, 0, -1, '', [2, 1], [1], { a: 1 }, 'x',
  '2026-10-11T10:00:00.000Z', 30, '30', 1e21, ' 7 '
]
const rows = values.map((value, index) => ({ index, v: value }))
const indexes = (sorted: readonly { readonly index: number }[]): number[] => sorted.map(row => row.index)

// A stable ascending sort by the value at the key, as lodash.sortBy did.
const sortAscending = <Row>(sortedRows: readonly Row[], key: string): Row[] => {
  const read = fieldReader(key)
  return sortedRows
    .map((row, index) => ({ row, index, value: read(row) }))
    .toSorted((left, right) => compareAscending(left.value, right.value) || left.index - right.index)
    .map(({ row }) => row)
}

describe('row order', () => {
  it('sorts ascending in the order of lodash.sortBy', () => {
    assert.deepEqual(indexes(sortAscending(rows, 'v')), [5, 6, 2, 1, 0, 13, 11, 12, 14, 10, 23, 16, 4, 3, 15, 19, 21, 17, 18, 20, 22, 7, 8, 9])
  })

  it('sorts by a nested key and keeps equal values in their order', () => {
    const nested = [{ index: 0, data: { k: 'b' } }, { index: 1, data: {} }, { index: 2, data: { k: 'a' } }, { index: 3 }, { index: 4, data: { k: 'a' } }]
    assert.deepEqual(indexes(sortAscending(nested, 'data.k')), [2, 4, 0, 1, 3])
  })

  it('orders defined values before null, undefined and NaN', () => {
    assert.equal(compareAscending('a', null), -1)
    assert.equal(compareAscending(null, undefined), -1)
    assert.equal(compareAscending(undefined, NaN), -1)
    assert.equal(compareAscending(NaN, 'a'), 1)
    assert.equal(compareAscending(2, 10), -1)
    assert.equal(compareAscending('2', '10'), 1)
    assert.equal(compareAscending('', 0), 0)
  })
})
