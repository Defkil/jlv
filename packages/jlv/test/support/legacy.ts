// Typed access to the untyped upstream CommonJS modules under test. The faithful TypeScript port
// (plan §8 phase 3) replaces each loader with an import of the ported module.
import { createRequire } from 'node:module'

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

export const loadLegacyLog = (): LegacyLog => loadModule('../../src/log.js') as LegacyLog

export const loadLegacyUtilities = (): LegacyUtilities => loadModule('../../src/utils.js') as LegacyUtilities
