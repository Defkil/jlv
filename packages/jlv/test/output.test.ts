// Machine output of src/output.ts: plain text and JSON lines, and a writer that waits for a slow destination and
// treats a reader that went away as the normal end of the output.
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { describe, it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type { LogRecord } from '../src/api.js'
import { LineWriter, jsonLine, plainLine } from '../src/output.js'
import { readRecords, rowsOf } from './support/records.js'

const record: LogRecord = {
  identifier: '1:3',
  source: { identifier: '1', label: 'app.log', order: 0 },
  position: { recordNumber: 3, firstLine: 7, lastLine: 7 },
  level: 'info',
  message: 'a\nb',
  timestamp: 1_791_712_800_000,
  fields: { msg: 'a\nb', level: 30, nested: { n: 0, f: false, z: null } }
}

describe('record lines', () => {
  it('writes a record as one JSON line of the record model, its parts in a fixed order and its original fields', () => {
    assert.equal(jsonLine(record), '{"identifier":"1:3","source":{"identifier":"1","label":"app.log","order":0},' +
      '"position":{"recordNumber":3,"firstLine":7,"lastLine":7},"timestamp":1791712800000,"level":"info",' +
      '"message":"a\\nb","fields":{"msg":"a\\nb","level":30,"nested":{"n":0,"f":false,"z":null}}}\n')
    const textual: LogRecord = {
      identifier: record.identifier,
      source: record.source,
      position: record.position,
      timestampText: 'yesterday',
      level: record.level,
      message: record.message,
      correlationIdentifier: '0',
      fields: record.fields
    }
    assert.equal(jsonLine(textual),
      jsonLine(record).replace('"timestamp":1791712800000', '"timestampText":"yesterday"').replace('"fields"', '"correlationIdentifier":"0","fields"'))
  })

  it('writes timestamp, level and message of the row as text and the fields of the details as JSON', async () => {
    const { records } = await readRecords([
      '{"timestamp":"2026-10-11T12:00:00+02:00","level":"INFO","message":"started","port":80}',
      '{"message":"no time"}',
      '{"timestamp":1700000000000,"level":30,"message":{"text":"object"}}',
      '{"level":"debug"}'
    ].join('\n'))
    assert.deepEqual(rowsOf(records).map(row => plainLine(row)), [
      '2026-10-11T10:00:00.000Z info started {"port":80}\n',
      '- - no time\n',
      '2023-11-14T22:13:20.000Z 30 {"text":"object"}\n',
      '- debug -\n'
    ])
  })

  // A raw level such as constructor read the Object function from the level tables, and the plain line failed on it.
  it('writes raw levels that name members of Object.prototype as unknown levels', async () => {
    const { records } = await readRecords('{"level":"constructor","message":"a"}\n{"level":"__proto__","message":"b"}\n')
    assert.deepEqual(records.map(({ record }) => record.level), ['unknown', 'unknown'])
    assert.deepEqual(rowsOf(records).map(row => plainLine(row)), ['- constructor a\n', '- __proto__ b\n'])
    const line = jsonLine(records[0]?.record ?? assert.fail('no record'))
    assert.equal(Reflect.get(JSON.parse(line) as object, 'level'), 'unknown')
  })

  it('keeps every record on one line', async () => {
    const { records } = await readRecords('{"message":"first\\r\\nsecond","detail":"a\\nb"}\n')
    assert.deepEqual(rowsOf(records).map(row => plainLine(row)), [String.raw`- - first\r\nsecond {"detail":"a\nb"}` + '\n'])
  })
})

// A destination that takes one chunk at a time, after a delay, with a small buffer.
class SlowSink extends Writable {
  readonly chunks: string[] = []

  constructor () {
    super({ highWaterMark: 16, decodeStrings: false })
  }

  override _write (chunk: string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    setTimeout(() => {
      this.chunks.push(chunk)
      callback()
    }, 5)
  }
}

describe('line writer', () => {
  it('waits for a full destination to drain before the next write', async () => {
    const sink = new SlowSink()
    const writer = new LineWriter(sink, () => assert.fail('closed'))
    const started = performance.now()
    for (let index = 0; index < 5; index += 1) {
      await writer.write(`line ${String(index)} with more text than the buffer holds\n`)
      // The writer returns only once the destination can take more.
      assert.ok(sink.writableLength <= 16 || sink.chunks.length >= index)
    }
    await writer.flush()
    assert.equal(sink.chunks.length, 5)
    assert.ok(performance.now() - started >= 20)
  })

  it('stops waiting for a destination that does not drain when the signal aborts', async () => {
    // The write callback never runs, so the destination never drains.
    const sink = new Writable({ highWaterMark: 1, write: () => { /* never done */ } })
    const writer = new LineWriter(sink, () => assert.fail('closed'))
    const controller = new AbortController()
    const waiting = writer.write('never drained\n', controller.signal)
    setTimeout(() => { controller.abort() }, 10)
    await waiting
    await writer.write('after the abort\n', controller.signal)
    assert.equal(sink.writableLength, 'never drained\nafter the abort\n'.length)
  })

  it('ends the output normally when the reader goes away and drops later writes', async () => {
    const closes: (Error | undefined)[] = []
    const sink = new Writable({
      write: (_chunk, _encoding, callback) => {
        callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
      }
    })
    const writer = new LineWriter(sink, error => { closes.push(error) })
    await writer.write('first\n')
    await delay(1)
    assert.deepEqual(closes, [undefined])
    assert.equal(writer.isClosed, true)
    assert.equal(writer.error, undefined)
    await writer.write('dropped\n')
    await writer.flush()
  })

  it('reports any other error of the destination', async () => {
    const closes: (Error | undefined)[] = []
    const sink = new Writable({
      write: (_chunk, _encoding, callback) => {
        callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
      }
    })
    const writer = new LineWriter(sink, error => { closes.push(error) })
    await writer.write('first\n')
    await delay(1)
    assert.equal(closes[0]?.message, 'disk full')
    assert.equal(writer.error?.message, 'disk full')
  })
})
