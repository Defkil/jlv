// The core between the inputs and the outputs (plan sections 5 and 6.2). Each source gets its format once: the one
// that --format or the configuration names, or the one whose probe fits a bounded sample of the source best. The
// sample's bytes are replayed into the chosen reader, so nothing is lost. The reader's events are taken over in one
// batch per input chunk; each entry gets its source's next record number and its normalized record and goes into the
// store, and diagnostics are counted and reported.
import path from 'node:path'
import type {
  FieldMapping, FormatContext, FormatSample, LogDraft, LogFormat, LogLevel, LogRecord, NormalizationResult, ParseDiagnostic,
  ParseEvent, ParsedEntry, SourceInformation, TimestampUnit
} from './api.js'
import { entryJson, normalizedPathsOf, type NormalizedPaths } from './formats/metadata.js'
import { asJsonObject, isPlainObject, levelCode } from './record.js'
import type { RecordStore } from './store.js'

// The bounds of a sample (plan section 6.2): 64 KiB and 32 complete lines.
const sampleByteLimit = 64 * 1024
const sampleLineLimit = 32
// Live input stops filling its sample this long after its first complete line.
const liveSampleWait = 200

// A reader's events are handed over at least this often, also within one large chunk. Few parsed records alive at a
// time keep V8's young generation small, since it grows with the bytes that survive its collections: with 4096 events
// per batch, the heap of the million-record benchmark grew to 167 MiB on Node 24.21.0, with 64 events to 64 to 93 MiB.
const maximumBatchEvents = 64

const lineFeed = 0x0A

interface IngestionSettings {
  // Every format, built-in ones first and then those of plugins, in the order that breaks ties between probes.
  readonly formats: readonly LogFormat[]
  // The format that --format or the configuration chose for every source; undefined probes each source.
  readonly format: LogFormat | undefined
  // The format of sources that no probe recognizes: generic JSON lines.
  readonly fallback: LogFormat
  readonly mapping: FieldMapping
  readonly timestampUnit: TimestampUnit | undefined
  readonly levels: Readonly<Record<string, LogLevel>>
  readonly maximumRecordSize: number
}

const warning = (code: string, message: string): ParseDiagnostic => ({ kind: 'diagnostic', severity: 'warning', code, message })

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

// A source during a run: its format once chosen, the context its format gets, and how many records it had. Record
// numbers go on across the files that a followed name rotates through.
class SourceState {
  readonly information: SourceInformation
  readonly extension: string | undefined
  readonly context: FormatContext
  format: LogFormat | undefined
  recordNumber = 0

  constructor (information: SourceInformation, filePath: string | undefined, settings: IngestionSettings, signal: AbortSignal) {
    this.information = information
    const extension = filePath === undefined ? '' : path.extname(filePath).toLowerCase()
    this.extension = extension === '' ? undefined : extension
    this.format = settings.format
    this.context = {
      signal,
      source: information,
      maximumRecordSize: settings.maximumRecordSize,
      mapping: settings.mapping,
      levels: settings.levels,
      ...(settings.timestampUnit !== undefined && { timestampUnit: settings.timestampUnit })
    }
  }
}

interface Selection {
  readonly format: LogFormat
  readonly diagnostics: readonly ParseDiagnostic[]
}

// The format whose probe scores highest. Equal scores go to the format registered first, with a note that --format
// can choose another; when no probe recognizes the sample, the fallback reads it.
const chooseFormat = (sample: FormatSample, settings: IngestionSettings, context: FormatContext): Selection => {
  const diagnostics: ParseDiagnostic[] = []
  let best: LogFormat[] = []
  let bestScore = 0
  for (const format of settings.formats) {
    let score: number
    try {
      score = format.probe(sample, context)
    } catch (error) {
      diagnostics.push(warning('probe-failure', `the probe of the format ${format.identifier} failed: ${errorMessage(error)}`))
      continue
    }
    if (typeof score !== 'number' || !(score > 0)) {
      continue
    }
    const bounded = Math.min(score, 100)
    if (bounded > bestScore) {
      best = [format]
      bestScore = bounded
    } else if (bounded === bestScore) {
      best.push(format)
    }
  }
  const [chosen] = best
  if (chosen === undefined) {
    return { format: settings.fallback, diagnostics }
  }
  if (best.length > 1) {
    const names = best.map(format => format.identifier).join(', ')
    diagnostics.push(warning('format-tie', `the formats ${names} fit equally; ${chosen.identifier} reads the input, and --format chooses another`))
  }
  return { format: chosen, diagnostics }
}

// The outcome of a read that the sample started but did not wait for. It never rejects, so that a read that fails
// before the replay takes it cannot end the process as an unhandled rejection.
type Settled<T> = { readonly value: T } | { readonly error: unknown }

const settle = async <T>(promise: Promise<T>): Promise<Settled<T>> => {
  try {
    return { value: await promise }
  } catch (error) {
    return { error }
  }
}

// Counts line feeds up to a limit.
const countLineFeeds = (chunk: Uint8Array, limit: number): number => {
  let count = 0
  for (let index = chunk.indexOf(lineFeed); index !== -1 && count < limit; index = chunk.indexOf(lineFeed, index + 1)) {
    count += 1
  }
  return count
}

// The text that probes see: complete lines within the first 64 KiB, at most 32 of them, without a byte order mark.
// An input that ended within the sample also gives its last line without a line feed.
const sampleOf = (chunks: readonly Uint8Array[], isDone: boolean, extension: string | undefined): FormatSample => {
  const bytes = Buffer.concat(chunks)
  const isWhole = isDone && bytes.length <= sampleByteLimit
  const limited = bytes.subarray(0, sampleByteLimit)
  let text = limited.subarray(0, isWhole ? limited.length : limited.lastIndexOf(lineFeed) + 1).toString('utf8')
  if (text.startsWith('\u{FEFF}')) {
    text = text.slice(1)
  }
  let end = -1
  for (let line = 0; line < sampleLineLimit; line += 1) {
    end = text.indexOf('\n', end + 1)
    if (end === -1) {
      break
    }
  }
  if (end !== -1) {
    text = text.slice(0, end + 1)
  }
  return extension === undefined ? { text } : { text, extension }
}

// The chunks that the sample read, then the rest of the input.
async function * replay (
  chunks: readonly Uint8Array[],
  pending: Promise<Settled<IteratorResult<Uint8Array>>> | undefined,
  isDone: boolean,
  iterator: AsyncIterator<Uint8Array>
): AsyncGenerator<Uint8Array> {
  let isComplete = isDone
  try {
    for (const chunk of chunks) {
      yield chunk
    }
    let next = pending
    while (!isComplete) {
      const settled = await (next ?? settle(iterator.next()))
      next = undefined
      if ('error' in settled) {
        throw settled.error
      }
      const result = settled.value
      if (result.done === true) {
        isComplete = true
      } else {
        yield result.value
      }
    }
  } finally {
    if (!isComplete) {
      await iterator.return?.()
    }
  }
}

interface SampledInput {
  readonly sample: FormatSample
  // The bytes of the sample and of the rest of the input, all of them.
  readonly chunks: AsyncIterable<Uint8Array>
}

// Reads chunks until the sample is full or the input ends. Live input waits for its first complete line and then at
// most 200 ms for more, so that a quiet pipe or a followed file shows its records soon.
const sampleInput = async (iterator: AsyncIterator<Uint8Array>, isLive: boolean, extension: string | undefined): Promise<SampledInput> => {
  const chunks: Uint8Array[] = []
  let byteCount = 0
  let lineCount = 0
  let isDone = false
  let pending: Promise<Settled<IteratorResult<Uint8Array>>> | undefined
  let timer: NodeJS.Timeout | undefined
  let deadline: Promise<undefined> | undefined
  try {
    while (byteCount < sampleByteLimit && lineCount < sampleLineLimit) {
      const next = iterator.next()
      const result = deadline === undefined ? await next : await Promise.race([next, deadline])
      if (result === undefined) {
        // The read goes on in the replay.
        pending = settle(next)
        break
      }
      if (result.done === true) {
        isDone = true
        break
      }
      chunks.push(result.value)
      byteCount += result.value.byteLength
      lineCount += countLineFeeds(result.value, sampleLineLimit - lineCount)
      if (isLive && deadline === undefined && lineCount > 0) {
        deadline = new Promise(resolve => { timer = setTimeout(() => { resolve(undefined) }, liveSampleWait) })
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return { sample: sampleOf(chunks, isDone, extension), chunks: replay(chunks, pending, isDone, iterator) }
}

// Wakes up a single waiter.
class Wakeup {
  #resolve: (() => void) | undefined

  async wait (): Promise<void> {
    await new Promise<void>(resolve => { this.#resolve = resolve })
  }

  notify (): void {
    const resolve = this.#resolve
    this.#resolve = undefined
    resolve?.()
  }
}

class StoppedReading extends Error {}

// Runs a format's reader over its input and hands its events over in batches: one batch for each chunk that the
// reader took, since it asks for the next chunk only after it gave the events of the earlier ones. The reader takes
// the next chunk only once its batch was handed over, so a slow consumer slows the input down.
async function * readBatches (format: LogFormat, input: AsyncIterable<Uint8Array>, context: FormatContext): AsyncGenerator<ParseEvent[]> {
  let batch: ParseEvent[] = []
  const ready: ParseEvent[][] = []
  const consumer = new Wakeup()
  const producer = new Wakeup()
  const state: { isStopped: boolean, isFinished: boolean, failure?: { readonly error: unknown } } = { isStopped: false, isFinished: false }
  const handOver = async (): Promise<void> => {
    if (batch.length > 0) {
      ready.push(batch)
      batch = []
      consumer.notify()
    }
    while (ready.length > 0 && !state.isStopped) {
      await producer.wait()
    }
    if (state.isStopped) {
      throw new StoppedReading('the reading stopped')
    }
  }
  async function * chunks (): AsyncGenerator<Uint8Array> {
    for await (const chunk of input) {
      yield chunk
      await handOver()
    }
  }
  const producing = (async () => {
    try {
      for await (const event of format.read(chunks(), context)) {
        batch.push(event)
        if (batch.length >= maximumBatchEvents) {
          await handOver()
        }
      }
    } catch (error) {
      if (!(error instanceof StoppedReading)) {
        state.failure = { error }
      }
    } finally {
      // The events before the end, also those before a failure, are the last batch.
      if (batch.length > 0 && !state.isStopped) {
        ready.push(batch)
        batch = []
      }
      state.isFinished = true
      consumer.notify()
    }
  })()
  try {
    for (;;) {
      const next = ready.shift()
      if (next !== undefined) {
        producer.notify()
        yield next
        continue
      }
      if (state.isFinished) {
        if (state.failure !== undefined) {
          throw state.failure.error
        }
        return
      }
      await consumer.wait()
    }
  } finally {
    state.isStopped = true
    producer.notify()
    await producing
  }
}

// The events of one source and its state.
interface SourceBatch {
  readonly source: SourceState
  readonly events: readonly ParseEvent[]
}

// The batches of a source: its format is chosen with the first file's data, and every file that a followed name holds
// gets a new reader of that format. A file or a stream is a single generation.
async function * sourceBatches (
  source: SourceState,
  generations: AsyncIterable<AsyncIterable<Uint8Array>> | Iterable<AsyncIterable<Uint8Array>>,
  settings: IngestionSettings,
  isLive: boolean
): AsyncGenerator<SourceBatch> {
  for await (const generation of generations) {
    let input = generation
    let format = source.format
    if (format === undefined) {
      const sampled = await sampleInput(generation[Symbol.asyncIterator](), isLive, source.extension)
      const selection = chooseFormat(sampled.sample, settings, source.context)
      format = selection.format
      source.format = format
      input = sampled.chunks
      if (selection.diagnostics.length > 0) {
        yield { source, events: selection.diagnostics }
      }
    }
    for await (const events of readBatches(format, input, source.context)) {
      yield { source, events }
    }
  }
}

// An error diagnostic in strict mode, which ends the run.
class StrictModeError extends Error {
  constructor (source: SourceInformation, diagnostic: ParseDiagnostic) {
    const line = diagnostic.position === undefined ? '' : `:${String(diagnostic.position.firstLine)}`
    super(`${source.label}${line}: ${diagnostic.message}`)
    this.name = 'StrictModeError'
  }
}

type InputActivity = 'loading' | 'live' | 'done'

interface IngestionOptions {
  // The store of the viewer; machine output keeps no records.
  readonly store?: RecordStore
  // Whether accept() returns the records, for an output or a save file.
  readonly isCollecting?: boolean
  // Ends the run at the first error diagnostic.
  readonly isStrict?: boolean
  readonly onDiagnostic?: (source: SourceInformation, diagnostic: ParseDiagnostic) => void
}

// The positions of normalization's diagnostics are the entry's.
const atEntry = (diagnostic: ParseDiagnostic, entry: ParsedEntry): ParseDiagnostic =>
  diagnostic.position === undefined ? { ...diagnostic, position: entry.position } : diagnostic

// Takes over the batches of all sources: records into the store and to the outputs, diagnostics into counts.
class Ingestion {
  readonly store: RecordStore | undefined
  readonly isCollecting: boolean
  readonly isStrict: boolean
  readonly onDiagnostic: ((source: SourceInformation, diagnostic: ParseDiagnostic) => void) | undefined
  // Records accepted, error diagnostics (records that were lost), warnings, and inputs that could not be read to their
  // end.
  records = 0
  skipped = 0
  warnings = 0
  failed = 0
  activity: InputActivity = 'loading'
  // The formats of the sources so far.
  readonly formats = new Set<string>()
  // Whether a record so far had a correlation identifier, which the viewer then shows in a column.
  hasCorrelation = false
  // In strict mode, the first error diagnostic. The batch ends there; the run ends once the records before it are
  // written.
  strictFailure: StrictModeError | undefined

  constructor (options: IngestionOptions = {}) {
    this.store = options.store
    this.isCollecting = options.isCollecting ?? false
    this.isStrict = options.isStrict ?? false
    this.onDiagnostic = options.onDiagnostic
  }

  #diagnose (source: SourceState, diagnostic: ParseDiagnostic): void {
    if (diagnostic.severity === 'error') {
      this.skipped += 1
    } else {
      this.warnings += 1
    }
    this.onDiagnostic?.(source.information, diagnostic)
    if (this.isStrict && diagnostic.severity === 'error') {
      this.strictFailure ??= new StrictModeError(source.information, diagnostic)
    }
  }

  // An error from normalization loses the entry too; strict mode reports only through its first error.
  #diagnoseNormalization (source: SourceState, entry: ParsedEntry, diagnostics: readonly ParseDiagnostic[]): boolean {
    let isRejected = false
    for (const diagnostic of diagnostics) {
      this.#diagnose(source, atEntry(diagnostic, entry))
      if (diagnostic.severity !== 'error') {
        continue
      }
      isRejected = true
      if (this.isStrict) {
        return true
      }
    }
    return isRejected
  }

  // Normalizes the entries of the batch, keeps them in the store and returns their records when collecting.
  accept (batch: SourceBatch): NormalizedRecord[] {
    const { source, events } = batch
    const records: NormalizedRecord[] = []
    if (source.format !== undefined) {
      this.formats.add(source.format.identifier)
    }
    const { format } = source
    for (const event of events) {
      if (this.strictFailure !== undefined) {
        break
      }
      if (event.kind === 'diagnostic') {
        this.#diagnose(source, event)
        continue
      }
      if (format === undefined) {
        continue
      }
      let result: NormalizationResult
      try {
        result = format.normalize(event.value, source.context)
      } catch (error) {
        // Built-in formats never throw here; a plugin's format that fails or gives a result of another shape loses the
        // record.
        this.#diagnose(source, {
          kind: 'diagnostic',
          severity: 'error',
          code: 'normalize-failure',
          message: `skipped a record that ${format.identifier} cannot normalize: ${errorMessage(error)}`,
          position: event.position
        })
        continue
      }
      if (this.#diagnoseNormalization(source, event, result.diagnostics)) {
        continue
      }
      source.recordNumber += 1
      this.records += 1
      const { record } = result
      if (record.correlationIdentifier !== undefined) {
        this.hasCorrelation = true
      }
      const { position } = event
      this.store?.append({
        source: source.information.order,
        recordNumber: source.recordNumber,
        bytes: entryJson(event),
        time: record.timestamp ?? NaN,
        level: levelCode(record.level),
        firstLine: position.firstLine,
        lastLine: position.lastLine
      })
      if (this.isCollecting) {
        records.push({
          record: completeRecord(record, source.information, { recordNumber: source.recordNumber, ...position }),
          paths: normalizedPathsOf(result)
        })
      }
    }
    return records
  }
}

// A draft with its identity, its source and its position, in the order that JSON output shows.
const completeRecord = (draft: LogDraft, source: SourceInformation, position: LogRecord['position']): LogRecord => ({
  identifier: `${source.identifier}:${String(position.recordNumber)}`,
  source,
  position,
  ...draft
})

// A record and the paths that its normalized parts came from, which the viewer's rows need.
interface NormalizedRecord {
  readonly record: LogRecord
  readonly paths: NormalizedPaths
}

// The record of a sequence in the store, normalized again from its JSON text.
const recordAt = (store: RecordStore, sources: readonly SourceState[], sequence: number): NormalizedRecord => {
  const source = sources[store.sourceAt(sequence)]
  if (source === undefined) {
    throw new RangeError(`The store holds a record of the unknown source ${String(store.sourceAt(sequence))}.`)
  }
  const value: unknown = JSON.parse(store.textAt(sequence))
  const fields = isPlainObject(value) ? asJsonObject(value) : {}
  let result: NormalizationResult | undefined
  try {
    result = source.format?.normalize(fields, source.context)
  } catch {
    // A plugin's format that normalized the record once may still fail now; the row then shows the bare fields.
    result = undefined
  }
  const draft: LogDraft = result?.record ?? { level: 'unknown', message: '', fields }
  return {
    record: completeRecord(draft, source.information, store.positionAt(sequence)),
    paths: result === undefined ? {} : normalizedPathsOf(result)
  }
}

export {
  Ingestion, SourceState, StrictModeError, chooseFormat, liveSampleWait, maximumBatchEvents, readBatches, recordAt,
  sampleByteLimit, sampleInput, sampleLineLimit, sourceBatches
}
export type {
  IngestionOptions, IngestionSettings, InputActivity, NormalizedRecord, SampledInput, Selection, SourceBatch
}
