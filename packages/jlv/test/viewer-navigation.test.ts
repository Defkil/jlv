// Characterization of cursor movement, paging, go-to-line and wrapping in the viewer.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, type TestContext } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { cellStyle, keys, openFileViewer, press, screenText, topBorder } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

// A log whose newest record has a message with tabs. The panel cuts the message by its number of characters, but
// blessed shows each tab as four spaces, so that row is longer than the panel. Upstream got the same from a message
// array, which it padded by its number of elements. The directory is removed after the test.
const overlongLog = (context: TestContext): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jlv-wrap-'))
  context.after(() => {
    process.chdir(tmpdir())
    rmSync(directory, { recursive: true, force: true })
  })
  const records = [
    { timestamp: '2026-10-11T10:02:00.000Z', level: 'info', message: 'tabs\tare\twider\tthan\tthey\tcount\tso\tthis\trow\twraps' },
    { timestamp: '2026-10-11T10:01:00.000Z', level: 'warn', message: 'short' },
    { timestamp: '2026-10-11T10:00:00.000Z', level: 'error', message: 'last' }
  ]
  const file = path.join(directory, 'overlong.log')
  writeFileSync(file, records.map(record => `${JSON.stringify(record)}\n`).join(''))
  return file
}

// The prompt and picker boxes span columns 20 to 59 of the 80-column screen.
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))

describe('arrows', () => {
  it('moves the cursor inside the page without scrolling', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down)
    assert.equal(viewer.panel.row, 3)
    assert.equal(viewer.panel.initialRow, 0)
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], topBorder('characterization.log', '4/31'))
    assert.equal(rows[23], '  NORMAL  4/31 | 20 | sort: -timestamp | 4 skipped')
    // The fourth record sits on screen row 4.
    assert.equal(cellStyle(viewer.screen, 2, 4).background, 7)
    await press(viewer, keys.up)
    assert.equal(viewer.panel.row, 2)
    assert.equal(cellStyle(viewer.screen, 2, 3).background, 7)
  })

  it('stops at the first record', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.up)
    assert.equal(viewer.panel.row, 0)
  })
})

describe('paging', () => {
  it('pages down by the page height and leaves the rest of the viewport empty', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down, keys.pageDown)
    assert.equal(viewer.panel.row, 23)
    assert.equal(viewer.panel.initialRow, 20)
    assert.deepEqual(screenText(viewer.screen).slice(0, 14), [
      topBorder('characterization.log', '24/31'),
      '│ 2026-10-11T10:09:00.000Z  info      delta 09                                 │',
      '│ 2026-10-11T10:08:00.000Z  debug  *  charlie 08                               │',
      '│ 2026-10-11T10:07:00.000Z  error  *  bravo 07                                 │',
      '│ 2026-10-11T10:06:00.000Z  warn      alpha 06                                 │',
      '│ 2026-10-11T10:05:00.000Z  info   *  foxtrot 05                               │',
      '│ 2026-10-11T10:04:00.000Z  debug  *  echo 04                                  │',
      '│ 2026-10-11T10:03:00.000Z  error     delta 03                                 │',
      '│ 2026-10-11T10:02:00.000Z  warn   *  charlie 02                               │',
      '│ 2026-10-11T10:01:00.000Z  info   *  bravo 01                                 │',
      '│ 2026-10-11T10:00:00.000Z  debug     alpha 00                                 │',
      '│                           warn      no timestamp                             │',
      `│${' '.repeat(78)}│`,
      `│${' '.repeat(78)}│`
    ])
  })

  it('pages up to the same relative row', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down, keys.pageDown, keys.pageUp)
    assert.equal(viewer.panel.row, 3)
    assert.equal(viewer.panel.initialRow, 0)
  })

  // Upstream ignored PageUp while the cursor was less than a page from the top (fixed by
  // farolanf/json-log-viewer 80eade9).
  it('moves to the first record on PageUp from a partial first page', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down, keys.pageUp)
    assert.equal(viewer.panel.row, 0)
    assert.equal(viewer.panel.initialRow, 0)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/31 | 20 | sort: -timestamp | 4 skipped')
    await press(viewer, '$', keys.up, keys.pageUp, keys.pageUp)
    assert.equal(viewer.panel.row, 0)
    assert.equal(viewer.panel.initialRow, 0)
  })

  it('jumps to the last record with $ and back to the first with 0', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '$')
    assert.equal(viewer.panel.row, 30)
    assert.equal(viewer.panel.initialRow, 10)
    assert.equal(screenText(viewer.screen)[20], '│ 2026-10-11T10:00:00.000Z  debug     alpha 00                                 │')
    assert.equal(screenText(viewer.screen)[21], '│                           warn      no timestamp                             │')
    await press(viewer, '0')
    assert.equal(viewer.panel.row, 0)
    assert.equal(viewer.panel.initialRow, 0)
  })
})

describe('go to line', () => {
  it('asks for a line with g and makes it the first row of the viewport', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'g')
    assert.equal(viewer.panel.mode, 'GOTO')
    assert.deepEqual(dialog(screenText(viewer.screen), 6, 16), [
      '┌─ Prompt ─────────────────────────────┐',
      '│                                      │',
      '│  Line:                               │',
      '│                                      │',
      '│                                      │',
      '│                                      │',
      '│                                      │',
      '│    Okay   Cancel                     │',
      '│                                      │',
      '└──────────────────────────────────────┘'
    ])
    assert.equal(screenText(viewer.screen)[23], '  GOTO  1/31 | 20 | sort: -timestamp | 4 skipped')
    await press(viewer, '5', keys.enter)
    assert.equal(viewer.panel.row, 4)
    assert.equal(viewer.panel.initialRow, 4)
    assert.equal(viewer.panel.mode, 'normal')
    assert.equal(screenText(viewer.screen)[1], '│ 2026-10-11T10:25:00.000Z  info   *  bravo 25                                 │')
  })
})

describe('viewport keys', () => {
  it('moves to the last, first and middle viewport rows with G, A and C', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'G')
    assert.equal(viewer.panel.row, 20)
    await press(viewer, 'A')
    assert.equal(viewer.panel.row, 0)
    await press(viewer, 'C')
    assert.equal(viewer.panel.row, 10)
  })

  it('computes the middle row from the page start and the page height, not the viewport (upstream defect)', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '$', 'C')
    assert.equal(viewer.panel.initialRow, 10)
    assert.equal(viewer.panel.row, 15)
  })
})

describe('wrap toggle', () => {
  // Upstream flipped blessed's wrap flag of the panel itself, which has no content, so w changed nothing on screen.
  it('cuts overlong rows at the panel edge with w and wraps them again with a second w', async t => {
    const viewer = openFileViewer(t, overlongLog(t))
    const wrapped = screenText(viewer.screen)
    // The first record is longer than the panel and continues on row 2.
    assert.deepEqual(wrapped.slice(1, 5).map(row => row.slice(0, 50)), [
      '│ 2026-10-11T10:02:00.000Z  info      tabs    are ',
      '│ count    so    this                             ',
      '│ 2026-10-11T10:01:00.000Z  warn      short       ',
      '│ 2026-10-11T10:00:00.000Z  error     last        '
    ])
    await press(viewer, 'w')
    assert.equal(viewer.panel.isWrappingRows, false)
    const cut = screenText(viewer.screen)
    assert.deepEqual([cut[1]?.slice(0, 50), cut[2], cut[3]], [wrapped[1]?.slice(0, 50), wrapped[3], wrapped[4]])
    assert.equal(cut[4], `│${' '.repeat(78)}│`)
    assert.equal(cellStyle(viewer.screen, 2, 1).background, 7)
    await press(viewer, 'w')
    assert.equal(viewer.panel.isWrappingRows, true)
    assert.deepEqual(screenText(viewer.screen), wrapped)
  })
})
