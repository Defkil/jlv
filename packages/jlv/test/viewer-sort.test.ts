// Characterization of sorting in the upstream viewer.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText, visibleEntries } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))

// The levels of the characterization log in their order of severity (plan section 5); upstream sorted the raw level
// names as text, with the uppercase INFO first and trace after info.
const levelOrder = [
  'trace',
  ...Array.from({ length: 8 }, () => 'debug'),
  ...Array.from({ length: 7 }, () => 'info'),
  ...Array.from({ length: 7 }, () => 'warn'),
  ...Array.from({ length: 7 }, () => 'error'),
  'fatal'
]

describe('sort', () => {
  it('opens the sort picker with s', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's')
    assert.equal(viewer.panel.mode, 'sort')
    assert.equal(screenText(viewer.screen)[23], '  SORT  1/31 | 20 | sort: -timestamp | 4 skipped')
    assert.deepEqual(dialog(screenText(viewer.screen), 6, 11), [
      '┌── Sort by ───────────────────────────┐',
      '│                                      │',
      '│ timestamp                            │',
      '│ level                                │',
      '│ message                              │'
    ])
  })

  // Upstream showed the new sort in the status line but kept the old order until the next render (fixed by
  // farolanf/json-log-viewer ae42be2), and its cursor kept its row, now on another record. The cursor stays on its
  // record now, foxtrot 29, in the same screen row.
  it('renders the new order as soon as the sort changes and keeps the cursor on its record', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', 'l')
    assert.equal(viewer.panel.sort, 'level')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  14/31 | 20 | sort: level | 4 skipped')
    assert.equal(screenText(viewer.screen)[1], '│ 2026-10-11T10:29:00.000Z  info   req-29  *  foxtrot 29                       │')
    await press(viewer, '0')
    assert.deepEqual(screenText(viewer.screen).slice(1, 4), [
      '│ 2026-10-11T10:22:00.000Z  trace  req-22  *  echo 22                          │',
      '│ 2026-10-11T10:00:00.000Z  debug             alpha 00                         │',
      '│ 2026-10-11T10:28:00.000Z  debug  req-28  *  echo 28                          │'
    ])
    // Upstream reversed the ascending order, so the record without a level came first and equal levels appeared
    // in reverse file order. Records without a value come last in both directions now, and equal values keep
    // their arrival order (plan section 5): the fatal record leads, and the last debug record of the file is the
    // last but one.
    await press(viewer, 's', 'l')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  31/31 | 20 | sort: -level | 4 skipped')
    assert.equal(visibleEntries(viewer.panel)[0]?.message, 'bravo 13')
    assert.deepEqual(visibleEntries(viewer.panel).slice(-2).map(entry => [entry.level, entry.message]), [['debug', 'echo 16'], ['trace', 'echo 22']])
  })

  it('sorts levels by severity, equal levels in file order and unknown levels last', t => {
    const viewer = openFileViewer(t, characterization, { sort: 'level' })
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.level), levelOrder)
    assert.deepEqual(visibleEntries(viewer.panel).filter(entry => entry.level === 'info').map(entry => entry.message), [
      'delta 21', 'foxtrot 05', `lima 17 ${'x'.repeat(60)}`, 'bravo 01', 'foxtrot 29', 'bravo 25', 'delta 09'
    ])
  })

  it('switches to descending when the ascending key is chosen again', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', 'l', 's', 'l')
    assert.equal(viewer.panel.sort, '-level')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  20/31 | 20 | sort: -level | 4 skipped')
  })

  it('keeps the sort when the picker is closed with Escape', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', keys.escape)
    assert.equal(viewer.panel.sort, '-timestamp')
    assert.equal(viewer.panel.mode, 'normal')
  })
})
