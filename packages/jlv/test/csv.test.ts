// CSV through src/formats/csv.ts (plan section 6.2): the size cap, header problems, records that a live source shows
// as soon as their line ends, the header of each followed file, the delimiter, and the probe.
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import type { FormatContext, ParseEvent } from '../src/api.js'
import { createCsvFormat, csvFormat } from '../src/formats/csv.js'
import { builtInFormats, jsonLinesFormat } from '../src/formats/registry.js'
import { Ingestion, SourceState, sourceBatches } from '../src/ingestion.js'
import { readRecords } from './support/records.js'

const context: FormatContext = {
  signal: new AbortController().signal,
  source: { identifier: '1', label: 'data.csv', order: 0 },
  maximumRecordSize: 1024 * 1024,
  mapping: {},
  levels: {}
}

const describeEvents = (events: readonly ParseEvent[]): string[] => events.map(event => event.kind === 'entry'
  ? `${String(event.position.firstLine)}:${JSON.stringify(event.value)}`
  : `${String(event.position?.firstLine)}:${event.code}`)

const readAll = async (text: string, format = csvFormat): Promise<string[]> => {
  const input = Readable.from([Buffer.from(text)])
  return describeEvents(await Array.fromAsync(format.read(input, context)))
}

const probe = (text: string, extension?: string, mapping = {}): number =>
  csvFormat.probe(extension === undefined ? { text } : { text, extension }, { ...context, mapping })

describe('CSV records', () => {
  it('enforces the exact byte limit with LF, CRLF, EOF and split UTF-8 chunks', async () => {
    const limited = { ...context, maximumRecordSize: 8 }
    for (const ending of ['\n', '\r\n', '']) {
      for (const chunkBytes of [1, 1024]) {
        const text = `message\n12345678\n123456789\n${'é'.repeat(4)}\n${'é'.repeat(4)}x${ending}`
        const bytes = Buffer.from(text)
        const chunks: Buffer[] = []
        for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
          chunks.push(bytes.subarray(offset, offset + chunkBytes))
        }
        const events = await Array.fromAsync(csvFormat.read(Readable.from(chunks), limited))
        assert.deepEqual(describeEvents(events), [
          '2:{"message":"12345678"}', '3:record-too-large', `4:{"message":"${'é'.repeat(4)}"}`, '5:record-too-large'
        ], `ending ${JSON.stringify(ending)}, chunk size ${String(chunkBytes)}`)
      }
    }
    const input = Readable.from([Buffer.from('message\n12345678\r\n')])
    const events = await Array.fromAsync(csvFormat.read(input, limited))
    assert.deepEqual(describeEvents(events), ['2:{"message":"12345678"}'])
  })

  it('skips a record over the size limit and keeps the rows around it', async () => {
    const huge = `"${'x'.repeat(1024 * 1024 + 10)}"`
    assert.deepEqual(await readAll(`message\nbefore\n${huge}\nafter\n`), [
      '2:{"message":"before"}', '3:record-too-large', '4:{"message":"after"}'
    ])
  })

  it('drops an unclosed quote at the size limit and reads on from the next line', async () => {
    const swallowed = Array.from({ length: 20_000 }, (_, index) => `line ${String(index)} ${'y'.repeat(60)}`).join('\n')
    const events = await readAll(`message\n"unclosed ${swallowed}\nafter\n`)
    // The open quote takes lines until the record passes 1 MiB; the rest of that line is dropped, and the lines after
    // it are rows again.
    assert.equal(events[0], '2:record-too-large')
    assert.ok(events.slice(1).every(event => event.includes(':{"message":')))
    assert.ok(events.length > 1000 && events.length < 20_000, `${String(events.length)} events`)
    assert.equal(events.at(-1), `${String(20_002)}:{"message":"after"}`)
  })

  it('reports a header without names or with a repeated name, and every row after it', async () => {
    assert.deepEqual(await readAll('message,,level\na,b,c\n'), ['1:csv-header', '2:csv-header'])
    assert.deepEqual(await readAll('message,level,message\na,b,c\nd,e,f\n'), ['1:csv-header', '2:csv-header', '3:csv-header'])
  })

  it('keeps a column named __proto__ as an own field and all values as text', async () => {
    assert.deepEqual(await readAll('message,__proto__,count\nm,p,5\n'), ['2:{"message":"m","__proto__":"p","count":"5"}'])
  })

  // csv-parse alone holds back the last character of a chunk, which would hold back the row it ends.
  it('gives a live row as soon as its line ends, without waiting for the next chunk', async () => {
    const { promise: released, resolve: release } = Promise.withResolvers<undefined>()
    async function * live (): AsyncGenerator<Uint8Array> {
      yield Buffer.from('message,level\nfirst,info\n')
      await released
      yield Buffer.from('second,warn\n')
    }
    const iterator = csvFormat.read(live(), context)[Symbol.asyncIterator]()
    const first = await iterator.next()
    assert.equal(first.done, false)
    assert.deepEqual(describeEvents([first.value]), ['2:{"message":"first","level":"info"}'])
    release(undefined)
    const second = await iterator.next()
    assert.equal(second.done, false)
    assert.deepEqual(describeEvents([second.value]), ['3:{"message":"second","level":"warn"}'])
    await iterator.return?.()
  })

  it('reads the header of each file that a followed name holds', async () => {
    const settings = {
      formats: builtInFormats(),
      format: csvFormat,
      fallback: jsonLinesFormat,
      mapping: {},
      timestampUnit: undefined,
      levels: {},
      maximumRecordSize: 1024 * 1024
    }
    const source = new SourceState(context.source, 'data.csv', settings, context.signal)
    const ingestion = new Ingestion({ isCollecting: true })
    const files = [Readable.from([Buffer.from('message,level\nold,info\n')]), Readable.from([Buffer.from('level,message\nwarn,new\n')])]
    const messages: string[] = []
    const batches = sourceBatches(source, files, settings, true)
    for await (const batch of batches) {
      messages.push(...ingestion.accept(batch).map(({ record }) => `${record.identifier} ${record.level} ${record.message}`))
    }
    assert.deepEqual(messages, ['1:1 info old', '1:2 warn new'])
  })
})

describe('CSV delimiters and probe', () => {
  it('takes one ASCII character other than a quote as the delimiter', async () => {
    const tabs = await readAll('message\tlevel\n"a\tb"\tinfo\n', createCsvFormat({ delimiter: '\t' }))
    assert.deepEqual(tabs, [String.raw`2:{"message":"a\tb","level":"info"}`])
    for (const delimiter of ['', ';;', '"', '\n', '§']) {
      assert.throws(() => createCsvFormat({ delimiter }), RangeError, JSON.stringify(delimiter))
    }
  })

  it('claims a valid header with a message column, more so for a .csv file', () => {
    assert.equal(probe('timestamp,level,message\n2026-10-11T10:00:00Z,info,a\n'), 70)
    assert.equal(probe('timestamp,level,message\n2026-10-11T10:00:00Z,info,a\n', '.csv'), 85)
    assert.equal(probe('time,msg\nnow,a\nlater,b,extra\n'), 35)
    assert.equal(probe('zeit,nachricht\nnow,a\n', undefined, { message: ['nachricht'] }), 70)
    assert.equal(probe('zeit,nachricht\nnow,a\n'), 0)
    assert.equal(probe('message,message\na,b\n'), 0)
    assert.equal(probe('{"message":"json","level":"info"}\n'), 0)
    assert.equal(probe('level=info msg="logfmt, with a comma"\n'), 0)
  })

  it('is recognized among the built-in formats by its header', async () => {
    const { format, records } = await readRecords('timestamp,level,message\n2026-10-11T10:00:00Z,info,from csv\n', { file: 'data.log' })
    assert.equal(format, 'csv')
    assert.equal(records[0]?.record.message, 'from csv')
  })
})
