#!/usr/bin/env node
// Successor of upstream src/index.js, the jv command: reads the arguments, prints the help, the version and usage
// errors, and runs the application with the process's streams. It sets the exit code and lets the process end by
// itself once the application has closed its streams and the terminal. The modules it imports have no effects on
// import.
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { runApplication, type ApplicationOptions, type OutputMode } from './application.js'
import { openKeyboard } from './terminal.js'

const usage = 'usage: jv [options] [file | \'glob\' | -]...'

const help = `${usage}

Shows JSON lines from files, quoted glob patterns or standard input (-) in a terminal viewer, or writes them as text
or JSON lines when there is no terminal.

options:
  -f, --files <glob>     read the files that a pattern matches; repeatable
  --follow               keep reading files that grow, are truncated or replaced
  --sort <order>         timestamp, level, message, arrival or another field; a leading - sorts descending,
                         as in --sort=-level (default: -timestamp for files, arrival for pipes and --follow)
  -l, --level <level>    show only records of this level
  --output <mode>        auto, tui, plain or jsonl (default: auto, the viewer when the terminal allows it)
  --max-records <n>      records the viewer keeps (default: 50000)
  --max-bytes <n>        bytes of records the viewer keeps (default: 67108864)
  -s, --save <file>      also write every record that matches -l as a JSON line to a new file
  --overwrite            let --save replace an existing file
  --log <file>           write the terminal library's debug log
  -h, --help             show this help
  --version              show the version

Exit codes: 0 done, 1 an input or the output failed, 2 usage error, 130 interrupted.
`

// Unknown options and options without their value are usage errors; a value that starts with a dash needs the =
// form, such as --sort=-timestamp.
const optionDefinitions = {
  files: { type: 'string', short: 'f', multiple: true },
  follow: { type: 'boolean' },
  sort: { type: 'string' },
  level: { type: 'string', short: 'l' },
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

// minimist read numeric values as numbers, which the level filter compares as they are, so -l 30 matches pino's
// numeric level 30. The level keeps minimist's number test; every other value stays text.
const hexadecimalPattern = /^0x[\da-f]+$/i
const decimalPattern = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/
const levelValue = (text: string | undefined): string | number | undefined =>
  text !== undefined && (hexadecimalPattern.test(text) || decimalPattern.test(text)) ? Number(text) : text

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

const readOptions = (): ApplicationOptions | 'help' | 'version' => {
  const { values, tokens } = parseArgs({
    args: process.argv.slice(2),
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
