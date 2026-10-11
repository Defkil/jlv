// Headless terminal for characterization tests: real key sequences go in through a stream, and the
// logical screen (characters and attributes per cell) comes out, independent of escape-code output.
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Widgets } from 'blessed'
import { loadMainPanel, loadStatusLine, loadTerminalLibrary, type LegacyMainPanel } from './legacy.js'

export class TerminalOutput extends Writable {
  readonly isTTY = true
  columns: number
  rows: number

  constructor (columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }

  override _write (_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback()
  }

  resizeTo (columns: number, rows: number): void {
    this.columns = columns
    this.rows = rows
    this.emit('resize')
  }
}

export interface Viewer {
  readonly input: PassThrough
  readonly output: TerminalOutput
  readonly screen: Widgets.Screen
  readonly panel: LegacyMainPanel
  readonly status: Widgets.BoxElement
}

export interface ViewerOptions {
  readonly columns?: number
  readonly rows?: number
  readonly level?: string
  readonly sort?: string
}

// The main panel's top border without a label, as rendered since upstream PR #13 removes the label.
export const plainTopBorder = (columns = 80): string => `┌${'─'.repeat(columns - 2)}┐`

export const keys = {
  up: '\u{1B}[A',
  down: '\u{1B}[B',
  pageUp: '\u{1B}[5~',
  pageDown: '\u{1B}[6~',
  enter: '\r',
  escape: '\u{1B}'
} as const

// Mirrors upstream src/index.js: a screen, a MainPanel with the file, the status line, focus, render.
// blessed binds parentless elements to the newest screen once several exist, so each test owns the only
// live screen and destroys it afterwards.
export const openViewer = (context: TestContext, file: string, options: ViewerOptions = {}): Viewer => {
  const input = new PassThrough()
  const output = new TerminalOutput(options.columns ?? 80, options.rows ?? 24)
  const screen = loadTerminalLibrary().screen({
    input,
    output,
    terminal: 'xterm-256color',
    forceUnicode: true,
    smartCSR: true,
    warnings: false
  })
  context.after(() => { screen.destroy() })
  const MainPanel = loadMainPanel()
  const panel = new MainPanel({ screen, level: options.level, sort: options.sort })
  panel.loadFile(file)
  const StatusLine = loadStatusLine()
  const status = new StatusLine({ screen, mainPanel: panel })
  screen.append(status)
  panel.setCurrent()
  screen.render()
  return { input, output, screen, panel, status }
}

// The panel label shows the file name as given, so the viewer opens the file from its own directory.
export const openFileViewer = (context: TestContext, file: string, options: ViewerOptions = {}): Viewer => {
  process.chdir(path.dirname(file))
  return openViewer(context, path.basename(file), options)
}

// Sends key sequences one at a time. Prompts start listening on the next turn, so each key waits.
export const press = async (viewer: Viewer, ...sequences: string[]): Promise<void> => {
  for (const sequence of sequences) {
    viewer.input.write(sequence)
    await nextTurn()
    await nextTurn()
  }
}

type Cell = readonly [attribute: number, character: string]

const screenCells = (screen: Widgets.Screen): readonly (readonly Cell[])[] => {
  const lines: unknown = Reflect.get(screen, 'lines')
  if (!Array.isArray(lines)) {
    throw new TypeError('The screen has no rendered lines.')
  }
  const toCell = (cell: unknown): Cell => Array.isArray(cell) && typeof cell[0] === 'number' && typeof cell[1] === 'string'
    ? [cell[0], cell[1]]
    : [0, '?']
  return lines.map((line: unknown) => Array.isArray(line) ? line.map(cell => toCell(cell)) : [])
}

// Rendered rows without trailing spaces.
export const screenText = (screen: Widgets.Screen): string[] =>
  screenCells(screen).map(line => line.map(([, character]) => character).join('').trimEnd())

export interface CellStyle {
  readonly foreground: number
  readonly background: number
  readonly isBold: boolean
}

// blessed packs a cell attribute as flags << 18 | foreground << 9 | background; 0x1ff is the default color.
export const cellStyle = (screen: Widgets.Screen, column: number, row: number): CellStyle => {
  const cell = screenCells(screen)[row]?.[column]
  if (cell === undefined) {
    throw new RangeError(`No cell at column ${String(column)}, row ${String(row)}.`)
  }
  const [attribute] = cell
  return {
    foreground: (attribute >> 9) & 0x1_FF,
    background: attribute & 0x1_FF,
    isBold: ((attribute >> 18) & 1) === 1
  }
}
