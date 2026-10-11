#!/usr/bin/env node
// Successor of upstream src/index.js, the jv command: reads the arguments and opens the main panel and the status
// line on the screen. This module owns the process-level effects; the modules it imports have none on import.
import minimist from 'minimist'
import { createScreen } from './tui/blessed-boundary.js'
import { MainPanel } from './tui/main-panel.js'
import { StatusLine } from './tui/status-line.js'

// minimist reports an option without a value as true and a numeric value as a number. Upstream crashed on such
// values of --log and --sort, so they stay errors; an empty or false value counts as absent, as before.
const textOption = (value: unknown, name: string): string | undefined => {
  if (typeof value === 'string') {
    return value
  }
  if (!value) {
    return undefined
  }
  throw new TypeError(`The --${name} option needs a text value.`)
}

const options = minimist(process.argv.slice(2))
const [logFile] = options._

if (!logFile) {
  console.log('error: missing log file')
  process.exit(1)
}

const screen = createScreen({
  smartCSR: true,
  log: textOption(options.log, 'log')
})
screen.key(['C-c'], () => {
  process.exit(0)
})

// The level filter compares the parsed value as it is, so a numeric pino level such as -l 30 matches.
const level: unknown = options.l || options.level
const sort = textOption(options.s || options.sort, 'sort')

const mainPanel = new MainPanel({ screen, level, sort })
mainPanel.loadFile(logFile)

const statusLine = new StatusLine({ screen, mainPanel })
screen.append(statusLine)
mainPanel.setCurrent()

screen.render()

process.on('SIGWINCH', () => {
  screen.emit('resize')
})
