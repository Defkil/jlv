// Characterization of the row formatting with values other than text, as upstream src/utils.js renders them: a
// cell whose formatting fails shows its raw value. The expectations were recorded from the upstream module.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatRows, hasColors, maxLengths, padEnd, spaces, stripColors, textLength, trunc } from '../src/tui/formatting.js'

const failingFormat = (): string => { throw new Error('no format') }

describe('formatRows with values other than text', () => {
  it('shows a number unpadded, since it has no length to pad by', () => {
    const rows = [{ ts: 1_696_000_000_000, msg: 'a' }, { ts: 'short', msg: 'b' }]
    assert.deepEqual(formatRows(rows, [{ key: 'ts' }, { key: 'msg' }], 1, 30), [
      '1696000000000 a               ',
      'short         b               '
    ])
  })

  // Upstream printed null as text as well; a missing value is empty now, as wide as it is measured.
  it('prints missing values as empty and other empty values as text, padded as if they had no width', () => {
    const rows = [{ a: null, b: 'x' }, { a: false, b: 'y' }, { a: 0, b: 'z' }, { a: 'abc', b: 'w' }]
    assert.deepEqual(formatRows(rows, [{ key: 'a' }, { key: 'b' }], 1, 20), [
      '    x               ',
      'false    y               ',
      '0    z               ',
      'abc w               '
    ])
  })

  it('shows an object as [object Object], padded only when it has a length field', () => {
    const columns = [{ key: 'a' }, { key: 'm' }]
    assert.deepEqual(formatRows([{ a: 'x', m: { k: 1 } }], columns, 1, 30), ['x [object Object]'])
    assert.deepEqual(formatRows([{ a: 'x', m: { length: 3 } }], columns, 1, 30), [`x [object Object]${' '.repeat(25)}`])
  })

  it('joins an array and pads it by its number of elements', () => {
    const columns = [{ key: 'a' }, { key: 'm' }]
    assert.deepEqual(formatRows([{ a: 'x', m: ['p', 'q'] }], columns, 1, 30), [`x p,q${' '.repeat(26)}`])
    assert.deepEqual(formatRows([{ a: 'x', m: ['p', 'q', 'r', 's'] }], columns, 1, 4), ['x p,q,r,s'])
  })

  it('shows the raw value when a format fails and cuts a formatted value to the column width', () => {
    assert.deepEqual(formatRows([{ a: 7, b: 'x' }], [{ key: 'a', format: failingFormat }, { key: 'b' }], 2, 30), [`7  x${' '.repeat(26)}`])
    assert.deepEqual(formatRows([{ b: 'x' }], [{ key: 'a', format: (value: unknown) => `<${String(value)}>` }, { key: 'b' }], 1, 30), [` x${' '.repeat(28)}`])
  })

  it('gives the last column an empty cell when the width is used up', () => {
    assert.deepEqual(formatRows([{ a: 'abcdef', m: 'hello' }], [{ key: 'a' }, { key: 'm' }], 1, 4), ['abcdef '])
  })

  it('measures values other than text by their text form', () => {
    const rows = [{ a: 12_345 }, { a: true }, { a: ['x', 'yy'] }, { a: { o: 1 } }]
    assert.deepEqual(maxLengths([{ key: 'a' }, { key: 'b' }], rows, 1, 30), { a: 15, b: 14 })
    assert.deepEqual(maxLengths([{ key: 'a' }, { key: 'b' }], [], 1, 30), { b: 30 })
  })

  it('throws a TypeError without columns', () => {
    assert.throws(() => formatRows([{ a: 1 }], [], 1, 30), TypeError)
    assert.deepEqual(formatRows([], [{ key: 'a' }], 1, 30), [])
  })
})

describe('blessed tag detection', () => {
  // Upstream tested with a global regular expression, which continues where the previous match ended: the second
  // call below answered false, and trunc then cut through the tag and returned {fg.
  it('answers the same for the same text, whatever was tested before', () => {
    assert.equal(hasColors('{bold}a'), true)
    assert.equal(hasColors('{bold}a'), true)
    assert.equal(hasColors('{bold}a'), true)
    assert.equal(trunc('{fg-green}felipe', 3), '{fg-green}fel{/}')
  })
})

describe('formatting helpers with values other than text', () => {
  it('spaces accepts only whole counts from -1', () => {
    assert.equal(spaces(-1), '')
    assert.equal(spaces(0), '')
    assert.throws(() => spaces(NaN), RangeError)
    assert.throws(() => spaces(-2), RangeError)
    assert.throws(() => spaces(2.5), RangeError)
  })

  it('needs text wherever upstream called a text method', () => {
    assert.equal(stripColors(0), '')
    assert.equal(stripColors(null), '')
    assert.throws(() => stripColors(5), TypeError)
    assert.equal(textLength(0), 0)
    assert.equal(textLength([1, 2], true), 2)
    assert.throws(() => textLength(5), TypeError)
    assert.throws(() => trunc(5, 2, true), TypeError)
    assert.throws(() => trunc(5, 2), TypeError)
    assert.throws(() => trunc(['{bold}xyz'], 2), TypeError)
    assert.equal(trunc('{bold}abc{/bold}', -1), '{/}')
    assert.equal(trunc('abc', -1), '')
    // Upstream printed a missing value as text after measuring it as empty, which made its row too wide.
    assert.equal(padEnd(undefined, 3, true), ' '.repeat(3))
    assert.equal(padEnd(null, 3, true), ' '.repeat(3))
    assert.throws(() => padEnd(5, 3, true), RangeError)
    assert.throws(() => padEnd(5, 3), TypeError)
    assert.throws(() => padEnd('ab', NaN, true), RangeError)
  })
})
