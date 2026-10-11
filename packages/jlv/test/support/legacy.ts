// Typed access to the untyped upstream CommonJS modules under test. The faithful TypeScript port
// (plan §8 phase 3) replaces each loader with an import of the ported module.
import { createRequire } from 'node:module'
import type { Widgets } from 'blessed'

const loadModule = createRequire(import.meta.url)

export interface LegacyEntry {
  readonly timestamp?: unknown
  readonly level?: unknown
  readonly message?: unknown
  readonly data: Readonly<Record<string, unknown>>
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

export interface LegacyLogDetails extends Widgets.BoxElement {
  json: boolean
  // The scrollable element that holds the formatted entry.
  el: Widgets.BoxElement | null
  display: (entry: LegacyEntry) => void
}

export type LegacyLogDetailsClass = new (options: { readonly screen: Widgets.Screen }) => LegacyLogDetails

export const loadMainPanel = (): LegacyMainPanelClass => loadModule('../../src/widgets/MainPanel.js') as LegacyMainPanelClass

export const loadLogDetails = (): LegacyLogDetailsClass => loadModule('../../src/widgets/LogDetails.js') as LegacyLogDetailsClass
