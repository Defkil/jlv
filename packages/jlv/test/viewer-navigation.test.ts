// Characterization of cursor movement, paging and go-to-line in the upstream viewer on blessed 0.1.81.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { cellStyle, keys, openFileViewer, plainTopBorder, press, screenText } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

// The prompt and picker boxes span columns 20 to 59 of the 80-column screen.
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))

describe('arrows', () => {
  it('moves the cursor inside the page without scrolling', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down)
    assert.equal(viewer.panel.row, 3)
    assert.equal(viewer.panel.initialRow, 0)
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], plainTopBorder())
    assert.equal(rows[23], '  NORMAL  4/32 | 20 | sort: -timestamp')
    // The first two records wrap onto two lines each, so the fourth record sits on screen row 6.
    assert.equal(cellStyle(viewer.screen, 2, 6).background, 7)
    await press(viewer, keys.up)
    assert.equal(viewer.panel.row, 2)
    assert.equal(cellStyle(viewer.screen, 2, 5).background, 7)
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
      plainTopBorder(),
      '│ 2026-10-11T10:11:00.000Z  error  *  foxtrot 11                               │',
      '│ 2026-10-11T10:10:00.000Z  warn   *  kilo 10                                  │',
      '│ 2026-10-11T10:09:00.000Z  info      delta 09                                 │',
      '│ 2026-10-11T10:08:00.000Z  debug  *  charlie 08                               │',
      '│ 2026-10-11T10:07:00.000Z  error  *  bravo 07                                 │',
      '│ 2026-10-11T10:06:00.000Z  warn      alpha 06                                 │',
      '│ 2026-10-11T10:05:00.000Z  INFO  *  foxtrot 05                                │',
      '│ 2026-10-11T10:04:00.000Z  debug  *  echo 04                                  │',
      '│ 2026-10-11T10:03:00.000Z  error     delta 03                                 │',
      '│ 2026-10-11T10:02:00.000Z  warn   *  charlie 02                               │',
      '│ 2026-10-11T10:01:00.000Z  info   *  bravo 01                                 │',
      '│ 2026-10-11T10:00:00.000Z  debug     alpha 00                                 │',
      '│                                                                              │'
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
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/32 | 20 | sort: -timestamp')
    await press(viewer, '$', keys.up, keys.pageUp, keys.pageUp)
    assert.equal(viewer.panel.row, 0)
    assert.equal(viewer.panel.initialRow, 0)
  })

  it('jumps to the last record with $ and back to the first with 0', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '$')
    assert.equal(viewer.panel.row, 31)
    assert.equal(viewer.panel.initialRow, 11)
    assert.equal(screenText(viewer.screen)[21], '│ 2026-10-11T10:00:00.000Z  debug     alpha 00                                 │')
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
    assert.equal(screenText(viewer.screen)[23], '  GOTO  1/32 | 20 | sort: -timestamp')
    await press(viewer, '5', keys.enter)
    assert.equal(viewer.panel.row, 4)
    assert.equal(viewer.panel.initialRow, 4)
    assert.equal(viewer.panel.mode, 'normal')
    assert.equal(screenText(viewer.screen)[1], '│ 2026-10-11T10:27:00.000Z  error     delta 27                                 │')
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
    assert.equal(viewer.panel.initialRow, 11)
    assert.equal(viewer.panel.row, 15)
  })
})

describe('wrap toggle', () => {
  it('flips the wrap flag with w without changing the screen', async t => {
    const viewer = openFileViewer(t, characterization)
    const before = screenText(viewer.screen)
    await press(viewer, 'w')
    assert.equal(viewer.panel.wrap, false)
    assert.deepEqual(screenText(viewer.screen), before)
  })
})
