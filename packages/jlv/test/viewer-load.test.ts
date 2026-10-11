// Characterization of the viewer: initial load, layout, colors, malformed rows, empty logs and resize.
// Expectations record observed upstream behavior, including the defects that are still open.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { fixturePath, legacyViewerFixtures, pinoFixtures } from '../../format-fixtures/src/catalog.js'
import { upstreamFixture } from './support/fixtures.js'
import { readRecords, rowsOf } from './support/records.js'
import { cellStyle, keys, openFileViewer, press, screenText, topBorder, visibleEntries } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const empty = fixturePath(legacyViewerFixtures.empty)
const workflowEngine = fileURLToPath(upstreamFixture('workflow-engine.log.2017-09-25'))
const prettyMonolog = fileURLToPath(upstreamFixture('monolog.log.json'))

// Columns inside the panel: timestamp from 2, level from 28, data marker at 35, message from 38.
const levelColumn = 28
const defaultColor = 0x1_FF

describe('initial load', () => {
  // The status line counts the four lines that were skipped: truncated JSON, plain text, null and a number.
  it('renders newest first with the file label and the status line', t => {
    const viewer = openFileViewer(t, characterization)
    assert.deepEqual(screenText(viewer.screen), [
      topBorder('characterization.log', '1/31'),
      '│ 2026-10-11T10:29:00.000Z  info   req-29  *  foxtrot 29                       │',
      '│ 2026-10-11T10:28:00.000Z  debug  req-28  *  echo 28                          │',
      '│ 2026-10-11T10:27:00.000Z  error             delta 27                         │',
      '│ 2026-10-11T10:26:00.000Z  warn   req-26  *  charlie 26                       │',
      '│ 2026-10-11T10:25:00.000Z  info   req-25  *  bravo 25                         │',
      '│ 2026-10-11T10:24:00.000Z  debug             alpha 24                         │',
      '│ 2026-10-11T10:23:00.000Z  error  req-23  *  foxtrot 23                       │',
      '│ 2026-10-11T10:22:00.000Z  trace  req-22  *  echo 22                          │',
      '│ 2026-10-11T10:21:00.000Z  info              delta 21                         │',
      '│ 2026-10-11T10:20:00.000Z  debug  req-20  *  charlie 20                       │',
      '│ 2026-10-11T10:19:00.000Z  error  req-19  *  bravo 19                         │',
      '│ 2026-10-11T10:18:00.000Z  warn              alpha 18                         │',
      '│ 2026-10-11T10:17:00.000Z  info   req-17  *  lima 17 xxxxxxxxxxxxxxxxxxxxxx…  │',
      '│ 2026-10-11T10:16:00.000Z  debug  req-16  *  echo 16                          │',
      '│ 2026-10-11T10:15:00.000Z  error             delta 15                         │',
      '│ 2026-10-11T10:14:00.000Z  warn   req-14  *  charlie 14                       │',
      '│ 2026-10-11T10:13:00.000Z  fatal  req-13  *  bravo 13                         │',
      '│ 2026-10-11T10:12:00.000Z  debug             alpha 12                         │',
      '│ 2026-10-11T10:11:00.000Z  error  req-11  *  foxtrot 11                       │',
      String.raw`│ 2026-10-11T10:10:00.000Z  warn   req-10  *  kilo 10\nsecond line             │`,
      '│ 2026-10-11T10:09:00.000Z  info              delta 09                         │',
      '└──────────────────────────────────────────────────────────────────────────────┘',
      '  NORMAL  1/31 | 20 | sort: -timestamp | 4 skipped | ? help'
    ])
    assert.equal(viewer.panel.sort, '-timestamp')
    assert.equal(viewer.panel.pageHeight, 20)
  })

  // Upstream sorted the records without a timestamp first in descending order, the last of them first, and printed
  // their missing cells as undefined after measuring them as empty, so that each of their rows wrapped onto a second
  // line. Plan section 5 orders missing times last in both directions, where wrapped rows would push the last record
  // below the viewport.
  it('sorts the record without a timestamp last and shows its missing cell as empty', async t => {
    const viewer = openFileViewer(t, characterization)
    const entries = visibleEntries(viewer.panel)
    assert.deepEqual(entries.slice(-2).map(entry => [entry.timestamp, entry.level, entry.message, entry.data]), [
      ['2026-10-11T10:00:00.000Z', 'debug', 'alpha 00', {}],
      [undefined, 'warn', 'no timestamp', {}]
    ])
    await press(viewer, '$')
    assert.deepEqual(screenText(viewer.screen).slice(20, 23), [
      '│ 2026-10-11T10:00:00.000Z  debug             alpha 00                         │',
      '│                           warn              no timestamp                     │',
      '└──────────────────────────────────────────────────────────────────────────────┘'
    ])
  })

  it('colors the known levels, leaves trace and fatal plain and highlights the cursor row', t => {
    const viewer = openFileViewer(t, characterization)
    assert.deepEqual(cellStyle(viewer.screen, 2, 1), { foreground: 0, background: 7, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 5), { foreground: 228, background: defaultColor, isBold: true })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 2), { foreground: 6, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 3), { foreground: 1, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 4), { foreground: 214, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 8), { foreground: defaultColor, background: defaultColor, isBold: false })
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 17), { foreground: defaultColor, background: defaultColor, isBold: false })
  })

  // Upstream showed INFO unpadded and without a color, since only lowercase levels had one; levels are normalized now
  // (upstream issue #14).
  // Upstream showed the first line of a multi-line message only; the line break shows as \n now, as in plain output.
  it('shows the line break of a multi-line message as an escape and an uppercase level normalized', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'g', '19', keys.enter)
    const rows = screenText(viewer.screen)
    assert.equal(rows[2], String.raw`│ 2026-10-11T10:10:00.000Z  warn   req-10  *  kilo 10\nsecond line             │`)
    assert.equal(rows[7], '│ 2026-10-11T10:05:00.000Z  info   req-05  *  foxtrot 05                       │')
    assert.equal(visibleEntries(viewer.panel).find(entry => entry.message === 'foxtrot 05')?.record.fields['level'], 'INFO')
  })
})

describe('malformed rows', () => {
  // Upstream kept the numeric line as an entry without fields; JSON values other than objects are diagnostics now.
  it('skips invalid JSON, null and numbers and keeps the record without a timestamp', async () => {
    const { records, diagnostics } = await readRecords(readFileSync(characterization))
    assert.equal(records.length, legacyViewerFixtures.characterization.records)
    assert.equal(diagnostics.length, legacyViewerFixtures.characterization.skippedRecords)
    assert.deepEqual(rowsOf(records).filter(row => row.timestamp === undefined).map(row => [row.level, row.message, row.data]), [
      ['warn', 'no timestamp', {}]
    ])
  })

  it('reads a pretty-printed JSON document as no records', async () => {
    const { records } = await readRecords(readFileSync(prettyMonolog))
    assert.equal(records.length, 0)
  })
})

describe('empty log', () => {
  // Upstream moved the cursor to -1 (status 0/0) and threw a TypeError for details.
  it('shows 1/0, keeps the cursor on row 0 and opens no details', async t => {
    const viewer = openFileViewer(t, empty)
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], topBorder('empty.log', '1/0'))
    assert.equal(rows[23], '  NORMAL  1/0 | 20 | sort: -timestamp | ? help')
    await press(viewer, keys.down)
    assert.equal(viewer.panel.row, 0)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/0 | 20 | sort: -timestamp | ? help')
    viewer.panel.displayDetails()
    assert.equal(viewer.screen.children.length, 2)
  })
})

describe('upstream workflow-engine fixture', () => {
  // Replaces the useful expectations of the skipped upstream browser.test.js with the real widgets.
  it('renders timestamp, colored level and message columns sized to their content', async t => {
    const viewer = openFileViewer(t, workflowEngine)
    assert.equal(visibleEntries(viewer.panel).length, 74)
    await press(viewer, '$')
    const rows = screenText(viewer.screen)
    assert.equal(rows[21], '│ 2017-09-25T22:48:38.035Z  debug  *  Updated instance \'hemo\' with attributes  │')
    // The level keeps its own color inside the highlighted cursor row.
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 21), { foreground: 6, background: 7, isBold: false })
    await press(viewer, keys.up)
    assert.deepEqual(cellStyle(viewer.screen, levelColumn, 21), { foreground: 6, background: defaultColor, isBold: false })
  })

  // Upstream issue #18: blessed acted on the escape sequences of a message, and the cut counted their bytes, so that the
  // row ended with the remains of a cut sequence.
  it('shows a message without its ANSI color sequences and cuts it by its visible text', async t => {
    const viewer = openFileViewer(t, workflowEngine)
    await press(viewer, keys.down)
    // The raw message is ESC[90mPOST /workflows/hemo/instancesESC[39m ESC[32m200ESC[39m ESC[90m442msESC[39m.
    assert.equal(screenText(viewer.screen)[1], '│ 2017-09-25T22:48:46.651Z  info   *  POST /workflows/hemo/instances 200 442…  │')
    assert.deepEqual([38, 69, 73].map(column => cellStyle(viewer.screen, column, 1).foreground), [defaultColor, defaultColor, defaultColor])
  })
})

describe('formats and configuration', () => {
  // jlv-pino's fixture needs no transformer: the levels come from pino's numbers.
  it('shows pino records with their levels and names the format and the configuration file in the status line', t => {
    const viewer = openFileViewer(t, fixturePath(pinoFixtures.levels), { configuration: 'jlv.config.json' })
    const rows = screenText(viewer.screen)
    assert.equal(rows[1], '│ 2026-10-11T10:00:05.000Z  fatal  *  fatal message                            │')
    assert.equal(rows[6], '│ 2026-10-11T10:00:00.000Z  trace  *  trace message                            │')
    assert.equal(rows[23], '  NORMAL  1/6 | 20 | sort: -timestamp | format: pino | config: jlv.config.json')
  })
})

describe('resize', () => {
  it('relayouts the panel and moves the status line to the new last row', async t => {
    const viewer = openFileViewer(t, characterization)
    viewer.output.resizeTo(100, 30)
    await nextTurn()
    const rows = screenText(viewer.screen)
    assert.equal(rows.length, 30)
    assert.equal(rows[0], topBorder('characterization.log', '1/31', 100))
    assert.equal(rows[29], '  NORMAL  1/31 | 26 | sort: -timestamp | 4 skipped | ? help')
    assert.equal(viewer.panel.pageHeight, 26)
  })
})
