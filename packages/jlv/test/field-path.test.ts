// The field paths that replace lodash.get and lodash.property. The expected values were recorded from lodash
// 4.17.11 with the same record and paths; only prototype members differ on purpose.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { asJsonObject, isPlainObject } from '../src/record.js'
import { fieldReader, formatPath, parsePath, valueAtField, valueAtPath } from '../src/field-path.js'

const record = {
  a: { b: [{ c: 'deep' }] },
  'x.y': 'dotted',
  top: 'v',
  'a[0]': 'bracket key',
  list: [10, 20],
  nested: { 'dot.key': 1, "it's": 2, 'q"k': 3 },
  empty: { '': 'blank' },
  nothing: null,
  zero: 0,
  no: false
}

// lodash.get(record, path) and lodash.property(path)(record) for each path.
const recorded: readonly (readonly [path: string, get: unknown, property: unknown])[] = [
  ['a.b[0].c', 'deep', 'deep'],
  ['x.y', 'dotted', 'dotted'],
  ['top', 'v', 'v'],
  ['missing', undefined, undefined],
  ['nope.nothing', undefined, undefined],
  ['', undefined, undefined],
  ['a[0]', 'bracket key', 'bracket key'],
  ['list[1]', 20, 20],
  ['list.1', 20, 20],
  ['list[-1]', undefined, undefined],
  ['a.b.0.c', 'deep', 'deep'],
  ['nested["dot.key"]', 1, 1],
  [String.raw`nested['it\'s']`, 2, 2],
  [String.raw`nested["q\"k"]`, 3, 3],
  ['empty.', 'blank', 'blank'],
  ['empty[""]', 'blank', 'blank'],
  ['.top', undefined, undefined],
  ['nothing', null, null],
  ['nothing.x', undefined, undefined],
  ['zero', 0, 0],
  ['no', false, false],
  ['list.length', 2, 2],
  ['top.length', 1, 1],
  ['a..b', undefined, undefined],
  ['list[1.5]', undefined, undefined],
  ['a.b[0]', { c: 'deep' }, { c: 'deep' }],
  ['nested[dot.key]', undefined, undefined],
  ['[top]', 'v', 'v'],
  ['a.b[0].c.length', 4, 4],
  ['top[0]', 'v', 'v']
]

describe('field paths', () => {
  it('read every recorded path as lodash.get did', () => {
    for (const [path, expected] of recorded) {
      assert.deepEqual(valueAtField(record, path), expected, path)
    }
  })

  it('read every recorded path as lodash.property did', () => {
    for (const [path, , expected] of recorded) {
      assert.deepEqual(fieldReader(path)(record), expected, path)
    }
  })

  it('take segment lists as they are', () => {
    assert.equal(valueAtField(record, ['a', 'b', '0', 'c']), 'deep')
    assert.equal(valueAtField(record, ['x.y']), 'dotted')
    assert.equal(valueAtField(record, []), undefined)
    assert.equal(valueAtField(record, ['nested', 'dot.key']), 1)
    assert.equal(valueAtField(record, ['list', '0']), 10)
  })

  it('read the characters and the length of text', () => {
    assert.equal(valueAtField('abc', '0'), 'a')
    assert.equal(valueAtField('abc', '2'), 'c')
    assert.equal(valueAtField('abc', 'length'), 3)
    assert.equal(valueAtField('abc', '5'), undefined)
  })

  it('split paths into segments with lodash grammar', () => {
    assert.deepEqual(parsePath('a.b[0].c'), ['a', 'b', '0', 'c'])
    assert.deepEqual(parsePath(String.raw`x["a.b"][' c\'d ']`), ['x', 'a.b', " c'd "])
    assert.deepEqual(parsePath('.a..b'), ['', 'a', '', 'b'])
    assert.deepEqual(parsePath('a[]'), ['a', ''])
  })

  // lodash read inherited members: a mapping or filter on constructor found the Object function on every record.
  it('never reach prototype members', () => {
    for (const path of ['constructor', '__proto__', 'toString', 'a.constructor', 'list.map', 'top.toUpperCase', 'hasOwnProperty']) {
      assert.equal(valueAtField(record, path), undefined, path)
    }
    assert.equal(valueAtField(record, ['__proto__', 'constructor']), undefined)
  })

  it('follow segment lists of the record model through parsed JSON, with numbers or canonical text as indexes', () => {
    const value: unknown = JSON.parse('{"a":{"b":[{"c":"deep"},null]},"x.y":"dotted","list":[10,20],"zero":0,"__proto__":{"p":1}}')
    assert.ok(isPlainObject(value))
    const parsed = asJsonObject(value)
    assert.equal(valueAtPath(parsed, ['a', 'b', 0, 'c']), 'deep')
    assert.equal(valueAtPath(parsed, ['a', 'b', '0', 'c']), 'deep')
    assert.equal(valueAtPath(parsed, ['a', 'b', 1]), null)
    assert.equal(valueAtPath(parsed, ['x.y']), 'dotted')
    assert.equal(valueAtPath(parsed, ['zero']), 0)
    assert.deepEqual(valueAtPath(parsed, ['__proto__']), { p: 1 })
    for (const path of [[], ['missing'], ['x', 'y'], ['list', 2], ['list', -1], ['list', '01'], ['list', 1.5], ['list', 'length'],
      ['zero', 'toFixed'], ['constructor'], ['a', 'constructor'], ['a', 'b', 0, 'c', 0]]) {
      assert.equal(valueAtPath(parsed, path), undefined, formatPath(path))
    }
    assert.equal(formatPath(['datetime', 'date', 0]), '["datetime","date",0]')
  })

  it('never invoke accessors', () => {
    let reads = 0
    const withAccessor = Object.defineProperty({}, 'computed', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'value'
      }
    })
    assert.equal(valueAtField(withAccessor, 'computed'), undefined)
    assert.equal(valueAtPath(asJsonObject(withAccessor), ['computed']), undefined)
    const array: string[] = []
    Object.defineProperty(array, 0, { get: () => { reads += 1; return 'value' } })
    assert.equal(valueAtPath(array, [0]), undefined)
    assert.equal(reads, 0)
  })
})
