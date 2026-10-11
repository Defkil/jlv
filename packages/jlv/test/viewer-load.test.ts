// Characterization of the upstream viewer on blessed 0.1.81: initial load, layout, colors, malformed
// rows, empty logs and resize. Expectations record observed behavior, including known defects.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { upstreamFixture } from './support/fixtures.js'
import { loadLegacyLog } from './support/legacy.js'
import { cellStyle, keys, openFileViewer, plainTopBorder, press, screenText } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const empty = fixturePath(legacyViewerFixtures.empty)
const workflowEngine = fileURLToPath(upstreamFixture('workflow-engine.log.2017-09-25'))
const prettyMonolog = fileURLToPath(upstreamFixture('monolog.log.json'))

// Columns inside the panel: timestamp from 2, level from 28, data marker at 35, message from 38.
const levelColumn = 28
const defaultColor = 0x1_FF

describe('initial load', () => {
  it('renders newest first with the status line', t => {
    const viewer = openFileViewer(t, characterization)
    assert.deepEqual(screenText(viewer.screen), [
      plainTopBorder(),
      '│ undefined                          warn      no timestamp                    │',
      '│                                                                              │',
      '│ undefined                               undefined                            │',
      '│                                                                              │',
      '│ 2026-10-11T10:29:00.000Z  info   *  foxtrot 29                               │',
      '│ 2026-10-11T10:28:00.000Z  debug  *  echo 28                                  │',
      '│ 2026-10-11T10:27:00.000Z  error     delta 27                                 │',
      '│ 2026-10-11T10:26:00.000Z  warn   *  charlie 26                               │',
      '│ 2026-10-11T10:25:00.000Z  info   *  bravo 25                                 │',
      '│ 2026-10-11T10:24:00.000Z  debug     alpha 24                                 │',
      '│ 2026-10-11T10:23:00.000Z  error  *  foxtrot 23                               │',
      '│ 2026-10-11T10:22:00.000Z  trace  *  echo 22                                  │',
      '│ 2026-10-11T10:21:00.000Z  info      delta 21                                 │',
      '│ 2026-10-11T10:20:00.000Z  debug  *  charlie 20                               │',
      '│ 2026-10-11T10:19:00.000Z  error  *  bravo 19                                 │',
      '│ 2026-10-11T10:18:00.000Z  warn      alpha 18                                 │',
      '│ 2026-10-11T10:17:00.000Z  info   *  lima 17 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  │',
      '│ 2026-10-11T10:16:00.000Z  debug  *  echo 16                                  │',
      '│ 2026-10-11T10:15:00.000Z  error     delta 15                                 │',
      '│ 2026-10-11T10:14:00.000Z  warn   *  charlie 14                               │',
      '│ 2026-10-11T10:13:00.000Z  fatal  *  bravo 13                                 │',
      '└──────────────────────────────────────────────────────────────────────────────┘',
      '  NORMAL  1/32 | 20 | sort: -timestamp'
    ])
    assert.equal(viewer.panel.sort, '-timestamp')
    assert.equal(viewer.panel.pageHeight, 20)
  })

  it('sorts records without a timestamp first and wraps their undefined cells onto a second line', t => {
    const viewer = openFileViewer(t, characterization)
    const [first, second] = viewer.panel.lines
    assert.equal(first?.timestamp, undefined)
    assert.equal(first?.message, 'no timestamp')
    // A numeric JSON line becomes an entry without any field.
    assert.deepEqual(second, { data: {} })
  })

  it('colors the known levels, leaves trace and fatal plain and highlights the cursor row', t => {
    const viewer = openFileViewer(t, characterization)
    assert.deepEqual(cellStyle(viewer.screen, 2, 1), { foreground: 0, background: 7, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 5), { foreground: 228, background: defaultColor, isBold: true })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 6), { foreground: 6, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 7), { foreground: 1, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 8), { foreground: 214, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 12), { foreground: defaultColor, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 21), { foreground: defaultColor, background: defaultColor, isBold: false })
  })

  it('shows only the first line of a multi-line message and leaves an uppercase level unpadded', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.pageDown)
    const rows = screenText(viewer.screen)
    assert.equal(rows[2], '│ 2026-10-11T10:10:00.000Z  warn   *  kilo 10                                  │')
    assert.equal(rows[7], '│ 2026-10-11T10:05:00.000Z  INFO  *  foxtrot 05                                │')
  })
})

describe('malformed rows', () => {
  it('skips invalid JSON and null lines but keeps numbers as empty entries', () => {
    const { readLog } = loadLegacyLog()
    const entries = readLog(characterization)
    assert.equal(entries.length, legacyViewerFixtures.characterization.entries)
    assert.deepEqual(entries.filter(entry => entry.timestamp === undefined), [
      { data: {} },
      { level: 'warn', message: 'no timestamp', data: {} }
    ])
  })

  it('reads a pretty-printed JSON document as nothing', () => {
    const { readLog } = loadLegacyLog()
    assert.deepEqual(readLog(prettyMonolog), [])
  })
})

describe('empty log', () => {
  it('shows 1/0, moves the cursor to -1 and fails to open details', async t => {
    const viewer = openFileViewer(t, empty)
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], plainTopBorder())
    assert.equal(rows[23], '  NORMAL  1/0 | 20 | sort: -timestamp')
    await press(viewer, keys.down)
    assert.equal(viewer.panel.row, -1)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  0/0 | 20 | sort: -timestamp')
    assert.throws(() => { viewer.panel.displayDetails() }, TypeError)
  })
})

describe('upstream workflow-engine fixture', () => {
  // Replaces the useful expectations of the skipped upstream browser.test.js with the real widgets.
  it('renders timestamp, colored level and message columns sized to their content', async t => {
    const viewer = openFileViewer(t, workflowEngine)
    assert.equal(viewer.panel.lines.length, 74)
    await press(viewer, '$')
    const rows = screenText(viewer.screen)
    assert.equal(rows[21], '│ 2017-09-25T22:48:38.035Z  debug  *  Updated instance \'hemo\' with attributes  │')
    // The level keeps its own color inside the highlighted cursor row.
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 21), { foreground: 6, background: 7, isBold: false })
    await press(viewer, keys.up)
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 21), { foreground: 6, background: defaultColor, isBold: false })
  })

  it('interprets ANSI color sequences in messages and cuts them while truncating', async t => {
    const viewer = openFileViewer(t, workflowEngine)
    await press(viewer, keys.down)
    // The raw message starts with ESC[90m and continues with ESC[39m. Truncation counts escape bytes,
    // so the visible text ends with the remains of a cut sequence.
    assert.equal(screenText(viewer.screen)[1], '│ 2017-09-25T22:48:46.651Z  info   *  POST /workflows/hemo/instances[39        │')
    assert.equal(cellStyle(viewer.screen, 38, 1).foreground, 8)
  })
})

describe('resize', () => {
  it('relayouts the panel and moves the status line to the new last row', async t => {
    const viewer = openFileViewer(t, characterization)
    viewer.output.resizeTo(100, 30)
    await nextTurn()
    const rows = screenText(viewer.screen)
    assert.equal(rows.length, 30)
    assert.equal(rows[0], plainTopBorder(100))
    assert.equal(rows[29], '  NORMAL  1/32 | 26 | sort: -timestamp')
    assert.equal(viewer.panel.pageHeight, 26)
  })
})
