// Connects the sources, the store, the outputs and the viewer (plan sections 4.1 and 6.1): resolves the inputs, reads
// their chunks, frames and parses their records, and either keeps them in the store for the terminal viewer or
// writes them to standard output. It ends cleanly on q, Ctrl-C, a signal, the end of the input or a reader that goes
// away, and never ends the process itself: it returns the exit code.
import fs from 'node:fs'
import path from 'node:path'
import { addAbortSignal, type Readable, type Writable } from 'node:stream'
import type { Widgets } from 'blessed'
import type { ScreenOptions } from 'neo-blessed'
import { InputError, readFileChunks, resolveInputs, type InputSource, type SourceInformation } from './input/files.js'
import { followFiles } from './input/follow.js'
import { readLines, type LineEvent } from './input/lines.js'
import { MappingFileError, parseEntry, parseLine, readMapping, timeKey, type Mapping } from './log.js'
import { LineWriter, SaveFileError, formatLine, jsonLine, openSaveFile, type MachineFormat } from './output.js'
import { RecordStore } from './store.js'
import type { Keyboard, KeyboardOptions } from './terminal.js'
import { createScreen } from './tui/blessed-boundary.js'
import { MainPanel } from './tui/main-panel.js'
import { RecordView } from './tui/record-view.js'
import { StatusLine } from './tui/status-line.js'

type OutputMode = 'auto' | 'tui' | 'plain' | 'jsonl'

interface ApplicationOptions {
  // Files, quoted glob patterns and - for standard input, in the order given.
  readonly inputs: readonly string[]
  readonly isFollowing: boolean
  // The viewer's order; arrival for live input and descending time for files without one.
  readonly sort: string | undefined
  // The level that records must have; a number for a numeric level such as pino's 30.
  readonly level: string | number | undefined
  readonly output: OutputMode
  readonly maximumRecords: number | undefined
  readonly maximumBytes: number | undefined
  // The file that receives every matching record as a JSON line, whatever the viewer keeps or shows.
  readonly save: string | undefined
  readonly isOverwriting: boolean
  // The terminal library's debug log.
  readonly debugLog: string | undefined
}

interface SignalSource {
  on (signal: NodeJS.Signals, listener: () => void): unknown
  off (signal: NodeJS.Signals, listener: () => void): unknown
}

// What the application uses instead of the process, so that tests can give it streams of their own.
interface ApplicationEnvironment {
  readonly stdin: Readable & { readonly isTTY?: boolean }
  readonly stdout: Writable & { readonly isTTY?: boolean }
  readonly stderr: Writable
  readonly workingDirectory: string
  // The directory of the legacy mapping file ~/.json-log-viewer.
  readonly home: string
  readonly platform: NodeJS.Platform
  readonly signals: SignalSource
  readonly openKeyboard: (options: KeyboardOptions) => Keyboard | undefined
  // Terminal type and Unicode for headless tests.
  readonly screenOptions?: Pick<ScreenOptions, 'terminal' | 'forceUnicode' | 'warnings'>
}

// A line that was skipped, with its source and line number.
interface Diagnostic {
  readonly source: SourceInformation
  readonly lineNumber: number
  readonly message: string
}

type InputActivity = 'loading' | 'live' | 'done'

interface IngestionOptions {
  // The store of the viewer; machine output keeps no records.
  readonly store?: RecordStore
  readonly mapping: Mapping | undefined
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

// The lines of one chunk of a source.
interface Batch {
  readonly source: SourceInformation
  readonly events: readonly LineEvent[]
}

const skipMessages = {
  'invalid-json': 'skipped a line that is no JSON',
  'empty-value': 'skipped a JSON value that is no record'
} as const

// Exit codes (plan section 6.1); a signal ends with 128 and its number, as a shell reports it.
const exitCodes = { success: 0, failure: 1, usage: 2 } as const
const signalExitCodes: Readonly<Record<'SIGHUP' | 'SIGINT' | 'SIGTERM', number>> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }

// At most this many skipped lines are reported one by one on standard error; the rest are counted.
const diagnosticLimit = 10

// Turns framed lines into records. A record keeps its text in the store; its number counts the records of its
// source from 1 and goes on when a followed file is replaced.
class Ingestion {
  readonly #recordNumbers = new Map<number, number>()
  readonly store: RecordStore | undefined
  readonly mapping: Mapping | undefined
  readonly onDiagnostic: ((diagnostic: Diagnostic) => void) | undefined
  // Records accepted, lines skipped (no JSON, a JSON value that is no record, or over the size limit), and inputs
  // that could not be read to their end.
  records = 0
  skipped = 0
  failed = 0
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

  // Keeps the records of the lines in the store and returns their parsed values in order.
  accept (source: SourceInformation, events: readonly LineEvent[]): unknown[] {
    const values: unknown[] = []
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
      this.records += 1
      this.store?.append({ source: source.order, recordNumber, bytes: event.bytes, time: timeKey(parsed.value) })
      values.push(parsed.value)
    }
    return values
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

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

// Finite files, one after the other in their order. A file that cannot be read to its end is reported, and the next
// one follows.
async function * readFiles (
  sources: readonly InputSource[],
  signal: AbortSignal,
  onFailure: (source: SourceInformation, error: unknown) => void
): AsyncGenerator<Batch> {
  for (const source of sources) {
    if (source.kind !== 'file') {
      continue
    }
    try {
      const lines = readLines(readFileChunks(source.path, signal))
      for await (const events of lines) {
        yield { source: source.information, events }
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      onFailure(source.information, error)
    }
  }
}

// A live stream such as standard input or a named pipe; the signal destroys it.
async function * readStream (source: SourceInformation, stream: Readable, signal: AbortSignal): AsyncGenerator<Batch> {
  addAbortSignal(signal, stream)
  const lines = readLines(stream)
  for await (const events of lines) {
    yield { source, events }
  }
}

// The next batch of a source, or the error it failed with.
type Pending<T> =
  | { readonly iterator: AsyncIterator<T>, readonly result: IteratorResult<T> }
  | { readonly iterator: AsyncIterator<T>, readonly error: unknown }

// Asks a source for its next batch. The promise never rejects, so that a source that fails after the merge has
// stopped cannot end the process as an unhandled rejection.
const nextOf = async <T>(iterator: AsyncIterator<T>): Promise<Pending<T>> => {
  try {
    return { iterator, result: await iterator.next() }
  } catch (error) {
    return { iterator, error }
  }
}

// Interleaves several sources of batches in the order they arrive. Each source has at most one batch waiting, so a
// source is only read on while its last batch has been taken: the merge keeps every source's backpressure.
async function * merge<T> (sources: readonly AsyncIterable<T>[]): AsyncGenerator<T> {
  const pending = new Map<AsyncIterator<T>, Promise<Pending<T>>>()
  for (const source of sources) {
    const iterator = source[Symbol.asyncIterator]()
    pending.set(iterator, nextOf(iterator))
  }
  while (pending.size > 0) {
    const next = await Promise.race(pending.values())
    pending.delete(next.iterator)
    if ('error' in next) {
      throw next.error
    }
    if (next.result.done === true) {
      continue
    }
    yield next.result.value
    pending.set(next.iterator, nextOf(next.iterator))
  }
}

// The sources' batches: finite files one after the other or, with --follow, all files at every poll, and every live
// stream at the same time.
const readSources = (
  run: Run,
  signal: AbortSignal,
  onFailure: (source: SourceInformation, error: unknown) => void
): AsyncIterable<Batch> => {
  const { sources } = run
  const lanes: AsyncIterable<Batch>[] = []
  const files = sources.filter(source => source.kind === 'file').map(source => ({ source: source.information, path: source.path }))
  if (files.length > 0) {
    lanes.push(run.options.isFollowing ? followFiles(files, signal, { onFailure }) : readFiles(sources, signal, onFailure))
  }
  for (const source of sources) {
    if (source.kind === 'stdin') {
      lanes.push(readStream(source.information, run.environment.stdin, signal))
    } else if (source.kind === 'stream') {
      lanes.push(readStream(source.information, readFileChunks(source.path, signal), signal))
    }
  }
  return merge(lanes)
}

// The legacy level filter of the command line, as the viewer applies it: the record's level must be set and equal.
const levelMatcher = (level: string | number | undefined): ((record: unknown) => boolean) => {
  if (level === undefined) {
    return () => true
  }
  return record => {
    const value: unknown = record === undefined || record === null
      ? undefined
      : Object.getOwnPropertyDescriptor(new Object(record), 'level')?.value
    return Boolean(value) && value === level
  }
}

// What the border label names: the only input, or the first and how many more.
const inputsLabel = (sources: readonly InputSource[]): string => {
  const [first] = sources
  if (first === undefined) {
    return ''
  }
  return sources.length === 1 ? first.information.label : `${first.information.label} and ${String(sources.length - 1)} more`
}

// Everything that a run needs once the inputs, the mapping and the save file are known.
interface Run {
  readonly options: ApplicationOptions
  readonly environment: ApplicationEnvironment
  readonly sources: readonly InputSource[]
  readonly mapping: Mapping | undefined
  readonly isLive: boolean
  readonly saveFile: Writable | undefined
}

// The JSON lines of the records that match, for the save file.
const saveText = (records: readonly unknown[], isMatch: (record: unknown) => boolean): string => {
  let text = ''
  for (const record of records) {
    if (isMatch(record)) {
      text += jsonLine(record)
    }
  }
  return text
}

// Listens for the signals that end a run, until the returned function stops listening.
const onSignals = (signals: SignalSource, stop: (exitCode: number) => void): (() => void) => {
  const listeners = Object.entries(signalExitCodes).map(([signal, exitCode]) => {
    const listener = (): void => { stop(exitCode) }
    signals.on(signal as NodeJS.Signals, listener)
    return { signal: signal as NodeJS.Signals, listener }
  })
  return () => {
    for (const { signal, listener } of listeners) {
      signals.off(signal, listener)
    }
  }
}

// Writes every record that matches the level as plain text or JSON lines, in arrival order, until the input ends,
// a signal arrives or the reader goes away. Skipped lines are reported on standard error.
const runMachineOutput = async (run: Run, format: MachineFormat): Promise<number> => {
  const { environment, options } = run
  const { stderr } = environment
  const controller = new AbortController()
  let exitCode: number = exitCodes.success
  let reported = 0
  const ingestion = new Ingestion({
    mapping: run.mapping,
    onDiagnostic: ({ source, lineNumber, message }) => {
      reported += 1
      if (reported <= diagnosticLimit) {
        stderr.write(`jv: ${source.label}:${String(lineNumber)}: ${message}\n`)
      }
    }
  })
  const writer = new LineWriter(environment.stdout, error => {
    if (error !== undefined) {
      stderr.write(`jv: cannot write the output: ${error.message}\n`)
      exitCode = exitCodes.failure
    }
    controller.abort()
  })
  const stopListening = onSignals(environment.signals, signalCode => {
    exitCode = signalCode
    controller.abort()
  })
  const saveWriter = run.saveFile === undefined
    ? undefined
    : new LineWriter(run.saveFile, error => {
      stderr.write(`jv: cannot save the records: ${error?.message ?? 'the file was closed'}\n`)
      exitCode = exitCodes.failure
      controller.abort()
    })
  const isMatch = levelMatcher(options.level)
  const onFailure = (source: SourceInformation, error: unknown): void => {
    ingestion.failed += 1
    stderr.write(`jv: cannot read '${source.label}': ${errorMessage(error)}\n`)
  }
  try {
    for await (const batch of readSources(run, controller.signal, onFailure)) {
      const records = ingestion.accept(batch.source, batch.events)
      let text = ''
      for (const record of records) {
        if (isMatch(record)) {
          text += formatLine(format, record)
        }
      }
      await Promise.all([writer.write(text, controller.signal), saveWriter?.write(saveText(records, isMatch), controller.signal)])
    }
  } catch (error) {
    if (!isAbortError(error) && !controller.signal.aborted) {
      throw error
    }
  } finally {
    stopListening()
    controller.abort()
  }
  await Promise.all([writer.flush(), saveWriter?.end()])
  if (reported > diagnosticLimit) {
    stderr.write(`jv: skipped ${String(reported)} lines in total, the first ${String(diagnosticLimit)} of them shown above\n`)
  }
  if (exitCode === exitCodes.success && ingestion.records === 0 && ingestion.skipped > 0) {
    stderr.write(`jv: the input holds no records, only ${String(ingestion.skipped)} skipped lines\n`)
    exitCode = exitCodes.failure
  }
  return exitCode === exitCodes.success && ingestion.failed > 0 ? exitCodes.failure : exitCode
}

// Shows the records in the terminal viewer, reading keys from the keyboard, until q, Ctrl-C or a signal. The input
// may end before that; the viewer then stays open with what it read.
const runViewer = async (run: Run, keyboard: Keyboard): Promise<number> => {
  const { environment, options } = run
  const store = new RecordStore({ maximumRecords: options.maximumRecords, maximumBytes: options.maximumBytes })
  const ingestion = new Ingestion({ store, mapping: run.mapping })
  ingestion.activity = run.isLive ? 'live' : 'loading'
  const view = new RecordView(store, text => parseEntry(text, run.mapping))
  let screen: Widgets.Screen | undefined
  let panel: MainPanel
  try {
    screen = createScreen({
      input: keyboard.stream,
      output: environment.stdout,
      smartCSR: true,
      // An empty file name, as from --log=, writes no log, as before.
      log: options.debugLog || undefined,
      ...environment.screenOptions
    })
    const sort = options.sort ?? (run.isLive ? 'arrival' : '-timestamp')
    panel = new MainPanel({ screen, view, label: inputsLabel(run.sources), progress: ingestion, level: options.level, sort })
    const statusLine = new StatusLine({ screen, mainPanel: panel })
    screen.append(statusLine)
    panel.setCurrent()
    screen.render()
  } catch (error) {
    // The terminal is given back before the error is reported.
    screen?.destroy()
    keyboard.close()
    throw error
  }
  const viewerScreen = screen

  const controller = new AbortController()
  const failures: string[] = []
  // Set once the viewer has closed; reading may still deliver a last batch then.
  const state = { isFinished: false }
  const refresh = throttle(() => {
    if (!state.isFinished) {
      panel.refresh()
    }
  })
  const onFailure = (source: SourceInformation, error: unknown): void => {
    ingestion.failed += 1
    failures.push(`jv: cannot read '${source.label}': ${errorMessage(error)}\n`)
    refresh.schedule()
  }
  // A save file that fails is reported after the viewer closed; the viewer goes on.
  const saveWriter = run.saveFile === undefined
    ? undefined
    : new LineWriter(run.saveFile, error => {
      ingestion.failed += 1
      failures.push(`jv: cannot save the records: ${error?.message ?? 'the file was closed'}\n`)
      refresh.schedule()
    })
  const isMatch = levelMatcher(options.level)
  const reading = (async () => {
    try {
      for await (const batch of readSources(run, controller.signal, onFailure)) {
        const records = ingestion.accept(batch.source, batch.events)
        refresh.schedule()
        await saveWriter?.write(saveText(records, isMatch), controller.signal)
      }
      ingestion.activity = 'done'
      if (!state.isFinished) {
        refresh.flush()
      }
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted) {
        failures.push(`jv: cannot read the input: ${errorMessage(error)}\n`)
        ingestion.failed += 1
      }
    }
  })()

  const exitCode = await new Promise<number>(resolve => {
    const finish = (code: number): void => {
      if (state.isFinished) {
        return
      }
      state.isFinished = true
      stopListening()
      controller.abort()
      refresh.cancel()
      viewerScreen.destroy()
      keyboard.close()
      resolve(code)
    }
    const stopListening = onSignals(environment.signals, finish)
    viewerScreen.key(['C-c'], () => { finish(signalExitCodes.SIGINT) })
    panel.on('quit', () => { finish(exitCodes.success) })
    keyboard.stream.on('error', () => { finish(exitCodes.failure) })
  })
  await reading
  await saveWriter?.end()
  for (const failure of failures) {
    environment.stderr.write(failure)
  }
  return exitCode === exitCodes.success && ingestion.failed > 0 ? exitCodes.failure : exitCode
}

// The keyboard for the viewer, undefined for plain output, or the reason why --output tui cannot have a viewer.
const chooseKeyboard = (
  options: ApplicationOptions,
  environment: ApplicationEnvironment,
  sources: readonly InputSource[]
): Keyboard | undefined | { readonly failure: string } => {
  const { stdin, stdout } = environment
  if (options.output === 'plain' || options.output === 'jsonl') {
    return undefined
  }
  const isStdinSource = sources.some(source => source.kind === 'stdin')
  // Records typed into the terminal and keys for the viewer would come from the same device.
  const isStdinTerminalSource = isStdinSource && stdin.isTTY === true
  const keyboard = !isStdinTerminalSource && stdout.isTTY === true
    ? environment.openKeyboard({ stdin, isStdinSource, platform: environment.platform })
    : undefined
  if (keyboard !== undefined || options.output !== 'tui') {
    return keyboard
  }
  let reason = 'standard output is no terminal'
  if (stdout.isTTY === true) {
    reason = isStdinTerminalSource
      ? 'standard input is the terminal and carries the records'
      : 'no terminal to read keys from: standard input carries the records, and no console or /dev/tty could be opened'
  }
  return { failure: `the viewer needs a terminal: ${reason}` }
}

// Reads the inputs and the mapping, chooses the output, creates the save file and runs. All of these are checked
// before a screen opens, so their errors reach a plain standard error.
const runApplication = async (options: ApplicationOptions, environment: ApplicationEnvironment): Promise<number> => {
  const { stderr, stdin } = environment
  const fail = (exitCode: number, message: string): number => {
    stderr.write(`jv: ${message}\n`)
    return exitCode
  }
  let sources: InputSource[]
  try {
    sources = await resolveInputs(options.inputs, {
      workingDirectory: environment.workingDirectory,
      isStdinTerminal: stdin.isTTY === true,
      platform: environment.platform
    })
  } catch (error) {
    if (error instanceof InputError) {
      return fail(error.exitCode, error.message)
    }
    throw error
  }
  let mapping: Mapping | undefined
  try {
    mapping = readMapping(fs, environment.home)
  } catch (error) {
    if (error instanceof MappingFileError) {
      return fail(exitCodes.usage, error.message)
    }
    throw error
  }
  const keyboard = chooseKeyboard(options, environment, sources)
  if (keyboard !== undefined && 'failure' in keyboard) {
    return fail(exitCodes.failure, keyboard.failure)
  }
  let saveFile: Writable | undefined
  if (options.save !== undefined) {
    try {
      saveFile = await openSaveFile(path.resolve(environment.workingDirectory, options.save), {
        label: options.save,
        isOverwriting: options.isOverwriting,
        inputs: sources.flatMap(source => source.kind === 'stdin' ? [] : source.path)
      })
    } catch (error) {
      keyboard?.close()
      if (error instanceof SaveFileError) {
        return fail(error.exitCode, error.message)
      }
      throw error
    }
  }
  const isLive = options.isFollowing || sources.some(source => source.kind !== 'file')
  const run: Run = { options, environment, sources, mapping, isLive, saveFile }
  if (keyboard !== undefined) {
    return runViewer(run, keyboard)
  }
  if (options.output === 'jsonl') {
    return runMachineOutput(run, 'jsonl')
  }
  if (options.output === 'auto' && options.sort !== undefined && options.sort !== 'arrival') {
    stderr.write(`jv: plain output keeps the arrival order; --sort ${options.sort} applies to the viewer only\n`)
  }
  return runMachineOutput(run, 'plain')
}

export { Ingestion, merge, refreshInterval, runApplication, throttle }
export type {
  ApplicationEnvironment, ApplicationOptions, Batch, Diagnostic, InputActivity, IngestionOptions, OutputMode, SignalSource,
  Throttle
}
