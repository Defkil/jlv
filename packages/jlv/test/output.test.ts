// Machine output of src/output.ts: plain text and JSON lines, and a writer that waits for a slow destination and
// treats a reader that went away as the normal end of the output.
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { describe, it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { LineWriter, jsonLine, plainLine } from '../src/output.js'

describe('record lines', () => {
  it('writes a record as one JSON line with its parsed values', () => {
    assert.equal(jsonLine({ timestamp: 't', message: 'a\nb', nested: { n: 0, f: false, z: null } }),
      '{"timestamp":"t","message":"a\\nb","nested":{"n":0,"f":false,"z":null}}\n')
    assert.equal(jsonLine('text'), '"text"\n')
  })

  it('writes timestamp, level and message as text and the other fields as JSON', () => {
    assert.equal(plainLine({ timestamp: '2026-10-11T10:00:00.000Z', level: 'info', message: 'started', port: 80 }),
      '2026-10-11T10:00:00.000Z info started {"port":80}\n')
    assert.equal(plainLine({ message: 'no time' }), '- - no time\n')
    assert.equal(plainLine({ timestamp: 1_700_000_000_000, level: 30, message: { text: 'object' } }), '1700000000000 30 {"text":"object"}\n')
  })

  it('keeps every record on one line', () => {
    assert.equal(plainLine({ message: 'first\r\nsecond', detail: 'a\nb' }), String.raw`- - first\r\nsecond {"detail":"a\nb"}` + '\n')
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
