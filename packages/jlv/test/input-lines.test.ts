// Line framing of src/input/lines.ts: chunk boundaries anywhere, line endings, byte order marks, the last line of a
// finite source and the bound on oversized lines (plan section 6.1).
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { LineSplitter, readLines, type LineEvent, type LineSplitterOptions } from '../src/input/lines.js'

type Framed =
  | { readonly line: string, readonly number: number }
  | { readonly oversized: number, readonly number: number }

const describeEvent = (event: LineEvent): Framed => event.kind === 'line'
  ? { line: event.bytes.toString('utf8'), number: event.lineNumber }
  : { oversized: event.byteLength, number: event.lineNumber }

// Pushes the chunks one after the other and ends the source.
const frame = (chunks: readonly Uint8Array[], options: LineSplitterOptions = {}): Framed[] => {
  const splitter = new LineSplitter(options)
  return [...chunks.flatMap(chunk => splitter.push(chunk)), ...splitter.end()].map(event => describeEvent(event))
}

const bytesOf = (text: string): Buffer => Buffer.from(text, 'utf8')

// A byte order mark, two-, three- and four-byte characters, CRLF and LF endings, an empty line and a last line
// without a line ending.
const sample = Buffer.concat([
  Buffer.from([0xEF, 0xBB, 0xBF]),
  bytesOf('{"m":"ä€𝄞😀"}\r\n\n{"m":"b"}\n{"m":"crlf"}\r\n{"m":"last"}')
])
const sampleLines: readonly Framed[] = [
  { line: '{"m":"ä€𝄞😀"}', number: 1 },
  { line: '', number: 2 },
  { line: '{"m":"b"}', number: 3 },
  { line: '{"m":"crlf"}', number: 4 },
  { line: '{"m":"last"}', number: 5 }
]

describe('line framing', () => {
  it('frames the same lines for every split of the sample into two chunks', () => {
    for (let split = 0; split <= sample.length; split += 1) {
      assert.deepEqual(frame([sample.subarray(0, split), sample.subarray(split)]), sampleLines, `split at ${String(split)}`)
    }
  })

  it('frames the same lines for every split of the sample into three chunks', () => {
    for (let first = 0; first <= sample.length; first += 1) {
      for (let second = first; second <= sample.length; second += 1) {
        const chunks = [sample.subarray(0, first), sample.subarray(first, second), sample.subarray(second)]
        assert.deepEqual(frame(chunks), sampleLines, `splits at ${String(first)} and ${String(second)}`)
      }
    }
  })

  it('frames the same lines from chunks of one byte', () => {
    assert.deepEqual(frame([...sample].map(byte => Uint8Array.of(byte))), sampleLines)
  })

  it('parses the last line of a finite source without a line ending', () => {
    assert.deepEqual(frame([bytesOf('a\nb')]), [{ line: 'a', number: 1 }, { line: 'b', number: 2 }])
    assert.deepEqual(frame([bytesOf('a\n')]), [{ line: 'a', number: 1 }])
    assert.deepEqual(frame([bytesOf('a\r')]), [{ line: 'a', number: 1 }])
    assert.deepEqual(frame([bytesOf('')]), [])
    assert.deepEqual(frame([]), [])
  })

  it('holds an unfinished line back until its line feed arrives', () => {
    const splitter = new LineSplitter()
    assert.deepEqual(splitter.push(bytesOf('{"a":')), [])
    assert.equal(splitter.hasPartialLine, true)
    assert.deepEqual(splitter.push(bytesOf('1}\r')).map(event => describeEvent(event)), [])
    assert.deepEqual(splitter.push(bytesOf('\n')).map(event => describeEvent(event)), [{ line: '{"a":1}', number: 1 }])
    assert.equal(splitter.hasPartialLine, false)
  })

  it('keeps a lone carriage return inside a line', () => {
    assert.deepEqual(frame([bytesOf('a\rb\n')]), [{ line: 'a\rb', number: 1 }])
  })
})

describe('byte order marks', () => {
  it('drops a byte order mark that arrives one byte at a time', () => {
    assert.deepEqual(frame([Uint8Array.of(0xEF), Uint8Array.of(0xBB), Uint8Array.of(0xBF), bytesOf('{}\n')]), [{ line: '{}', number: 1 }])
  })

  it('keeps a byte order mark that does not start the source', () => {
    const [event] = new LineSplitter().push(Buffer.concat([bytesOf('a\n'), Buffer.from([0xEF, 0xBB, 0xBF]), bytesOf('b\n')])).slice(1)
    assert.ok(event?.kind === 'line')
    assert.deepEqual([...event.bytes], [0xEF, 0xBB, 0xBF, 0x62])
  })

  it('keeps the first bytes of a byte order mark that does not continue', () => {
    const lines = new LineSplitter()
    const events = [...lines.push(Uint8Array.of(0xEF, 0xBB)), ...lines.push(bytesOf('A\n')), ...lines.end()]
    assert.deepEqual(events.map(event => event.kind === 'line' ? [...event.bytes] : []), [[0xEF, 0xBB, 0x41]])
    const partial = new LineSplitter()
    const ended = [...partial.push(Uint8Array.of(0xEF, 0xBB)), ...partial.end()]
    assert.deepEqual(ended.map(event => event.kind === 'line' ? [...event.bytes] : []), [[0xEF, 0xBB]])
    const single = new LineSplitter().push(Uint8Array.of(0xEF, 0xBB, 0x41, 0x0A))
    assert.deepEqual(single.map(event => event.kind === 'line' ? [...event.bytes] : []), [[0xEF, 0xBB, 0x41]])
  })

  it('drops a byte order mark again and counts lines from 1 after a reset', () => {
    const splitter = new LineSplitter()
    splitter.push(bytesOf('a\nb'))
    splitter.reset()
    const events = [...splitter.push(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), bytesOf('c\n')]))]
    assert.deepEqual(events.map(event => describeEvent(event)), [{ line: 'c', number: 1 }])
  })
})

describe('oversized lines', () => {
  const options = { maximumLineBytes: 8 }

  it('accepts a line of the maximum size, also before a CRLF ending', () => {
    assert.deepEqual(frame([bytesOf('12345678\n12345678\r\n')], options), [
      { line: '12345678', number: 1 },
      { line: '12345678', number: 2 }
    ])
  })

  it('drops a longer line, reports its size and line number, and goes on with the next line', () => {
    assert.deepEqual(frame([bytesOf('123456789\nok\n123456789\r\n')], options), [
      { oversized: 9, number: 1 },
      { line: 'ok', number: 2 },
      { oversized: 10, number: 3 }
    ])
  })

  it('drops a long line that arrives one byte at a time without holding more than the maximum', () => {
    const splitter = new LineSplitter(options)
    const events: LineEvent[] = []
    let largestPending = 0
    for (const byte of bytesOf('0123456789abcdef\nok\n')) {
      events.push(...splitter.push(Uint8Array.of(byte)))
      largestPending = Math.max(largestPending, splitter.pendingByteLength)
    }
    events.push(...splitter.end())
    assert.deepEqual(events.map(event => describeEvent(event)), [{ oversized: 16, number: 1 }, { line: 'ok', number: 2 }])
    assert.ok(largestPending <= 9, `held ${String(largestPending)} bytes`)
  })

  it('reports an oversized last line at the end of the source', () => {
    assert.deepEqual(frame([bytesOf('ok\n0123456789')], options), [{ line: 'ok', number: 1 }, { oversized: 10, number: 2 }])
  })

  it('drops a 5 MiB line without line feeds at the default limit of 1 MiB and holds at most 1 MiB of it', () => {
    const splitter = new LineSplitter()
    const chunk = Buffer.alloc(64 * 1024, 'x')
    const events: LineEvent[] = []
    let largestPending = 0
    for (let index = 0; index < 80; index += 1) {
      events.push(...splitter.push(chunk))
      largestPending = Math.max(largestPending, splitter.pendingByteLength)
    }
    events.push(...splitter.push(bytesOf('\n{"ok":1}\n')), ...splitter.end())
    assert.deepEqual(events.map(event => describeEvent(event)), [{ oversized: 80 * 64 * 1024, number: 1 }, { line: '{"ok":1}', number: 2 }])
    assert.ok(largestPending <= 1024 * 1024 + 1, `held ${String(largestPending)} bytes`)
  })

  it('rejects a maximum that is not a positive integer', () => {
    assert.throws(() => new LineSplitter({ maximumLineBytes: 0 }), RangeError)
    assert.throws(() => new LineSplitter({ maximumLineBytes: 1.5 }), RangeError)
  })
})

describe('readLines', () => {
  it('frames an asynchronous source chunk by chunk and ends with its last line', async () => {
    const chunks = Readable.from([bytesOf('{"a":1}\n{"b"'), bytesOf(':2}\n'), bytesOf('{"c":3}')])
    const batches: Framed[][] = []
    for await (const events of readLines(chunks)) {
      batches.push(events.map(event => describeEvent(event)))
    }
    assert.deepEqual(batches, [
      [{ line: '{"a":1}', number: 1 }],
      [{ line: '{"b":2}', number: 2 }],
      [{ line: '{"c":3}', number: 3 }]
    ])
  })
})
