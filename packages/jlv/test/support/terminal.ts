// Headless terminal for characterization tests: real key sequences go in through a stream, and the
// logical screen (characters and attributes per cell) comes out, independent of escape-code output.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Widgets } from 'blessed'
import { Ingestion } from '../../src/application.js'
import type { SourceInformation } from '../../src/input/files.js'
import { LineSplitter } from '../../src/input/lines.js'
import { parseEntry, readMapping, type LogEntry } from '../../src/log.js'
import { RecordStore } from '../../src/store.js'
import { createScreen } from '../../src/tui/blessed-boundary.js'
import { MainPanel } from '../../src/tui/main-panel.js'
import { RecordView } from '../../src/tui/record-view.js'
import { StatusLine } from '../../src/tui/status-line.js'

export class TerminalOutput extends Writable {
  readonly isTTY = true
  columns: number
  rows: number
  // Everything written, when the output records it.
  written = ''
  readonly isRecording: boolean

  constructor (columns: number, rows: number, isRecording = false) {
    super()
    this.columns = columns
    this.rows = rows
    this.isRecording = isRecording
  }

  override _write (chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.isRecording) {
      this.written += chunk.toString('utf8')
    }
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
  readonly panel: MainPanel
  readonly status: Widgets.BoxElement
  readonly store: RecordStore
  readonly ingestion: Ingestion
  // Lets more lines arrive at the file's source and shows them, as the application does after each chunk.
  readonly append: (text: string) => void
}

export interface ViewerOptions {
  readonly columns?: number
  readonly rows?: number
  readonly level?: string
  readonly sort?: string
  readonly maximumRecords?: number
  readonly maximumBytes?: number
}

// The main panel's top border with its label: the file name and the cursor position.
export const topBorder = (file: string, position: string, columns = 80): string => {
  const label = `[ ${file} ] [ ${position} ]`
  return `┌──${label}${'─'.repeat(columns - 4 - label.length)}┐`
}

export const keys = {
  up: '\u{1B}[A',
  down: '\u{1B}[B',
  pageUp: '\u{1B}[5~',
  pageDown: '\u{1B}[6~',
  shiftPageDown: '\u{1B}[6;2~',
  home: '\u{1B}[H',
  end: '\u{1B}[F',
  enter: '\r',
  escape: '\u{1B}'
} as const

// Mirrors the command line: a screen, a MainPanel with the records of the file, the status line, focus, render.
// The file is read through the same framing, parsing and store as the command line, but at once.
// blessed binds parentless elements to the newest screen once several exist, so each test owns the only
// live screen and destroys it afterwards.
export const openViewer = (context: TestContext, file: string, options: ViewerOptions = {}): Viewer => {
  const input = new PassThrough()
  const output = new TerminalOutput(options.columns ?? 80, options.rows ?? 24)
  const screen = createScreen({
    input,
    output,
    terminal: 'xterm-256color',
    forceUnicode: true,
    smartCSR: true,
    warnings: false
  })
  context.after(() => { screen.destroy() })
  const mapping = readMapping()
  const store = new RecordStore({ maximumRecords: options.maximumRecords, maximumBytes: options.maximumBytes })
  const ingestion = new Ingestion({ store, mapping })
  const source: SourceInformation = { identifier: '1', label: file, order: 0 }
  const fileLines = new LineSplitter()
  ingestion.accept(source, [...fileLines.push(readFileSync(file)), ...fileLines.end()])
  ingestion.activity = 'done'
  const view = new RecordView(store, text => parseEntry(text, mapping))
  const panel = new MainPanel({ screen, view, label: file, progress: ingestion, level: options.level, sort: options.sort })
  const status = new StatusLine({ screen, mainPanel: panel })
  screen.append(status)
  panel.setCurrent()
  screen.render()
  const lines = new LineSplitter()
  const append = (text: string): void => {
    ingestion.accept(source, lines.push(Buffer.from(text, 'utf8')))
    panel.refresh()
  }
  return { input, output, screen, panel, status, store, ingestion, append }
}

// The rows of all visible records, in order.
export const visibleEntries = (panel: MainPanel): LogEntry[] => panel.order.map(sequence => panel.view.entry(sequence))

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
