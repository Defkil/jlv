// The logfmt scanner of src/formats/logfmt.ts (plan section 6.2): its grammar beyond the corpus, field types, keys
// that are prototype names, and a probe that does not claim plain text, JSON or CSV.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { logfmtFormat, scanLogfmt } from '../src/formats/logfmt.js'

const context = {
  signal: new AbortController().signal,
  source: { identifier: '1', label: 'x', order: 0 },
  maximumRecordSize: 1024,
  mapping: {},
  levels: {}
}

const probe = (text: string): number => logfmtFormat.probe({ text }, context)

describe('logfmt scanner', () => {
  it('keeps values as text, flags as true and empty values as empty text', () => {
    assert.deepEqual(scanLogfmt('count=5 ok flag= quoted="" spaced="a b"'), {
      value: { count: '5', ok: true, flag: '', quoted: '', spaced: 'a b' },
      duplicates: []
    })
  })

  it('reads escapes in quotes, keeps unknown ones, and allows = in bare values', () => {
    assert.deepEqual(scanLogfmt(String.raw`a="tab\there" b="\x41" c=x=y=z d="A\u00"`), {
      value: { a: 'tab\there', b: String.raw`\x41`, c: 'x=y=z', d: String.raw`A\u00` },
      duplicates: []
    })
  })

  it('defines keys such as __proto__ as own fields', () => {
    const scanned = scanLogfmt('__proto__=polluted constructor=x')
    assert.ok(!('error' in scanned))
    assert.equal(Object.getOwnPropertyDescriptor(scanned.value, '__proto__')?.value, 'polluted')
    assert.equal(Object.getPrototypeOf(scanned.value), Object.prototype)
    assert.equal(Reflect.get({}, 'polluted'), undefined)
  })

  it('names every duplicate key and keeps its last value', () => {
    assert.deepEqual(scanLogfmt('a=1 a=2 b a=3'), { value: { a: '3', b: true }, duplicates: ['a', 'a'] })
  })

  it('refuses quotes in keys and bare values, text after a closing quote, open quotes and = without a key', () => {
    for (const [line, error] of [
      ['"key"=1', 'a quote inside a key'],
      ['a=b"c', 'a quote inside a value'],
      ['a="b"c', 'text right after a closing quote'],
      ['a="b', 'a quote that is not closed'],
      [String.raw`a="b\"`, 'a quote that is not closed'],
      ['=1', '"=" without a key']
    ] as const) {
      assert.deepEqual(scanLogfmt(line), { error }, line)
    }
  })
})

describe('logfmt probe', () => {
  it('claims lines with one of the usual keys and a value, and nothing else', () => {
    assert.equal(probe('level=info msg="started" port=80\n'), 80)
    assert.equal(probe('time=2026-10-11T10:00:00Z event=x\nnot logfmt "at all\n'), 40)
    assert.equal(probe('the server started on port 80\n'), 0)
    assert.equal(probe('a=1 b=2\n'), 0)
    assert.equal(probe('{"level":"info","msg":"json"}\n'), 0)
    assert.equal(probe('timestamp,level,message\n2026-10-11T10:00:00Z,info,csv\n'), 0)
  })
})
