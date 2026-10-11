// Connects the sources, the formats, the store, the outputs and the viewer (plan sections 4.1, 5 and 6.1): resolves
// the inputs, reads their chunks into each source's format, normalizes the records, and either keeps them in the
// store for the terminal viewer or writes them to standard output. It ends cleanly on q, Ctrl-C, a signal, the end of
// the input or a reader that goes away, and never ends the process itself: it returns the exit code.
import path from 'node:path'
import { addAbortSignal, type Readable, type Writable } from 'node:stream'
import type { Widgets } from 'blessed'
import type { ScreenOptions } from 'neo-blessed'
import type { FilterClause, LogFormat, LogLevel, ParseDiagnostic, SourceInformation, TimestampUnit } from './api.js'
import { ConfigurationError, loadConfiguration, type Configuration } from './configuration.js'
import { filterTest, type NamedPredicate, type PredicateFailure, type ProfileSelection, type RecordFilter } from './filters.js'
import { builtInFormatIdentifiers, builtInFormats, jsonLinesFormat } from './formats/registry.js'
import {
  Ingestion, SourceState, StrictModeError, recordAt, sourceBatches, type IngestionSettings, type NormalizedRecord,
  type SourceBatch
} from './ingestion.js'
import { InputError, readFileChunks, resolveInputs, type InputSource } from './input/files.js'
import { followFile, generationsOf } from './input/follow.js'
import { defaultMaximumLineBytes } from './input/lines.js'
import { LineWriter, SaveFileError, formatLine, jsonLine, openSaveFile, type MachineFormat } from './output.js'
import { PluginError, loadPlugins, type LoadedPlugin } from './plugins.js'
import { RecordStore } from './store.js'
import type { Keyboard, KeyboardOptions } from './terminal.js'
import { createScreen } from './tui/blessed-boundary.js'
import type { RowOptions } from './tui/log-row.js'
import { MainPanel } from './tui/main-panel.js'
import { RecordView } from './tui/record-view.js'
import { visibleText } from './terminal-text.js'
import { StatusLine } from './tui/status-line.js'

type OutputMode = 'auto' | 'tui' | 'plain' | 'jsonl'

interface ApplicationOptions {
  // Files, quoted glob patterns and - for standard input, in the order given.
  readonly inputs: readonly string[]
  readonly isFollowing: boolean
  // The viewer's order; arrival for live input and descending time for files without one.
  readonly sort: string | undefined
  // The normalized level that records must have.
  readonly level: LogLevel | undefined
  // The clauses of --where, the profile of --profile and the predicates of --predicate, which records must match too.
  readonly where: readonly FilterClause[]
  readonly profile: string | undefined
  readonly predicates: readonly string[]
  readonly output: OutputMode
  // The format of every input, or undefined and auto to recognize each input by itself.
  readonly format: string | undefined
  // The unit of numeric timestamps; undefined lets each format use its own.
  readonly timestampUnit: TimestampUnit | undefined
  // The configuration file of --config, and --no-config, which turns the discovery of a file off.
  readonly configuration: string | undefined
  readonly isConfigurationDisabled: boolean
  // The files and packages of --plugin, in their order.
  readonly plugins: readonly string[]
  // Ends the run with exit code 1 at the first record that cannot be read.
  readonly isStrict: boolean
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
  // The home directory, where discovery looks for a configuration file after the working directory.
  readonly home: string
  readonly platform: NodeJS.Platform
  readonly signals: SignalSource
  readonly openKeyboard: (options: KeyboardOptions) => Keyboard | undefined
  // Terminal type and Unicode for headless tests.
  readonly screenOptions?: Pick<ScreenOptions, 'terminal' | 'forceUnicode' | 'warnings'>
}

// Exit codes (plan section 6.1); a signal ends with 128 and its number, as a shell reports it.
const exitCodes = { success: 0, failure: 1, usage: 2 } as const
const signalExitCodes: Readonly<Record<'SIGHUP' | 'SIGINT' | 'SIGTERM', number>> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }

// At most this many errors are reported one by one on standard error; the rest are counted. Each kind of warning is
// reported once per source.
const diagnosticLimit = 10

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

// A line for standard error. Its text may name inputs, fields and values of records, so it shows only visible text.
const errorLine = (message: string): string => `jlv: ${visibleText(message)}\n`

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

type FailureListener = (source: SourceInformation, error: unknown) => void

// The batches of one source until it fails. A failure is reported, and the other sources go on; at the abort of the
// run the error ends the reading.
async function * reportingFailure (
  source: SourceState,
  batches: AsyncIterable<SourceBatch>,
  signal: AbortSignal,
  onFailure: FailureListener
): AsyncGenerator<SourceBatch> {
  try {
    yield * batches
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    onFailure(source.information, error)
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

// Everything that a run needs once the inputs, the configuration and the save file are known.
interface Run {
  readonly options: ApplicationOptions
  readonly environment: ApplicationEnvironment
  readonly sources: readonly InputSource[]
  readonly configuration: Configuration
  readonly settings: IngestionSettings
  readonly rowOptions: RowOptions
  // The predicates of the loaded plugins.
  readonly predicates: readonly NamedPredicate[]
  // The filter of the command line: the level, --where, --profile and --predicate.
  readonly filter: RecordFilter
  readonly isLive: boolean
  readonly saveFile: Writable | undefined
}

// The state of each source for a run, in the order of the sources.
const sourceStates = (run: Run, signal: AbortSignal): SourceState[] => run.sources.map(source =>
  new SourceState(source.information, source.kind === 'stdin' ? undefined : source.path, run.settings, signal))

// The sources' batches: finite files one after the other or, with --follow, every file by itself, and every live
// stream at the same time.
const readSources = (run: Run, states: readonly SourceState[], signal: AbortSignal, onFailure: FailureListener): AsyncIterable<SourceBatch> => {
  const { settings } = run
  const lanes: AsyncIterable<SourceBatch>[] = []
  const finiteFiles: { readonly state: SourceState, readonly path: string }[] = []
  for (const [index, source] of run.sources.entries()) {
    const state = states[index]
    if (state === undefined) {
      continue
    }
    if (source.kind === 'file' && !run.options.isFollowing) {
      finiteFiles.push({ state, path: source.path })
    } else if (source.kind === 'file') {
      const generations = generationsOf(followFile(source.path, signal))
      lanes.push(reportingFailure(state, sourceBatches(state, generations, settings, true), signal, onFailure))
    } else {
      const stream = source.kind === 'stdin' ? run.environment.stdin : readFileChunks(source.path, signal)
      addAbortSignal(signal, stream)
      lanes.push(reportingFailure(state, sourceBatches(state, [stream], settings, true), signal, onFailure))
    }
  }
  if (finiteFiles.length > 0) {
    lanes.unshift((async function * () {
      for (const { state, path: file } of finiteFiles) {
        const batches = sourceBatches(state, [readFileChunks(file, signal)], settings, false)
        yield * reportingFailure(state, batches, signal, onFailure)
      }
    })())
  }
  return merge(lanes)
}

// Whether a record matches the filter of the command line.
const recordMatcher = (filter: RecordFilter, onFailure: PredicateFailure): ((record: NormalizedRecord) => boolean) => {
  const test = filterTest(filter, onFailure)
  return test === undefined ? () => true : normalized => test(normalized.record)
}

// The JSON lines of the records, for the save file.
const saveText = (records: readonly NormalizedRecord[]): string => {
  let text = ''
  for (const normalized of records) {
    text += jsonLine(normalized.record)
  }
  return text
}

// Reports the first failure of each predicate of a plugin; the record that it failed on is left out, and the run ends
// with 1.
class PredicateFailures {
  readonly #report: (line: string) => void
  readonly #names = new Set<string>()

  readonly onFailure: PredicateFailure = (predicate, error) => {
    if (this.#names.has(predicate.name)) {
      return
    }
    this.#names.add(predicate.name)
    this.#report(errorLine(`the predicate ${predicate.name} of the plugin ${predicate.owner} failed: ${errorMessage(error)}; it left out the records it failed on`))
  }

  constructor (report: (line: string) => void) {
    this.#report = report
  }

  get isFailed (): boolean {
    return this.#names.size > 0
  }
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

// Reports diagnostics on standard error without flooding it: the first errors one by one, and each kind of warning
// once per source, with totals at the end.
class DiagnosticReport {
  readonly #write: (text: string) => void
  readonly #warningKinds = new Set<string>()
  #errors = 0
  #shownErrors = 0
  #warnings = 0
  #shownWarnings = 0

  constructor (write: (text: string) => void) {
    this.#write = write
  }

  report (source: SourceInformation, diagnostic: ParseDiagnostic): void {
    const position = diagnostic.position === undefined ? '' : `:${String(diagnostic.position.firstLine)}`
    if (diagnostic.severity === 'warning') {
      this.#warnings += 1
      const kind = `${String(source.order)} ${diagnostic.code}`
      if (this.#warningKinds.has(kind)) {
        return
      }
      this.#warningKinds.add(kind)
      this.#shownWarnings += 1
      this.#write(errorLine(`${source.label}${position}: warning: ${diagnostic.message}`))
      return
    }
    this.#errors += 1
    if (this.#shownErrors >= diagnosticLimit) {
      return
    }
    this.#shownErrors += 1
    this.#write(errorLine(`${source.label}${position}: ${diagnostic.message}`))
  }

  end (): void {
    if (this.#errors > this.#shownErrors) {
      this.#write(errorLine(`skipped ${String(this.#errors)} lines in total, the first ${String(this.#shownErrors)} of them shown above`))
    }
    if (this.#warnings > this.#shownWarnings) {
      this.#write(errorLine(`${String(this.#warnings)} warnings in total, the first of each kind shown above`))
    }
  }
}

// Writes every record that matches the filter of the command line as plain text or JSON lines, in arrival order,
// until the input ends, a signal arrives or the reader goes away. Diagnostics are reported on standard error.
const runMachineOutput = async (run: Run, format: MachineFormat): Promise<number> => {
  const { environment, options } = run
  const { stderr } = environment
  const controller = new AbortController()
  let exitCode: number = exitCodes.success
  const report = new DiagnosticReport(text => { stderr.write(text) })
  const ingestion = new Ingestion({
    isCollecting: true,
    isStrict: options.isStrict,
    onDiagnostic: (source, diagnostic) => { report.report(source, diagnostic) }
  })
  const writer = new LineWriter(environment.stdout, error => {
    if (error !== undefined) {
      stderr.write(errorLine(`cannot write the output: ${error.message}`))
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
      stderr.write(errorLine(`cannot save the records: ${error?.message ?? 'the file was closed'}`))
      exitCode = exitCodes.failure
      controller.abort()
    })
  const predicateFailures = new PredicateFailures(line => { stderr.write(line) })
  const isMatch = recordMatcher(run.filter, predicateFailures.onFailure)
  const onFailure = (source: SourceInformation, error: unknown): void => {
    ingestion.failed += 1
    stderr.write(errorLine(`cannot read '${source.label}': ${errorMessage(error)}`))
  }
  const states = sourceStates(run, controller.signal)
  try {
    for await (const batch of readSources(run, states, controller.signal, onFailure)) {
      const records = ingestion.accept(batch).filter(normalized => isMatch(normalized))
      let text = ''
      for (const normalized of records) {
        text += formatLine(format, normalized, run.rowOptions)
      }
      await Promise.all([writer.write(text, controller.signal), saveWriter?.write(saveText(records), controller.signal)])
      if (ingestion.strictFailure !== undefined) {
        throw ingestion.strictFailure
      }
    }
  } catch (error) {
    if (error instanceof StrictModeError) {
      stderr.write(errorLine('--strict stops at the first record that cannot be read'))
      exitCode = exitCodes.failure
    } else if (!isAbortError(error) && !controller.signal.aborted) {
      throw error
    }
  } finally {
    stopListening()
    controller.abort()
  }
  await Promise.all([writer.flush(), saveWriter?.end()])
  report.end()
  if (exitCode === exitCodes.success && ingestion.records === 0 && ingestion.skipped > 0) {
    stderr.write(errorLine(`the input holds no records, only ${String(ingestion.skipped)} skipped lines`))
    exitCode = exitCodes.failure
  }
  const isFailed = ingestion.failed > 0 || predicateFailures.isFailed
  return isFailed && exitCode === exitCodes.success ? exitCodes.failure : exitCode
}

// Shows the records in the terminal viewer, reading keys from the keyboard, until q, Ctrl-C or a signal. The input
// may end before that; the viewer then stays open with what it read.
const runViewer = async (run: Run, keyboard: Keyboard): Promise<number> => {
  const { environment, options } = run
  const controller = new AbortController()
  const store = new RecordStore({
    maximumRecords: options.maximumRecords ?? run.configuration.maximumRecords,
    maximumBytes: options.maximumBytes ?? run.configuration.maximumBytes
  })
  const ingestion = new Ingestion({ store, isCollecting: run.saveFile !== undefined, isStrict: options.isStrict })
  ingestion.activity = run.isLive ? 'live' : 'loading'
  const states = sourceStates(run, controller.signal)
  const view = new RecordView(store, sequence => recordAt(store, states, sequence), run.rowOptions)
  // Failures are reported after the viewer closed.
  const failures: string[] = []
  const predicateFailures = new PredicateFailures(line => { failures.push(line) })
  let screen: Widgets.Screen | undefined
  let panel: MainPanel
  try {
    screen = createScreen({
      input: keyboard.stream,
      output: environment.stdout,
      smartCSR: true,
      // A prompt that reads text grabs every key; Ctrl-C still ends the viewer then.
      ignoreLocked: ['C-c'],
      // An empty file name, as from --log=, writes no log, as before.
      log: options.debugLog || undefined,
      ...environment.screenOptions
    })
    const sort = options.sort ?? (run.isLive ? 'arrival' : '-timestamp')
    panel = new MainPanel({
      screen,
      view,
      label: inputsLabel(run.sources),
      progress: ingestion,
      configuration: run.configuration.file,
      filter: run.filter,
      profiles: run.configuration.profiles,
      predicates: run.predicates,
      onPredicateFailure: predicateFailures.onFailure,
      sort
    })
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

  // Set once the viewer has closed; reading may still deliver a last batch then.
  const state: { isFinished: boolean, finish?: (code: number) => void } = { isFinished: false }
  const refresh = throttle(() => {
    if (!state.isFinished) {
      panel.refresh()
    }
  })
  const onFailure = (source: SourceInformation, error: unknown): void => {
    ingestion.failed += 1
    failures.push(errorLine(`cannot read '${source.label}': ${errorMessage(error)}`))
    refresh.schedule()
  }
  // A save file that fails is reported after the viewer closed; the viewer goes on.
  const saveWriter = run.saveFile === undefined
    ? undefined
    : new LineWriter(run.saveFile, error => {
      ingestion.failed += 1
      failures.push(errorLine(`cannot save the records: ${error?.message ?? 'the file was closed'}`))
      refresh.schedule()
    })
  // The save file gets the records that the filter of the command line keeps, whatever the viewer shows.
  const isMatch = recordMatcher(run.filter, predicateFailures.onFailure)
  const reading = (async () => {
    try {
      for await (const batch of readSources(run, states, controller.signal, onFailure)) {
        const records = ingestion.accept(batch)
        refresh.schedule()
        await saveWriter?.write(saveText(records.filter(normalized => isMatch(normalized))), controller.signal)
        if (ingestion.strictFailure !== undefined) {
          throw ingestion.strictFailure
        }
      }
      ingestion.activity = 'done'
      if (!state.isFinished) {
        refresh.flush()
      }
    } catch (error) {
      if (error instanceof StrictModeError) {
        failures.push(errorLine(error.message) + errorLine('--strict stops at the first record that cannot be read'))
        state.finish?.(exitCodes.failure)
      } else if (!isAbortError(error) && !controller.signal.aborted) {
        failures.push(errorLine(`cannot read the input: ${errorMessage(error)}`))
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
    state.finish = finish
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
  const isFailed = ingestion.failed > 0 || predicateFailures.isFailed
  return isFailed && exitCode === exitCodes.success ? exitCodes.failure : exitCode
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

// The settings of the formats: every format for the probes, built-in ones first, and the one that --format or the
// configuration names. Options of the command line win over the configuration.
const ingestionSettings = (options: ApplicationOptions, configuration: Configuration, plugins: readonly LoadedPlugin[]): IngestionSettings => {
  const formats: readonly LogFormat[] = [
    ...builtInFormats({ csvDelimiter: configuration.csvDelimiter }),
    ...plugins.flatMap(plugin => plugin.formats)
  ]
  const name = options.format ?? configuration.format
  const format = name === undefined || name === 'auto' ? undefined : formats.find(candidate => candidate.identifier === name)
  if (format === undefined && name !== undefined && name !== 'auto') {
    const origin = options.format === undefined ? `the format of ${configuration.file ?? 'the configuration'}` : '--format'
    throw new ConfigurationError(`${origin} takes auto or one of ${formats.map(candidate => candidate.identifier).join(', ')}, not '${name}'`)
  }
  return {
    formats,
    format,
    fallback: jsonLinesFormat,
    mapping: configuration.mapping,
    timestampUnit: options.timestampUnit ?? configuration.timestampUnit,
    levels: configuration.levels,
    maximumRecordSize: defaultMaximumLineBytes
  }
}

// The predicates of the plugins under their names.
const predicatesOf = (plugins: readonly LoadedPlugin[]): NamedPredicate[] => plugins.flatMap(plugin =>
  Object.entries(plugin.predicates).map(([name, test]): NamedPredicate => ({ name, owner: plugin.specifier, test })))

// Names for a message, or none.
const listOf = (names: readonly string[]): string => names.length === 0 ? 'none' : names.join(', ')

// The filter of the command line: -l, --where, the profile of --profile and the predicates of --predicate, which must
// exist.
const commandLineFilter = (options: ApplicationOptions, configuration: Configuration, predicates: readonly NamedPredicate[]): RecordFilter => {
  let profile: ProfileSelection | undefined
  const { profiles } = configuration
  if (options.profile !== undefined) {
    const group = Object.hasOwn(profiles, options.profile) ? profiles[options.profile] : undefined
    if (group === undefined) {
      const known = configuration.file === undefined
        ? 'no configuration file was read'
        : `the profiles of ${configuration.file} are ${listOf(Object.keys(profiles))}`
      throw new ConfigurationError(`--profile ${options.profile} names no profile; ${known}`)
    }
    profile = { name: options.profile, group }
  }
  const chosen = options.predicates.map(name => {
    const predicate = predicates.find(candidate => candidate.name === name)
    if (predicate === undefined) {
      const names = listOf(predicates.map(candidate => candidate.name))
      throw new ConfigurationError(`--predicate ${name} names no predicate; the predicates of the plugins of --plugin are ${names}`)
    }
    return predicate
  })
  return { level: options.level, clauses: options.where, profile, predicates: chosen }
}

// Reads the inputs and the configuration, chooses the output, creates the save file and runs. All of these are
// checked before a screen opens, so their errors reach a plain standard error.
const runApplication = async (options: ApplicationOptions, environment: ApplicationEnvironment): Promise<number> => {
  const { stderr, stdin } = environment
  const fail = (exitCode: number, message: string): number => {
    stderr.write(errorLine(message))
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
  let plugins: LoadedPlugin[]
  try {
    plugins = await loadPlugins(options.plugins, {
      workingDirectory: environment.workingDirectory,
      reservedIdentifiers: new Set(['auto', ...builtInFormatIdentifiers])
    })
  } catch (error) {
    if (error instanceof PluginError) {
      return fail(exitCodes.failure, error.message)
    }
    throw error
  }
  let configuration: Configuration
  let settings: IngestionSettings
  let filter: RecordFilter
  try {
    configuration = loadConfiguration({
      workingDirectory: environment.workingDirectory,
      home: environment.home,
      file: options.configuration,
      isDiscoveryDisabled: options.isConfigurationDisabled
    })
    settings = ingestionSettings(options, configuration, plugins)
    filter = commandLineFilter(options, configuration, predicatesOf(plugins))
  } catch (error) {
    if (error instanceof ConfigurationError) {
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
  const rowOptions: RowOptions = { legacyExtras: configuration.legacyExtras }
  const run: Run = { options, environment, sources, configuration, settings, rowOptions, predicates: predicatesOf(plugins), filter, isLive, saveFile }
  if (keyboard !== undefined) {
    return runViewer(run, keyboard)
  }
  if (options.output === 'jsonl') {
    return runMachineOutput(run, 'jsonl')
  }
  if (options.output === 'auto' && options.sort !== undefined && options.sort !== 'arrival') {
    stderr.write(errorLine(`plain output keeps the arrival order; --sort ${options.sort} applies to the viewer only`))
  }
  return runMachineOutput(run, 'plain')
}

export { merge, refreshInterval, runApplication, throttle }
export type { ApplicationEnvironment, ApplicationOptions, OutputMode, SignalSource, Throttle }
