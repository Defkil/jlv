// Correlation identifiers in the viewer (plan section 6.3, upstream issue #15): a column in a fixed palette whose
// color comes from the identifier's text alone, and c, which shows only the records of the selected record's
// identifier and all records again, with the selection kept across sorts, new records and eviction.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, type TestContext } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { correlationColor, correlationPalette } from '../src/tui/correlation-colors.js'
import { cellStyle, keys, openFileViewer, press, screenText, visibleEntries, type Viewer } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

// The column of the identifiers on an 80-column screen: after the timestamp, the level and their gaps.
const identifierColumn = 35

// Records whose identifiers are 0 as a number, as text and nested in req.id, empty text, missing, and two others.
const identifiers = [
  { timestamp: '2026-10-11T10:00:00.000Z', level: 'info', message: 'number zero', requestId: 0 },
  { timestamp: '2026-10-11T10:01:00.000Z', level: 'info', message: 'text zero', requestId: '0' },
  { timestamp: '2026-10-11T10:02:00.000Z', level: 'info', message: 'nested zero', req: { id: 0 } },
  { timestamp: '2026-10-11T10:03:00.000Z', level: 'info', message: 'empty', requestId: '' },
  { timestamp: '2026-10-11T10:04:00.000Z', level: 'info', message: 'missing' },
  { timestamp: '2026-10-11T10:05:00.000Z', level: 'info', message: 'other', correlationId: 'other' },
  { timestamp: '2026-10-11T10:06:00.000Z', level: 'warn', message: 'zero again', traceId: 0 }
]

const identifierLog = (context: TestContext): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jlv-correlation-'))
  context.after(() => {
    process.chdir(tmpdir())
    rmSync(directory, { recursive: true, force: true })
  })
  const file = path.join(directory, 'identifiers.log')
  writeFileSync(file, identifiers.map(record => `${JSON.stringify(record)}\n`).join(''))
  return file
}

const messages = (viewer: Viewer): string[] => visibleEntries(viewer.panel).map(entry => entry.message)

// A record that arrives later, with a correlation identifier.
const record = (minute: number, message: string, requestId: string): string =>
  `${JSON.stringify({ timestamp: `2026-10-11T11:${String(minute).padStart(2, '0')}:00.000Z`, level: 'info', message, requestId })}\n`

const selectedMessage = (viewer: Viewer): string | undefined => viewer.panel.entryAt(viewer.panel.row)?.message

// The screen row of a message and the color of its identifier cell.
const identifierColor = (viewer: Viewer, message: string): number => {
  const row = screenText(viewer.screen).findIndex(line => line.includes(` ${message} `))
  assert.ok(row !== -1, message)
  return cellStyle(viewer.screen, identifierColumn, row).foreground
}

describe('correlation colors', () => {
  it('come from the identifier alone, from a fixed palette', () => {
    const colors = new Set<string>()
    for (let index = 0; index < 100_000; index += 1) {
      const color = correlationColor(`request-${String(index)}`)
      assert.ok(correlationPalette.includes(color))
      colors.add(color)
    }
    assert.equal(colors.size, correlationPalette.length)
    assert.equal(correlationColor('req-28'), correlationColor(['req', '28'].join('-')))
    assert.equal(correlationColor('0'), correlationColor(String(0)))
    assert.equal(correlationPalette.length, 12)
  })
})

describe('correlation column', () => {
  it('shows the identifiers in their colors, the same identifier in the same color in every order', async t => {
    const viewer = openFileViewer(t, characterization)
    assert.equal(screenText(viewer.screen)[2], '│ 2026-10-11T10:28:00.000Z  debug  req-28  *  echo 28                          │')
    const before = identifierColor(viewer, 'echo 28')
    assert.equal(String(before), correlationColor('req-28'))
    await press(viewer, keys.down)
    // The cursor row keeps the identifier's color on the white background.
    assert.equal(identifierColor(viewer, 'echo 28'), before)
    assert.equal(cellStyle(viewer.screen, identifierColumn, 2).background, 7)
    // Sorted by message, the cursor stays on echo 28, below echo 22.
    await press(viewer, 's', 'm')
    assert.equal(identifierColor(viewer, 'echo 28'), before)
    assert.equal(String(identifierColor(viewer, 'echo 22')), correlationColor('req-22'))
  })

  it('shows no column for an input without identifiers', t => {
    const viewer = openFileViewer(t, fixturePath(legacyViewerFixtures.numericLevels))
    assert.doesNotMatch(screenText(viewer.screen)[1] ?? '', /req-/u)
    assert.equal(viewer.ingestion.hasCorrelation, false)
  })
})

describe('filtering by correlation identifier', () => {
  it('shows only the records of the selected identifier with c and all again with a second c, on the same record', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down)
    assert.equal(selectedMessage(viewer), 'echo 28')
    await press(viewer, 'c')
    assert.deepEqual(messages(viewer), ['echo 28'])
    assert.deepEqual(viewer.panel.filterDescriptions, ['correlationIdentifier="req-28"'])
    assert.equal(selectedMessage(viewer), 'echo 28')
    await press(viewer, 'c')
    assert.equal(visibleEntries(viewer.panel).length, 31)
    assert.equal(selectedMessage(viewer), 'echo 28')
    assert.deepEqual(viewer.panel.filterDescriptions, [])
  })

  it('keeps the other filters and adds up with them', async t => {
    const viewer = openFileViewer(t, characterization, { level: 'debug' })
    await press(viewer, 'c')
    assert.deepEqual(viewer.panel.filterDescriptions, ['level=debug', 'correlationIdentifier="req-28"'])
    await press(viewer, 'l', 'a')
    assert.deepEqual(messages(viewer), ['echo 28'])
  })

  it('reports a record without an identifier and changes no filter', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down)
    assert.equal(selectedMessage(viewer), 'delta 27')
    await press(viewer, 'c')
    assert.ok(screenText(viewer.screen).some(row => row.includes('The record has no correlation')))
    assert.equal(visibleEntries(viewer.panel).length, 31)
    await press(viewer, keys.enter)
    assert.equal(selectedMessage(viewer), 'delta 27')
  })

  // The identifier 0 is "0", for a number, text and a nested req.id alike; empty text and a missing identifier are
  // none, and select nothing.
  it('matches the identifier 0 exactly, and no record without one', async t => {
    const viewer = openFileViewer(t, identifierLog(t), { sort: 'arrival' })
    await press(viewer, '0')
    assert.equal(selectedMessage(viewer), 'number zero')
    await press(viewer, 'c')
    assert.deepEqual(messages(viewer), ['number zero', 'text zero', 'nested zero', 'zero again'])
    await press(viewer, 'c', 'g', '4', keys.enter)
    assert.equal(selectedMessage(viewer), 'empty')
    await press(viewer, 'c')
    assert.equal(visibleEntries(viewer.panel).length, 7)
    assert.deepEqual(viewer.panel.filterDescriptions, [])
  })

  it('keeps the selected record across new records and eviction while the filter applies', async t => {
    const viewer = openFileViewer(t, characterization, { maximumRecords: 31 })
    await press(viewer, keys.down, 'c')
    viewer.append(record(1, 'same request', 'req-28'))
    // A cursor at the newest end follows the newest record; any other stays on its record.
    assert.equal(selectedMessage(viewer), 'same request')
    await press(viewer, keys.down)
    viewer.append(record(2, 'later request', 'req-28') + record(3, 'other request', 'req-99'))
    assert.deepEqual(messages(viewer), ['later request', 'same request', 'echo 28'])
    assert.equal(selectedMessage(viewer), 'echo 28')
    assert.equal(viewer.store.evicted, 3)
    await press(viewer, 'c')
    assert.equal(selectedMessage(viewer), 'echo 28')
    assert.equal(visibleEntries(viewer.panel).length, 31)
  })
})
