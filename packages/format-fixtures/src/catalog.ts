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
  }
} as const satisfies Readonly<Record<string, LegacyViewerFixture>>

export const fixtureUrl = (fixture: FixtureFile): URL => new URL(`../fixtures/${fixture.path}`, import.meta.url)

export const fixturePath = (fixture: FixtureFile): string => fileURLToPath(fixtureUrl(fixture))
