// Characterization of sorting in the upstream viewer.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText, visibleEntries } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))

const levelOrder = [
  'INFO',
  ...Array.from({ length: 8 }, () => 'debug'),
  ...Array.from({ length: 7 }, () => 'error'),
  'fatal',
  ...Array.from({ length: 6 }, () => 'info'),
  'trace',
  ...Array.from({ length: 7 }, () => 'warn'),
  undefined
]

describe('sort', () => {
  it('opens the sort picker with s', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's')
    assert.equal(viewer.panel.mode, 'sort')
    assert.equal(screenText(viewer.screen)[23], '  SORT  1/32 | 20 | sort: -timestamp | 3 skipped')
    assert.deepEqual(dialog(screenText(viewer.screen), 6, 11), [
      '┌── Sort by ───────────────────────────┐',
      '│                                      │',
      '│ timestamp                            │',
      '│ level                                │',
      '│ message                              │'
    ])
  })

  // Upstream showed the new sort in the status line but kept the old order until the next render (fixed by
  // farolanf/json-log-viewer ae42be2).
  it('renders the new order as soon as the sort changes', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', 'l')
    assert.equal(viewer.panel.sort, 'level')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/32 | 20 | sort: level | 3 skipped')
    assert.deepEqual(screenText(viewer.screen).slice(1, 4), [
      '│ 2026-10-11T10:05:00.000Z  INFO  *  foxtrot 05                                │',
      '│ 2026-10-11T10:00:00.000Z  debug     alpha 00                                 │',
      '│ 2026-10-11T10:28:00.000Z  debug  *  echo 28                                  │'
    ])
    // Upstream reversed the ascending order, so the record without a level came first and equal levels appeared
    // in reverse file order. Records without a value come last in both directions now, and equal values keep
    // their arrival order (plan section 5): the first warn record of the file leads.
    await press(viewer, 's', 'l')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/32 | 20 | sort: -level | 3 skipped')
    assert.equal(screenText(viewer.screen)[1], '│ 2026-10-11T10:14:00.000Z  warn   *  charlie 14                               │')
    assert.deepEqual(visibleEntries(viewer.panel).slice(-2).map(entry => entry.level), ['INFO', undefined])
  })

  it('sorts levels as text: uppercase first, equal levels in file order, missing levels last', t => {
    const viewer = openFileViewer(t, characterization, { sort: 'level' })
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.level), levelOrder)
    assert.deepEqual(visibleEntries(viewer.panel).filter(entry => entry.level === 'info').map(entry => entry.message), ['delta 21', `lima 17 ${'x'.repeat(60)}`, 'bravo 01', 'foxtrot 29', 'bravo 25', 'delta 09'])
  })

  it('switches to descending when the ascending key is chosen again', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', 'l', 's', 'l')
    assert.equal(viewer.panel.sort, '-level')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/32 | 20 | sort: -level | 3 skipped')
  })

  it('keeps the sort when the picker is closed with Escape', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', keys.escape)
    assert.equal(viewer.panel.sort, '-timestamp')
    assert.equal(viewer.panel.mode, 'normal')
  })
})
