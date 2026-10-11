#!/usr/bin/env node
// Successor of upstream src/index.js, the jv command: reads the arguments, prints the help, the version and usage
// errors, and runs the application with the process's streams. It sets the exit code and lets the process end by
// itself once the application has closed its streams and the terminal. The modules it imports have no effects on
// import.
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { parseArgs } from 'node:util'
import type { LogLevel, TimestampUnit } from './api.js'
import { runApplication, type ApplicationOptions, type OutputMode } from './application.js'
import { commonLevelNames, logLevels, timestampUnits } from './record.js'
import { openKeyboard } from './terminal.js'

const usage = 'usage: jv [options] [file | \'glob\' | -]...'

const help = `${usage}

Shows log records from files, quoted glob patterns or standard input (-) in a terminal viewer, or writes them as
text or JSON lines when there is no terminal.

options:
  -f, --files <glob>     read the files that a pattern matches; repeatable
  --follow               keep reading files that grow, are truncated or replaced
  --format <format>      auto, docker, bunyan, pino, logfmt, csv, winston or jsonl (default: auto)
  --sort <order>         timestamp, level, message or arrival; a leading - sorts descending, as in
                         --sort=-level (default: -timestamp for files, arrival for pipes and --follow)
  -l, --level <level>    show only records of this level: trace, debug, info, warn, error, fatal or unknown
  --timestamp-unit <u>   seconds, milliseconds, microseconds or nanoseconds for numeric timestamps
  --strict               stop with exit code 1 at the first record that cannot be read
  -c, --config <file>    read this configuration file, JSON or legacy INI, instead of discovering one
  --no-config            read no configuration file
  --plugin <module>      load the formats of a plugin, a file or an installed package; repeatable. A plugin is
                         trusted code that runs inside jlv
  --output <mode>        auto, tui, plain or jsonl (default: auto, the viewer when the terminal allows it)
  --max-records <n>      records the viewer keeps (default: 50000)
  --max-bytes <n>        bytes of records the viewer keeps (default: 67108864)
  -s, --save <file>      also write every record that matches -l as a JSON line to a new file
  --overwrite            let --save replace an existing file
  --log <file>           write the terminal library's debug log
  -h, --help             show this help
  --version              show the version

Without --config, the first of these files configures the run: jlv.config.json and then .json-log-viewer in the
working directory, then both in the home directory. Options on the command line win over the file.

Exit codes: 0 done, 1 an input or the output failed, 2 usage error, 130 interrupted.
`

// Unknown options and options without their value are usage errors; a value that starts with a dash needs the =
// form, such as --sort=-timestamp.
const optionDefinitions = {
  files: { type: 'string', short: 'f', multiple: true },
  follow: { type: 'boolean' },
  format: { type: 'string' },
  sort: { type: 'string' },
  level: { type: 'string', short: 'l' },
  'timestamp-unit': { type: 'string' },
  strict: { type: 'boolean' },
  config: { type: 'string', short: 'c' },
  'no-config': { type: 'boolean' },
  plugin: { type: 'string', multiple: true },
  output: { type: 'string' },
  'max-records': { type: 'string' },
  'max-bytes': { type: 'string' },
  save: { type: 'string', short: 's' },
  overwrite: { type: 'boolean' },
  log: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' }
} as const

const outputModes: ReadonlySet<string> = new Set<OutputMode>(['auto', 'tui', 'plain', 'jsonl'])

class UsageError extends Error {}

const isParseError = (error: unknown): error is Error =>
  error instanceof TypeError && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS_')

// The orders of --sort, each with a leading - for descending.
const sortKeys: ReadonlySet<string> = new Set(['timestamp', 'level', 'message', 'arrival'])

// A level name or one of its aliases, ignoring case. Numeric levels are normalized by their format, so -l info
// matches pino's 30; upstream compared the raw value.
const levelValue = (text: string | undefined): LogLevel | undefined => {
  if (text === undefined) {
    return undefined
  }
  const key = text.toLowerCase()
  const level = key === 'unknown' ? 'unknown' : commonLevelNames[key]
  if (level === undefined) {
    throw new UsageError(`--level takes ${logLevels.join(', ')}, not '${text}'`)
  }
  return level
}

const timestampUnitNames: ReadonlySet<string> = new Set(timestampUnits)

const isTimestampUnit = (text: string): text is TimestampUnit => timestampUnitNames.has(text)

const timestampUnitValue = (text: string | undefined): TimestampUnit | undefined => {
  if (text === undefined || isTimestampUnit(text)) {
    return text
  }
  throw new UsageError(`--timestamp-unit takes ${timestampUnits.join(', ')}, not '${text}'`)
}

// The store's limits are positive integers below 2^32.
const limitValue = (name: string, text: string | undefined): number | undefined => {
  if (text === undefined) {
    return undefined
  }
  const value = /^\d+$/.test(text) ? Number(text) : NaN
  if (!(value >= 1 && value <= 0xFF_FF_FF_FF)) {
    throw new UsageError(`--${name} needs a whole number from 1 to 4294967295, not '${text}'`)
  }
  return value
}

// The options of the jlv 1 wrapper that jlv 2 dropped (plan section 6.1), with what replaces them. They fail with this
// hint instead of a bare "Unknown option".
const transformerHint = 'pino is built in (--format pino), and other formats come from plugins (--plugin <file>)'
const removedOptions: ReadonlyMap<string, string> = new Map([
  ['--param', 'jlv 2 is the viewer itself and takes its options directly; see --help'],
  ['-p', 'jlv 2 is the viewer itself and takes its options directly; see --help'],
  ['--open', 'jlv 2 runs in the current terminal and opens no other shell'],
  ['-o', 'jlv 2 runs in the current terminal and opens no other shell'],
  ['--reset', 'jlv 2 never writes configuration into the home directory, so there is nothing to reset'],
  ['-r', 'jlv 2 never writes configuration into the home directory, so there is nothing to reset'],
  ['--backup', 'jlv 2 never writes configuration into the home directory, so there is nothing to back up'],
  ['-b', 'jlv 2 never writes configuration into the home directory, so there is nothing to back up'],
  ['--transformer', transformerHint],
  ['-t', transformerHint],
  ['--transformer-js', transformerHint],
  ['-tjs', transformerHint]
])

// The first removed option before --, as it was written.
const removedOption = (parameters: readonly string[]): { readonly name: string, readonly hint: string } | undefined => {
  for (const parameter of parameters) {
    if (parameter === '--') {
      return undefined
    }
    const [name = parameter] = parameter.startsWith('--') ? parameter.split('=', 1) : [parameter]
    const hint = removedOptions.get(name)
    if (hint !== undefined) {
      return { name, hint }
    }
  }
  return undefined
}

const readOptions = (): ApplicationOptions | 'help' | 'version' => {
  const parameters = process.argv.slice(2)
  const removed = removedOption(parameters)
  if (removed !== undefined) {
    throw new UsageError(`${removed.name} is gone in jlv 2: ${removed.hint}`)
  }
  const { values, tokens } = parseArgs({
    args: parameters,
    options: optionDefinitions,
    allowPositionals: true,
    tokens: true
  })
  if (values.help === true) {
    return 'help'
  }
  if (values.version === true) {
    return 'version'
  }
  const output = values.output ?? 'auto'
  if (!outputModes.has(output)) {
    throw new UsageError(`--output takes auto, tui, plain or jsonl, not '${output}'`)
  }
  if (values.overwrite === true && values.save === undefined) {
    throw new UsageError('--overwrite needs --save')
  }
  const sort = values.sort
  if (sort !== undefined && !sortKeys.has(sort.replace(/^-/, ''))) {
    throw new UsageError(`--sort takes timestamp, level, message or arrival, with a leading - to sort descending, not '${sort}'`)
  }
  if (sort !== undefined && sort !== 'arrival' && (output === 'plain' || output === 'jsonl')) {
    throw new UsageError(`--output ${output} writes the records in arrival order; --sort ${sort} needs the viewer`)
  }
  // Positional arguments and --files keep their order on the command line.
  const inputs: string[] = []
  for (const token of tokens) {
    const isInput = token.kind === 'positional' || (token.kind === 'option' && token.name === 'files')
    if (isInput && typeof token.value === 'string') {
      inputs.push(token.value)
    }
  }
  return {
    inputs,
    isFollowing: values.follow === true,
    sort,
    level: levelValue(values.level),
    output: output as OutputMode,
    format: values.format,
    timestampUnit: timestampUnitValue(values['timestamp-unit']),
    isStrict: values.strict === true,
    configuration: values.config,
    isConfigurationDisabled: values['no-config'] === true,
    plugins: values.plugin ?? [],
    maximumRecords: limitValue('max-records', values['max-records']),
    maximumBytes: limitValue('max-bytes', values['max-bytes']),
    save: values.save,
    isOverwriting: values.overwrite === true,
    debugLog: values.log
  }
}

// The version of the package, read from its manifest next to the emitted code.
const packageVersion = (): string => {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const version: unknown = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'version') : undefined
  return typeof version === 'string' ? version : 'unknown'
}

const main = async (): Promise<number> => {
  let options: ReturnType<typeof readOptions>
  try {
    options = readOptions()
  } catch (error) {
    if (isParseError(error) || error instanceof UsageError) {
      process.stderr.write(`jv: ${error.message}\n${usage}\nRun jv --help for the options.\n`)
      return 2
    }
    throw error
  }
  if (options === 'help') {
    process.stdout.write(help)
    return 0
  }
  if (options === 'version') {
    process.stdout.write(`${packageVersion()}\n`)
    return 0
  }
  return runApplication(options, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    workingDirectory: process.cwd(),
    home: os.homedir(),
    platform: process.platform,
    signals: process,
    openKeyboard
  })
}

process.exitCode = await main()
