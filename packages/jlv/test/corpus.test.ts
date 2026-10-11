// The shared fixture corpus of packages/format-fixtures (plan section 8, phase 6): every fixture through the format
// pipeline, as a whole and in chunks of one byte, gives the format, the records and the diagnostics of its catalogue
// entry. Byte chunks split every token, every multi-byte character and every line ending.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fixturePath, formatFixtures, type ExpectedRecord, type FormatFixture } from '../../format-fixtures/src/catalog.js'
import type { FieldPath, LogLevel, TimestampUnit } from '../src/api.js'
import { builtInFormats } from '../src/formats/registry.js'
import { isLogLevel, timestampUnits } from '../src/record.js'
import { displayTimestamp } from '../src/tui/log-row.js'
import { readRecords, type ReadOptions, type ReadResult } from './support/records.js'

const isTimestampUnit = (text: string): text is TimestampUnit => new Set<string>(timestampUnits).has(text)

// The read options of a fixture's settings.
const optionsOf = (fixture: FormatFixture): ReadOptions => {
  const settings = 'settings' in fixture ? fixture.settings : undefined
  const formats = builtInFormats()
  const format = formats.find(candidate => candidate.identifier === settings?.format)
  const unit = settings?.timestampUnit
  const levels: Record<string, LogLevel> = {}
  const rawLevels = Object.entries(settings?.levels ?? {})
  for (const [raw, level] of rawLevels) {
    assert.ok(isLogLevel(level), level)
    levels[raw] = level
  }
  const mapping: Record<string, FieldPath> = { ...settings?.mapping }
  return {
    file: fixture.path,
    formats,
    mapping,
    levels,
    ...(format !== undefined && { format }),
    ...(unit !== undefined && isTimestampUnit(unit) && { timestampUnit: unit })
  }
}

const expectedRecords = (result: ReadResult): ExpectedRecord[] => result.records.map(({ record }) => {
  const timestamp = displayTimestamp(record)
  return { level: record.level, message: record.message, ...(timestamp !== undefined && { timestamp }) }
})

const diagnosticsOf = (result: ReadResult): string[] =>
  result.diagnostics.map(diagnostic => `${String(diagnostic.position?.firstLine)}:${diagnostic.code}`)

const fixtures = Object.entries<FormatFixture>(formatFixtures)

describe('format fixture corpus', () => {
  for (const [name, fixture] of fixtures) {
    it(`reads ${name}: ${fixture.description}`, async () => {
      const bytes = readFileSync(fixturePath(fixture))
      const options = optionsOf(fixture)
      const whole = await readRecords(bytes, options)
      assert.equal(whole.format, fixture.format)
      assert.deepEqual(expectedRecords(whole), fixture.records)
      assert.deepEqual(diagnosticsOf(whole), fixture.diagnostics)
      const bytewise = await readRecords(bytes, { ...options, chunkBytes: 1 })
      assert.equal(bytewise.format, whole.format)
      assert.deepEqual(bytewise.records, whole.records)
      assert.deepEqual(bytewise.diagnostics, whole.diagnostics)
    })
  }
})
