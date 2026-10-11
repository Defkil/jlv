// Typed catalogue of the shared fixtures. Locations resolve relative to this module, so they work in
// the source tree and in the emitted test tree alike.
import { fileURLToPath } from 'node:url'

export interface FixtureFile {
  // Relative to the fixtures directory, with forward slashes.
  readonly path: string
  readonly description: string
}

export interface LegacyViewerFixture extends FixtureFile {
  // Rows that upstream readLog returns for the file.
  readonly entries: number
  // Non-empty lines that upstream readLog drops.
  readonly skippedLines: number
  // Records of the final model (plan section 5), which reads JSON objects only.
  readonly records: number
  // Lines that the final model reports and skips: no JSON, or JSON values other than objects.
  readonly skippedRecords: number
}

export const legacyViewerFixtures = {
  characterization: {
    path: 'legacy-viewer/characterization.log',
    description: 'Thirty records out of time order with every upstream level, uppercase INFO, fatal and trace, ' +
      'records with and without extra data, a two-line and an overlong message, a numeric line, a record ' +
      'without a timestamp, truncated JSON, plain text, a null line and an empty line.',
    entries: 32,
    skippedLines: 3,
    records: 31,
    skippedRecords: 4
  },
  empty: {
    path: 'legacy-viewer/empty.log',
    description: 'A zero-byte log.',
    entries: 0,
    skippedLines: 0,
    records: 0,
    skippedRecords: 0
  },
  numericLevels: {
    path: 'legacy-viewer/numeric-levels.log',
    description: 'Three generic records with pino\'s numeric levels 30 and 40, which only pino\'s profile reads as levels.',
    entries: 3,
    skippedLines: 0,
    records: 3,
    skippedRecords: 0
  }
} as const satisfies Readonly<Record<string, LegacyViewerFixture>>

export interface PinoLevelFixture extends FixtureFile {
  // The level names that jlv-pino's transformer wrote for the numeric levels, one per record in file order.
  readonly levels: readonly string[]
}

// The fixtures of Defkil/jlv-pino 7edcd81, which plan section 4.1 moves here when its transformer is retired. Built-in
// pino support (plan section 6.2) has to read them without the transformer.
export const pinoFixtures = {
  mapping: {
    path: 'pino/jlv-pino-mapping.ini',
    description: 'The ~/.json-log-viewer mapping that jlv-pino shipped as .json-log-viewer: time to timestamp, msg to ' +
      'message, level as it is, and the whole record below extra. Moved unchanged.'
  },
  levels: {
    path: 'pino/jlv-pino-levels.log',
    description: 'One pino record for each level case of jlv-pino\'s test/index.test.js, 10 to 60 in order, so the ' +
      'fatal record is the final row: jlv-pino\'s transformer noted that its last replacement was ignored and ' +
      'repeated the one for level 60.',
    levels: ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
  }
} as const satisfies { readonly mapping: FixtureFile, readonly levels: PinoLevelFixture }

// What jlv makes of a record of a fixture: its normalized level, its message, and its timestamp as the viewer shows
// it (UTC RFC 3339 with milliseconds, or the original text of a timestamp that is no time), or none.
export interface ExpectedRecord {
  readonly level: string
  readonly message: string
  readonly timestamp?: string
}

// The settings that a run needs for a fixture: --format, --timestamp-unit and a configuration's mapping, CSV
// delimiter and levels.
export interface FixtureSettings {
  readonly format?: string
  readonly timestampUnit?: string
  readonly mapping?: Readonly<Record<string, readonly (string | number)[]>>
  readonly levels?: Readonly<Record<string, string>>
  readonly csvDelimiter?: string
}

export interface FormatFixture extends FixtureFile {
  // The format that reads the file: the one jlv recognizes, or the one the settings name.
  readonly format: string
  readonly settings?: FixtureSettings
  readonly records: readonly ExpectedRecord[]
  // The first line and the code of each diagnostic, as '<line>:<code>', in input order.
  readonly diagnostics: readonly string[]
}

// A second of 2026-10-11 from 10:00:00 UTC, as the viewer shows it.
const at = (second: number): string => new Date(Date.UTC(2026, 9, 11, 10, 0, second)).toISOString()

// The shared corpus of the built-in formats (plan section 6.2). Every fixture is read whole and in chunks of one byte,
// on every supported Node version, and must give the same records and diagnostics.
export const formatFixtures = {
  pinoLevels: {
    path: pinoFixtures.levels.path,
    description: 'jlv-pino\'s six levels, 10 to 60, with fatal on the final row.',
    format: 'pino',
    records: pinoFixtures.levels.levels.map((level, second) => ({ level, message: `${level} message`, timestamp: at(second) })),
    diagnostics: []
  },
  pinoStructure: {
    path: 'pino/pino-structure.log',
    description: 'The cases that text substitution got wrong: spaces around the colons, "level":50 inside a message, ' +
      'a nested level, the level 100, a record without time, one without msg, a large error object, and fatal on ' +
      'the final row without a line feed.',
    format: 'pino',
    records: [
      { level: 'info', message: 'spaces around the colons', timestamp: at(0) },
      { level: 'info', message: 'the text "level":50 in a message stays text', timestamp: at(1) },
      { level: 'warn', message: 'a nested level stays as it is', timestamp: at(2) },
      { level: 'unknown', message: 'level 100 is no pino level', timestamp: at(3) },
      { level: 'info', message: 'a record without time' },
      { level: 'debug', message: '', timestamp: at(5) },
      { level: 'error', message: 'request failed', timestamp: at(6) },
      { level: 'fatal', message: 'fatal on the final row, without a line feed', timestamp: at(7) }
    ],
    diagnostics: []
  },
  bunyan: {
    path: 'bunyan/bunyan.log',
    description: 'bunyan records with v 0, name, hostname and pid: every level, extra fields, an error object, a child ' +
      'logger\'s field and fractional seconds.',
    format: 'bunyan',
    records: [
      { level: 'info', message: 'hi', timestamp: at(0) },
      { level: 'warn', message: 'au revoir', timestamp: at(1) },
      { level: 'error', message: 'boom', timestamp: at(2) },
      { level: 'debug', message: 'child logger', timestamp: '2026-10-11T10:00:03.123Z' },
      { level: 'fatal', message: 'fatal', timestamp: at(4) },
      { level: 'trace', message: 'trace', timestamp: at(5) },
      { level: 'info', message: 'request', timestamp: at(6) }
    ],
    diagnostics: []
  },
  bunyanLookalike: {
    path: 'bunyan/bunyan-lookalike.log',
    description: 'JSON that resembles bunyan without its signature: text levels, a message key, version 1. It stays ' +
      'generic JSON lines, which read timestamp, level and message.',
    format: 'jsonl',
    records: [
      { level: 'info', message: '' },
      { level: 'warn', message: 'message key' },
      { level: 'error', message: '', timestamp: at(2) }
    ],
    diagnostics: []
  },
  winston: {
    path: 'winston/winston.log',
    description: 'Winston\'s JSON format with an uppercase level, metadata, a stack, and the npm and syslog level names ' +
      'http, verbose, silly, crit and notice, read with --format winston.',
    format: 'winston',
    settings: { format: 'winston' },
    records: [
      { level: 'info', message: 'server started', timestamp: at(0) },
      { level: 'warn', message: 'slow response', timestamp: at(1) },
      { level: 'error', message: 'request failed', timestamp: at(2) },
      { level: 'info', message: 'GET /health 200', timestamp: at(3) },
      { level: 'debug', message: 'cache warm', timestamp: at(4) },
      { level: 'trace', message: 'tick', timestamp: at(5) },
      { level: 'fatal', message: 'disk full', timestamp: at(6) },
      { level: 'info', message: 'config reloaded', timestamp: at(7) }
    ],
    diagnostics: []
  },
  winstonAsJsonLines: {
    path: 'winston/winston.log',
    description: 'The same Winston output without --format: no probe claims Winston, so generic JSON lines read it and ' +
      'keep Winston\'s own level names unknown.',
    format: 'jsonl',
    records: [
      { level: 'info', message: 'server started', timestamp: at(0) },
      { level: 'warn', message: 'slow response', timestamp: at(1) },
      { level: 'error', message: 'request failed', timestamp: at(2) },
      { level: 'unknown', message: 'GET /health 200', timestamp: at(3) },
      { level: 'unknown', message: 'cache warm', timestamp: at(4) },
      { level: 'unknown', message: 'tick', timestamp: at(5) },
      { level: 'unknown', message: 'disk full', timestamp: at(6) },
      { level: 'unknown', message: 'config reloaded', timestamp: at(7) }
    ],
    diagnostics: []
  }
} as const satisfies Readonly<Record<string, FormatFixture>>

export const fixtureUrl = (fixture: FixtureFile): URL => new URL(`../fixtures/${fixture.path}`, import.meta.url)

export const fixturePath = (fixture: FixtureFile): string => fileURLToPath(fixtureUrl(fixture))
