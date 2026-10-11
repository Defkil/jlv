// Typed access to the untyped upstream CommonJS modules under test. The faithful TypeScript port
// (plan §8 phase 3) replaces each loader with an import of the ported module.
import { createRequire } from 'node:module'
import type { Readable, Writable } from 'node:stream'
import type { Widgets } from 'blessed'

const loadModule = createRequire(import.meta.url)

export interface LegacyEntry {
  readonly timestamp?: unknown
  readonly level?: unknown
  readonly message?: unknown
  readonly data: Readonly<Record<string, unknown>>
}

export interface LogReader {
  readFileSync: (file: string) => string | Buffer
}

export interface ConfigFileSystem {
  existsSync: (file: string) => boolean
  readFileSync: (file: string, encoding: 'utf8') => string | null
}

export interface LegacyLog {
  readLog: (file: string, reader?: LogReader) => LegacyEntry[]
  transform: (entry: unknown, fileSystem?: ConfigFileSystem) => unknown
}

export interface LegacyColumn {
  readonly key: string
  readonly length?: number
  readonly format?: (value: string) => string
}

export type LegacyRow = Readonly<Record<string, string | undefined>>

export interface LegacyUtilities {
  formatRows: (rows: readonly LegacyRow[], columns: readonly LegacyColumn[], spacing?: number, maxWidth?: number) => string[]
  maxLengths: (columns: readonly LegacyColumn[], rows: readonly LegacyRow[], spacing: number, maxWidth: number) => Record<string, number>
  hasColors: (text: string) => boolean
  stripColors: (text: string | undefined) => string
  spaces: (count: number) => string
  padEnd: (text: string, length: number, shouldIgnoreColors?: boolean) => string
  len: (text: string | null | undefined, shouldIgnoreColors?: boolean) => number
  trunc: (text: string | null, length: number, shouldIgnoreColors?: boolean) => string
  levelColors: Readonly<Record<string, (text: string) => string>>
}

// @types/blessed declares the screen streams the wrong way round (plan §0.9).
export type ScreenOptions = Omit<Widgets.IScreenOptions, 'input' | 'output'> & {
  readonly input: Readable
  readonly output: Writable
}

export interface TerminalLibrary {
  readonly screen: (options: ScreenOptions) => Widgets.Screen
}

export interface LegacyFilter {
  readonly key: string
  readonly value: string
  readonly method?: string
}

export interface LegacyMainPanel extends Widgets.BoxElement {
  row: number
  initialRow: number
  rows: LegacyEntry[]
  readonly lines: LegacyEntry[]
  readonly lastRow: number
  readonly pageHeight: number
  readonly relativeRow: number
  sort: string
  filters: LegacyFilter[]
  levelFilter: string | null | undefined
  mode: string
  wrap: boolean
  lastSearchTerm: string | null
  loadFile: (file: string) => void
  setCurrent: () => this
  displayDetails: () => void
  moveDown: () => void
  renderLines: (shouldNotify?: boolean) => void
}

export interface LegacyMainPanelOptions {
  readonly screen: Widgets.Screen
  readonly level?: string | undefined
  readonly sort?: string | undefined
}

export type LegacyMainPanelClass = new (options: LegacyMainPanelOptions) => LegacyMainPanel

export interface LegacyStatusLineOptions {
  readonly screen: Widgets.Screen
  readonly mainPanel: LegacyMainPanel
}

export type LegacyStatusLineClass = new (options: LegacyStatusLineOptions) => Widgets.BoxElement

export interface LegacyLogDetails extends Widgets.BoxElement {
  json: boolean
  // The scrollable element that holds the formatted entry.
  el: Widgets.BoxElement | null
  display: (entry: LegacyEntry) => void
}

export type LegacyLogDetailsClass = new (options: { readonly screen: Widgets.Screen }) => LegacyLogDetails

export const loadLegacyLog = (): LegacyLog => loadModule('../../src/log.js') as LegacyLog

export const loadLegacyUtilities = (): LegacyUtilities => loadModule('../../src/utils.js') as LegacyUtilities

// The widgets require blessed themselves; this loads the same module instance for the screen.
export const loadTerminalLibrary = (): TerminalLibrary => loadModule('blessed') as TerminalLibrary

export const loadMainPanel = (): LegacyMainPanelClass => loadModule('../../src/widgets/MainPanel.js') as LegacyMainPanelClass

export const loadStatusLine = (): LegacyStatusLineClass => loadModule('../../src/widgets/StatusLine.js') as LegacyStatusLineClass

export const loadLogDetails = (): LegacyLogDetailsClass => loadModule('../../src/widgets/LogDetails.js') as LegacyLogDetailsClass
