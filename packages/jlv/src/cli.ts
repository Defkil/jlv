#!/usr/bin/env node
// Successor of upstream src/index.js, the jv command: reads the arguments and opens the main panel and the status
// line on the screen. This module owns the process-level effects; the modules it imports have none on import.
import { parseArgs } from 'node:util'
import { createScreen } from './tui/blessed-boundary.js'
import { MainPanel } from './tui/main-panel.js'
import { StatusLine } from './tui/status-line.js'

const usage = 'usage: jv [-l <level>] [-s <field>] [--log <file>] <log-file>'

// The options of upstream's minimist parser. Unknown options and options without their value are now usage errors;
// a value that starts with a dash needs the = form, such as --sort=-timestamp.
const optionDefinitions = {
  level: { type: 'string', short: 'l' },
  sort: { type: 'string', short: 's' },
  log: { type: 'string' }
} as const

const isUsageError = (error: unknown): error is Error =>
  error instanceof TypeError && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS_')

// Usage errors exit with code 2 (plan section 6.1).
const readArguments = () => {
  try {
    return parseArgs({ args: process.argv.slice(2), options: optionDefinitions, allowPositionals: true })
  } catch (error) {
    if (isUsageError(error)) {
      process.stderr.write(`jv: ${error.message}\n${usage}\n`)
      process.exit(2)
    }
    throw error
  }
}

// minimist read numeric values as numbers, which the level filter compares as they are, so -l 30 matches pino's
// numeric level 30. The level keeps minimist's number test; every other value stays text.
const hexadecimalPattern = /^0x[\da-f]+$/i
const decimalPattern = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/
const levelValue = (text: string | undefined): string | number | undefined =>
  text !== undefined && (hexadecimalPattern.test(text) || decimalPattern.test(text)) ? Number(text) : text

const { values, positionals } = readArguments()
const [logFile] = positionals

if (!logFile) {
  console.log('error: missing log file')
  process.exit(1)
}

const screen = createScreen({
  smartCSR: true,
  // An empty file name, as from --log=, writes no log, as before.
  log: values.log || undefined
})
screen.key(['C-c'], () => {
  process.exit(0)
})

const mainPanel = new MainPanel({ screen, level: levelValue(values.level), sort: values.sort })
mainPanel.loadFile(logFile)

const statusLine = new StatusLine({ screen, mainPanel })
screen.append(statusLine)
mainPanel.setCurrent()

screen.render()

process.on('SIGWINCH', () => {
  screen.emit('resize')
})
