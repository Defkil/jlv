// Empty logs, tiny terminals and cursor targets past the records: the cursor always stays on a record, or on row 0 of
// an empty view, and inside the viewport; widths and page heights never become negative (plan section 7).
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { maxLengths } from '../src/tui/formatting.js'
import { keys, openFileViewer, press, screenText, topBorder, type Viewer } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const empty = fixturePath(legacyViewerFixtures.empty)

// The cursor is on a record, or on row 0 without records, and the viewport shows it.
const assertCursorInView = (viewer: Viewer): void => {
  const { panel } = viewer
  assert.ok(panel.pageHeight >= 0, `page height ${String(panel.pageHeight)}`)
  assert.ok(panel.pageWidth >= 0, `page width ${String(panel.pageWidth)}`)
  assert.ok(Number.isSafeInteger(panel.row) && Number.isSafeInteger(panel.initialRow), `row ${String(panel.row)}, initial row ${String(panel.initialRow)}`)
  assert.ok(panel.row >= 0 && panel.row <= Math.max(panel.lastRow, 0), `row ${String(panel.row)} of ${String(panel.lastRow)}`)
  assert.ok(panel.initialRow <= panel.row && panel.row - panel.initialRow <= panel.pageHeight,
    `row ${String(panel.row)} outside the viewport from ${String(panel.initialRow)} over ${String(panel.pageHeight)}`)
}

// Every key that moves the cursor, followed by the dialogs, each closed again.
const everyKey = [
  keys.down, keys.down, keys.up, keys.pageDown, keys.pageDown, keys.pageUp, '$', 'G', 'A', 'C', '0', 'G',
  keys.enter, keys.escape, 's', keys.escape, 'l', keys.escape, '/', 'a', keys.enter, keys.enter, 'n', keys.enter
]

describe('empty log', () => {
  // Upstream moved the cursor to -1, and Enter threw a TypeError.
  it('keeps the cursor on row 0 and opens no details', async t => {
    const viewer = openFileViewer(t, empty)
    for (const key of [keys.down, keys.pageDown, keys.pageUp, '$', 'G', 'A', 'C', '0', keys.up]) {
      await press(viewer, key)
      assertCursorInView(viewer)
    }
    assert.equal(viewer.panel.row, 0)
    await press(viewer, keys.enter)
    assert.equal(viewer.screen.children.length, 2)
    assert.equal(screenText(viewer.screen)[0], topBorder('empty.log', '1/0'))
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/0 | 20 | sort: -timestamp')
  })
})

describe('cursor targets past the records', () => {
  // Upstream put the cursor below the last record, where Enter threw a TypeError.
  it('stops G at the last record of a partial last page', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down, keys.pageDown, 'G')
    assert.equal(viewer.panel.row, 31)
    assert.equal(viewer.panel.initialRow, 20)
    await press(viewer, keys.enter)
    // The last record is the second of the two without a timestamp, which come last.
    assert.equal(screenText(viewer.screen)[3]?.slice(4, 76), '┌─ undefined - warn - no timestamp ────────────────────────────────────┐')
  })

  it('moves to the nearest record for line numbers past either end or without digits', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'g', '99', keys.enter)
    assert.equal(viewer.panel.row, 31)
    assertCursorInView(viewer)
    await press(viewer, 'g', '0', keys.enter)
    assert.equal(viewer.panel.row, 0)
    assertCursorInView(viewer)
    await press(viewer, '$', 'g', 'x', keys.enter)
    assert.equal(viewer.panel.row, 0)
    assertCursorInView(viewer)
  })

  // C still takes the middle of the page start and the page height (an upstream defect), but no longer leaves the
  // cursor above the viewport.
  it('keeps the cursor in view after C on a later page', async t => {
    const viewer = openFileViewer(t, characterization, { rows: 8 })
    await press(viewer, '$', 'C')
    assertCursorInView(viewer)
    await press(viewer, keys.enter)
    assert.equal(viewer.screen.children.length, 3)
  })
})

describe('long names', () => {
  // blessed wrapped a label wider than the panel onto the first row, where it covered the first record.
  it('keeps the end of a long file name in the border label and the first row free', t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'jlv-label-'))
    t.after(() => {
      process.chdir(tmpdir())
      rmSync(directory, { recursive: true, force: true })
    })
    const name = `${'very-long-name-'.repeat(5)}characterization.log`
    copyFileSync(characterization, path.join(directory, name))
    const viewer = openFileViewer(t, path.join(directory, name))
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], `┌──[ …${name.slice(-61)} ] [ 1/32 ]─┐`)
    assert.equal(rows[1], '│ 2026-10-11T10:29:00.000Z  info   *  foxtrot 29                               │')
  })

  it('cuts the label to the width of a narrow terminal', t => {
    const viewer = openFileViewer(t, characterization, { columns: 30, rows: 8 })
    assert.equal(screenText(viewer.screen)[0], '┌──[ …ization.log ] [ 1/32 ]─┐')
  })
})

describe('tiny terminals', () => {
  for (const [columns, rows] of [[1, 1], [4, 3], [12, 4], [20, 6], [40, 5]] as const) {
    it(`keeps the cursor and the widths in range on ${String(columns)}x${String(rows)} cells`, async t => {
      const viewer = openFileViewer(t, characterization, { columns, rows })
      assertCursorInView(viewer)
      for (const key of everyKey) {
        await press(viewer, key)
        assertCursorInView(viewer)
      }
    })
  }

  it('moves PageDown and PageUp by at least one record', async t => {
    const viewer = openFileViewer(t, characterization, { columns: 40, rows: 4 })
    assert.equal(viewer.panel.pageHeight, 0)
    await press(viewer, keys.pageDown, keys.pageDown)
    assert.equal(viewer.panel.row, 2)
    await press(viewer, keys.pageUp)
    assert.equal(viewer.panel.row, 1)
  })

  it('gives the last column no negative width', () => {
    const columns = [{ key: 'a' }, { key: 'b' }]
    assert.deepEqual(maxLengths(columns, [{ a: 'abcdef' }], 1, 4), { a: 6, b: 0 })
    assert.deepEqual(maxLengths(columns, [{ a: 'abcdef' }], 1, -5), { a: 6, b: 0 })
  })
})
