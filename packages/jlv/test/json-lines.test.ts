// Generic JSON lines through the format pipeline (plan sections 5 and 6.2): records are JSON objects, everything else
// on a line is a diagnostic with its line number, and the rows of the viewer keep upstream's shape. The first suite
// keeps the assertions of upstream's test/log.test.js for readLog, which the format pipeline replaces.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { jsonLineEvent } from '../src/formats/json-lines.js'
import { readUpstreamFixture, valueAt } from './support/fixtures.js'
import { readRecords, rowsOf, shownRows } from './support/records.js'

const codes = (diagnostics: readonly { readonly code: string, readonly position?: { readonly firstLine: number } }[]): string[] =>
  diagnostics.map(diagnostic => `${String(diagnostic.position?.firstLine)}:${diagnostic.code}`)

describe('upstream readLog assertions', () => {
  it('reads the normal log: timestamp, level, message and data', async () => {
    const { records, format } = await readRecords(readUpstreamFixture('workflow-engine.log.2017-09-25'))
    const [first] = rowsOf(records)
    assert.equal(format, 'jsonl')
    assert.ok(first)
    assert.equal(first.timestamp, '2017-09-25T22:48:38.035Z')
    assert.equal(first.level, 'debug')
    assert.equal(first.message, 'Updated instance \'hemo\' with attributes')
    assert.equal(valueAt(first.data, ['to', 'type']), 'workflow-instance')
  })

  it('skips invalid entries', async () => {
    const { records, diagnostics } = await readRecords(readUpstreamFixture('broken.log'))
    assert.equal(records.length, 3)
    assert.ok(diagnostics.length > 0)
  })
})

describe('JSON lines', () => {
  // Upstream kept text, arrays, true and numbers as rows without fields and dropped false, 0 and empty text.
  it('reads only JSON objects as records and reports every other value with its line', async () => {
    const { records, diagnostics } = await readRecords('"abc"\n[1,2]\ntrue\nfalse\n0\n""\n7\nnull\n{}\n  \n{"a":\nplain text\n')
    assert.deepEqual(shownRows(records), [{ message: '', data: {} }])
    assert.deepEqual(codes(diagnostics), [
      '1:not-an-object', '2:not-an-object', '3:not-an-object', '4:not-an-object', '5:not-an-object', '6:not-an-object',
      '7:not-an-object', '8:not-an-object', '11:invalid-json', '12:invalid-json'
    ])
    assert.equal(diagnostics[0]?.message, 'skipped a JSON value that is no object')
    assert.equal(diagnostics.at(-1)?.message, 'skipped a line that is no JSON')
    assert.ok(diagnostics.every(diagnostic => diagnostic.severity === 'error'))
  })

  it('accepts CRLF line ends, a byte order mark and a last line without a line feed', async () => {
    const { records } = await readRecords('\u{FEFF}{"message":"bom"}\r\n{"message":"crlf","level":"INFO"}\r\n{"message":"last"}')
    assert.deepEqual(shownRows(records), [
      { message: 'bom', data: {} },
      { message: 'crlf', level: 'info', data: {} },
      { message: 'last', data: {} }
    ])
    assert.deepEqual(records.map(({ record }) => record.position), [
      { recordNumber: 1, firstLine: 1, lastLine: 1 },
      { recordNumber: 2, firstLine: 2, lastLine: 2 },
      { recordNumber: 3, firstLine: 3, lastLine: 3 }
    ])
  })

  it('keeps null, false, zero and empty text in the fields and shows a raw unknown level', async () => {
    const { records } = await readRecords('{"z":1,"message":"m","level":false,"timestamp":null,"a":2,"n":0,"e":""}\n')
    const [row] = rowsOf(records)
    assert.ok(row)
    assert.deepEqual(row.record.fields, { z: 1, message: 'm', level: false, timestamp: null, a: 2, n: 0, e: '' })
    assert.deepEqual(row.data, { z: 1, a: 2, n: 0, e: '' })
    assert.equal(row.level, 'false')
    assert.equal(row.record.level, 'unknown')
    assert.equal(row.timestamp, undefined)
  })

  it('decodes UTF-8 also when a character is split between chunks', async () => {
    const { records } = await readRecords('{"message":"b\u{E9} \u{1D11E}"}\n', { chunkBytes: 1 })
    assert.deepEqual(shownRows(records), [{ message: 'b\u{E9} \u{1D11E}', data: {} }])
  })

  it('skips numbers beyond the range of doubles, nesting beyond 64 levels and lines over the size limit', async () => {
    const deep = `{"a":${'['.repeat(64)}${']'.repeat(64)}}`
    const { records, diagnostics } = await readRecords(`{"n":1e400}\n${deep}\n{"message":"kept"}\n`)
    assert.deepEqual(shownRows(records), [{ message: 'kept', data: {} }])
    assert.deepEqual(codes(diagnostics), ['1:number-out-of-range', '2:too-deep'])
    const oversized = jsonLineEvent({ kind: 'oversized', lineNumber: 4, byteLength: 2_000_000 }, 1024 * 1024)
    assert.deepEqual(oversized, {
      kind: 'diagnostic',
      severity: 'error',
      code: 'record-too-large',
      message: 'skipped a line of 2000000 bytes, more than the limit of 1 MiB',
      position: { firstLine: 4, lastLine: 4 }
    })
  })

  it('reads a pretty-printed JSON document as diagnostics, not as records', async () => {
    const { records, diagnostics } = await readRecords(readUpstreamFixture('monolog.log.json'))
    assert.equal(records.length, 0)
    assert.ok(diagnostics.length > 0 && diagnostics.every(diagnostic => diagnostic.code === 'invalid-json'))
  })

  it('numbers the records of a source and gives each the identifier of its source and number', async () => {
    const { records } = await readRecords('{"message":"a"}\nnot json\n{"message":"b"}\n')
    assert.deepEqual(records.map(({ record }) => [record.identifier, record.position.firstLine]), [['1:1', 1], ['1:2', 3]])
  })
})
