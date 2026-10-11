// Connects the sources, the store and the viewer (plan section 4.1): reads the sources' chunks, frames and parses
// their records and hands each record to the store.
import { readFileChunks, type InputSource, type SourceInformation } from './input/files.js'
import { readLines, type LineEvent } from './input/lines.js'
import { parseLine, timeKey, type Mapping } from './log.js'
import type { RecordStore } from './store.js'

// A line that was skipped, with its source and line number.
interface Diagnostic {
  readonly source: SourceInformation
  readonly lineNumber: number
  readonly message: string
}

type InputActivity = 'loading' | 'live' | 'done'

interface IngestionOptions {
  readonly store: RecordStore
  readonly mapping: Mapping | undefined
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

const skipMessages = {
  'invalid-json': 'skipped a line that is no JSON',
  'empty-value': 'skipped a JSON value that is no record'
} as const

// Turns framed lines into records. A record keeps its text in the store; its number counts the records of its
// source from 1 and goes on when a followed file is replaced.
class Ingestion {
  readonly #recordNumbers = new Map<number, number>()
  readonly store: RecordStore
  readonly mapping: Mapping | undefined
  readonly onDiagnostic: ((diagnostic: Diagnostic) => void) | undefined
  // Skipped lines: no JSON, a JSON value that is no record, or a line over the size limit.
  skipped = 0
  activity: InputActivity = 'loading'

  constructor (options: IngestionOptions) {
    this.store = options.store
    this.mapping = options.mapping
    this.onDiagnostic = options.onDiagnostic
  }

  #skip (source: SourceInformation, lineNumber: number, message: string): void {
    this.skipped += 1
    this.onDiagnostic?.({ source, lineNumber, message })
  }

  accept (source: SourceInformation, events: readonly LineEvent[]): void {
    for (const event of events) {
      if (event.kind === 'oversized') {
        this.#skip(source, event.lineNumber, `skipped a line of ${String(event.byteLength)} bytes, more than the limit of 1 MiB`)
        continue
      }
      const parsed = parseLine(event.bytes.toString('utf8'), this.mapping)
      if (parsed.kind === 'skipped') {
        this.#skip(source, event.lineNumber, skipMessages[parsed.reason])
        continue
      }
      if (parsed.kind === 'blank') {
        continue
      }
      const recordNumber = (this.#recordNumbers.get(source.order) ?? 0) + 1
      this.#recordNumbers.set(source.order, recordNumber)
      this.store.append({ source: source.order, recordNumber, bytes: event.bytes, time: timeKey(parsed.value) })
    }
  }
}

// The viewer redraws at most ten times per second while records arrive (plan section 6.1).
const refreshInterval = 100

interface Throttle {
  // Runs the callback now when its last run is at least one interval ago, else once at the end of the interval.
  readonly schedule: () => void
  // Runs a scheduled callback now.
  readonly flush: () => void
  readonly cancel: () => void
}

const throttle = (callback: () => void, interval = refreshInterval): Throttle => {
  let timer: NodeJS.Timeout | undefined
  let lastRun = -Infinity
  const run = (): void => {
    timer = undefined
    lastRun = performance.now()
    callback()
  }
  const cancel = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  return {
    schedule: () => {
      if (timer === undefined) {
        timer = setTimeout(run, Math.max(lastRun + interval - performance.now(), 0))
      }
    },
    flush: () => {
      cancel()
      run()
    },
    cancel
  }
}

// Reads finite sources one after the other, in their order, and calls back after every chunk that held records.
const ingestFiles = async (
  sources: readonly InputSource[],
  ingestion: Ingestion,
  onProgress: () => void,
  signal?: AbortSignal
): Promise<void> => {
  for (const source of sources) {
    if (source.kind === 'stdin') {
      continue
    }
    const lines = readLines(readFileChunks(source.path, signal))
    for await (const events of lines) {
      ingestion.accept(source.information, events)
      onProgress()
    }
  }
}

export { Ingestion, ingestFiles, refreshInterval, throttle }
export type { Diagnostic, InputActivity, IngestionOptions, Throttle }
