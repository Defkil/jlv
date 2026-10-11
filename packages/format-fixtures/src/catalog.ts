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
}

export const legacyViewerFixtures = {
  characterization: {
    path: 'legacy-viewer/characterization.log',
    description: 'Thirty records out of time order with every upstream level, uppercase INFO, fatal and trace, ' +
      'records with and without extra data, a two-line and an overlong message, a numeric line, a record ' +
      'without a timestamp, truncated JSON, plain text, a null line and an empty line.',
    entries: 32,
    skippedLines: 3
  },
  empty: {
    path: 'legacy-viewer/empty.log',
    description: 'A zero-byte log.',
    entries: 0,
    skippedLines: 0
  },
  numericLevels: {
    path: 'legacy-viewer/numeric-levels.log',
    description: 'Three records with the numeric pino levels 30 and 40.',
    entries: 3,
    skippedLines: 0
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

export const fixtureUrl = (fixture: FixtureFile): URL => new URL(`../fixtures/${fixture.path}`, import.meta.url)

export const fixturePath = (fixture: FixtureFile): string => fileURLToPath(fixtureUrl(fixture))
