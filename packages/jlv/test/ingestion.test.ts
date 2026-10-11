// The core of src/ingestion.ts (plan sections 5 and 6.2): the choice of a format per source from a bounded sample,
// the replay of the sample's bytes into the chosen reader, the wait of live input, deterministic ties, and the
// hand-over of a reader's events in one batch per chunk.
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { setTimeout as delay, setImmediate as nextTurn } from 'node:timers/promises'
import type { FormatContext, JsonValue, LogFormat, ParseEvent } from '../src/api.js'
import { builtInFormats, jsonLinesFormat } from '../src/formats/registry.js'
import { RecordStore } from '../src/store.js'
import {
  Ingestion, SourceState, chooseFormat, liveSampleWait, maximumBatchEvents, readBatches, sampleInput, sourceBatches,
  type IngestionSettings
} from '../src/ingestion.js'

const context: FormatContext = {
  signal: new AbortController().signal,
  source: { identifier: '1', label: 'input', order: 0 },
  maximumRecordSize: 1024 * 1024,
  mapping: {},
  levels: {}
}

// A format that scores the sample by a fixed number and reads each chunk as one entry with its text.
const fixedFormat = (identifier: string, score: number | (() => number)): LogFormat => ({
  identifier,
  probe: () => typeof score === 'number' ? score : score(),
  read: async function * (input) {
    let line = 0
    for await (const chunk of input) {
      line += 1
      yield { kind: 'entry', value: { text: Buffer.from(chunk).toString('utf8') }, position: { firstLine: line, lastLine: line } }
    }
  },
  normalize: value => ({ record: { level: 'unknown', message: textOf(value['text']), fields: value }, diagnostics: [] })
})

// The text of an entry value of these formats.
const textOf = (value: JsonValue | undefined): string => typeof value === 'string' ? value : ''

const bufferOf = (...texts: readonly string[]): Readable => Readable.from(texts.map(text => Buffer.from(text, 'utf8')))

const settingsWith = (formats: readonly LogFormat[]): IngestionSettings => ({
  formats,
  format: undefined,
  fallback: jsonLinesFormat,
  mapping: {},
  timestampUnit: undefined,
  levels: {},
  maximumRecordSize: 1024 * 1024
})

const chunks = (...texts: readonly string[]): AsyncIterator<Uint8Array> => bufferOf(...texts)[Symbol.asyncIterator]()

const collect = async (input: AsyncIterable<Uint8Array>): Promise<string> => {
  let text = ''
  for await (const chunk of input) {
    text += Buffer.from(chunk).toString('utf8')
  }
  return text
}

describe('choosing a format', () => {
  it('takes the highest probe and the first registered format on a tie, with a note', () => {
    const settings = settingsWith([fixedFormat('first', 50), fixedFormat('second', 70), fixedFormat('third', 70)])
    const selection = chooseFormat({ text: 'x\n' }, settings, context)
    assert.equal(selection.format.identifier, 'second')
    assert.deepEqual(selection.diagnostics.map(diagnostic => [diagnostic.severity, diagnostic.code, diagnostic.message]), [
      ['warning', 'format-tie', 'the formats second, third fit equally; second reads the input, and --format chooses another']
    ])
  })

  it('falls back to JSON lines when no probe recognizes the sample, and caps scores at 100', () => {
    const fallback = chooseFormat({ text: 'plain text\n' }, settingsWith([fixedFormat('none', 0)]), context)
    assert.equal(fallback.format, jsonLinesFormat)
    const capped = chooseFormat({ text: '' }, settingsWith([fixedFormat('huge', 1000), fixedFormat('full', 100)]), context)
    assert.equal(capped.format.identifier, 'huge')
    assert.equal(capped.diagnostics[0]?.code, 'format-tie')
  })

  it('skips a probe that fails or gives no number, with a warning for the failure', () => {
    const failing = fixedFormat('failing', () => { throw new Error('broken probe') })
    const notANumber = fixedFormat('nan', NaN)
    const selection = chooseFormat({ text: '' }, settingsWith([failing, notANumber, fixedFormat('working', 5)]), context)
    assert.equal(selection.format.identifier, 'working')
    assert.deepEqual(selection.diagnostics.map(diagnostic => diagnostic.message), ['the probe of the format failing failed: broken probe'])
  })

  it('prefers the strong signatures of the built-in formats over generic JSON lines', () => {
    const settings = settingsWith(builtInFormats())
    const chosen = (text: string): string => chooseFormat({ text }, settings, context).format.identifier
    const bunyan = '{"name":"a","hostname":"h","pid":1,"level":30,"msg":"m","time":"2026-10-11T10:00:00Z","v":0}\n'
    assert.equal(chosen(bunyan), 'bunyan')
    // bunyan records fit pino's signature as well; a record without bunyan's version is pino's.
    assert.equal(chosen(bunyan.replace('"v":0', '"v":1')), 'pino')
    assert.equal(chosen('{"level":30,"time":1,"msg":"m"}\n'), 'pino')
    assert.equal(chosen('{"level":"info","message":"m"}\n'), 'jsonl')
    // No probe claims Winston's output, which has many shapes.
    assert.equal(chosen('{"level":"verbose","message":"m","timestamp":"2026-10-11T10:00:00Z"}\n'), 'jsonl')
  })
})

describe('sampling an input', () => {
  it('replays every byte that the sample read, then the rest of the input', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${String(index)}\n`)
    const sampled = await sampleInput(chunks(...lines), false, '.log')
    assert.equal(sampled.sample.extension, '.log')
    assert.equal(sampled.sample.text, lines.slice(0, 32).join(''))
    assert.equal(await collect(sampled.chunks), lines.join(''))
  })

  // Sixteen lines of 4 KiB fill 64 KiB, but the byte order mark moves the end of the last of them beyond it.
  it('gives at most 64 KiB of complete lines, without a byte order mark', async () => {
    const line = `${'x'.repeat(4095)}\n`
    const text = `\u{FEFF}${line.repeat(100)}`
    const sampled = await sampleInput(chunks(text), false, undefined)
    assert.equal(sampled.sample.text, line.repeat(15))
    assert.equal(sampled.sample.extension, undefined)
    assert.equal(await collect(sampled.chunks), text)
  })

  it('gives the last line of an input that ended without a line feed', async () => {
    const sampled = await sampleInput(chunks('a\n', 'b'), true, undefined)
    assert.equal(sampled.sample.text, 'a\nb')
  })

  it('stops waiting for live input 200 ms after its first complete line and keeps the read in flight', async () => {
    const { promise: released, resolve: release } = Promise.withResolvers<undefined>()
    async function * live (): AsyncGenerator<Uint8Array> {
      yield Buffer.from('first\npart')
      await released
      yield Buffer.from('ial\nlater\n')
    }
    const started = performance.now()
    const sampled = await sampleInput(live(), true, undefined)
    const waited = performance.now() - started
    assert.ok(waited >= liveSampleWait - 20 && waited < liveSampleWait + 400, `waited ${String(waited)} ms`)
    assert.equal(sampled.sample.text, 'first\n')
    const replayed = collect(sampled.chunks)
    await delay(10)
    release(undefined)
    assert.equal(await replayed, 'first\npartial\nlater\n')
  })

  it('waits for the first complete line of live input without a deadline', async () => {
    let isReleased = false
    async function * slow (): AsyncGenerator<Uint8Array> {
      yield Buffer.from('no line feed yet')
      await delay(liveSampleWait * 2)
      isReleased = true
      yield Buffer.from('\nnext\n')
    }
    const sampled = await sampleInput(slow(), true, undefined)
    assert.equal(isReleased, true)
    assert.equal(sampled.sample.text, 'no line feed yet\nnext\n')
  })
})

describe('reading in batches', () => {
  it('hands over the events of each chunk as one batch', async () => {
    const twice: LogFormat = {
      ...fixedFormat('twice', 1),
      read: async function * (input) {
        for await (const chunk of input) {
          const text = Buffer.from(chunk).toString('utf8')
          for (const part of [`${text}-a`, `${text}-b`]) {
            yield { kind: 'entry', value: { text: part }, position: { firstLine: 1, lastLine: 1 } }
          }
        }
      }
    }
    const batches: string[][] = []
    const reading = readBatches(twice, bufferOf('1', '2'), context)
    for await (const batch of reading) {
      batches.push(batch.map(event => event.kind === 'entry' ? textOf(event.value['text']) : event.code))
    }
    assert.deepEqual(batches, [['1-a', '1-b'], ['2-a', '2-b']])
  })

  // Few parsed records alive at a time keep the young generation of the heap small.
  it('hands over the events of a large chunk in small batches', async () => {
    const many: LogFormat = {
      ...fixedFormat('many', 1),
      read: async function * (input) {
        for await (const chunk of input) {
          for (let index = 0; index < 200; index += 1) {
            yield { kind: 'entry', value: { text: Buffer.from(chunk).toString('utf8') }, position: { firstLine: index + 1, lastLine: index + 1 } }
          }
        }
      }
    }
    const sizes: number[] = []
    const reading = readBatches(many, bufferOf('one chunk'), context)
    for await (const batch of reading) {
      sizes.push(batch.length)
    }
    assert.equal(maximumBatchEvents, 64)
    assert.deepEqual(sizes, [64, 64, 64, 8])
  })

  it('reads the next chunk only once the batch before it was taken', async () => {
    let pulled = 0
    async function * counted (): AsyncGenerator<Uint8Array> {
      for (let index = 0; index < 100; index += 1) {
        // Each chunk takes a turn of the event loop, as a read does.
        await nextTurn()
        pulled += 1
        yield Buffer.from(String(index))
      }
    }
    const batches = readBatches(fixedFormat('each', 1), counted(), context)
    await batches.next()
    await delay(20)
    assert.ok(pulled <= 3, `pulled ${String(pulled)} chunks ahead`)
    await batches.return(undefined)
  })

  it('hands over the events before a reader fails, then ends with its error', async () => {
    const failing: LogFormat = {
      ...fixedFormat('failing', 1),
      read: async function * (input) {
        const first = await input[Symbol.asyncIterator]().next()
        yield { kind: 'entry', value: { text: first.done === true ? '' : 'first' }, position: { firstLine: 1, lastLine: 1 } }
        throw new Error('reader failed')
      }
    }
    const events: ParseEvent[] = []
    const reading = readBatches(failing, bufferOf('one', 'two'), context)
    await assert.rejects(async () => {
      for await (const batch of reading) {
        events.push(...batch)
      }
    }, /reader failed/u)
    assert.equal(events.length, 1)
  })
})

describe('the sources of a run', () => {
  it('discards normalization errors and stops strict mode before storing or emitting that record', () => {
    const format: LogFormat = {
      ...fixedFormat('diagnosing', 100),
      normalize: value => ({
        record: { level: 'unknown', message: textOf(value['text']), fields: value },
        diagnostics: value['text'] === 'bad'
          ? [{ kind: 'diagnostic', severity: 'error', code: 'rejected', message: 'cannot normalize this record' }]
          : []
      })
    }
    const settings = { ...settingsWith([format]), format }
    for (const isStrict of [false, true]) {
      const source = new SourceState(context.source, 'input', settings, context.signal)
      const store = new RecordStore()
      const ingestion = new Ingestion({ store, isCollecting: true, isStrict })
      const records = ingestion.accept({
        source,
        events: ['before', 'bad', 'after'].map((text, index): ParseEvent => ({
          kind: 'entry', value: { text }, position: { firstLine: index + 1, lastLine: index + 1 }
        }))
      })
      assert.deepEqual(records.map(({ record }) => [record.message, record.identifier]),
        isStrict ? [['before', '1:1']] : [['before', '1:1'], ['after', '1:2']])
      assert.equal(store.retained, isStrict ? 1 : 2)
      assert.equal(ingestion.records, isStrict ? 1 : 2)
      assert.equal(ingestion.skipped, 1)
      assert.equal(ingestion.strictFailure !== undefined, isStrict)
    }
  })

  it('chooses a format per source and numbers its records', async () => {
    const settings = settingsWith(builtInFormats())
    const ingestion = new Ingestion({ isCollecting: true })
    const pino = new SourceState({ identifier: '1', label: 'pino.log', order: 0 }, 'pino.log', settings, context.signal)
    const generic = new SourceState({ identifier: '2', label: 'app.log', order: 1 }, 'app.log', settings, context.signal)
    const records: string[] = []
    const inputs = [
      [pino, '{"level":30,"time":0,"msg":"from pino"}\n{"level":50,"time":1,"msg":"pino error"}\n'],
      [generic, '{"level":"WARN","message":"generic"}\n']
    ] as const
    for (const [source, text] of inputs) {
      const batches = sourceBatches(source, [bufferOf(text)], settings, false)
      for await (const batch of batches) {
        records.push(...ingestion.accept(batch).map(({ record }) => `${record.identifier} ${record.level} ${record.message}`))
      }
    }
    assert.deepEqual([pino.format?.identifier, generic.format?.identifier], ['pino', 'jsonl'])
    assert.deepEqual(records, ['1:1 info from pino', '1:2 error pino error', '2:1 warn generic'])
    assert.deepEqual([...ingestion.formats], ['pino', 'jsonl'])
  })
})
