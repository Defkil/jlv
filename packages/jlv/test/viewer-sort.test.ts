// Characterization of sorting in the upstream viewer, including the stale cache after a sort change.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText } from './support/terminal.js'

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
    assert.equal(screenText(viewer.screen)[23], '  SORT  1/32 | 20 | sort: -timestamp')
    assert.deepEqual(dialog(screenText(viewer.screen), 6, 11), [
      '┌── Sort by ───────────────────────────┐',
      '│                                      │',
      '│ timestamp                            │',
      '│ level                                │',
      '│ message                              │'
    ])
  })

  it('shows a new sort in the status line but renders the old order until the next render (upstream defect)', async t => {
    const viewer = openFileViewer(t, characterization)
    const before = screenText(viewer.screen).slice(1, 22)
    await press(viewer, 's', 'l')
    assert.equal(viewer.panel.sort, 'level')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/32 | 20 | sort: level')
    assert.deepEqual(screenText(viewer.screen).slice(1, 22), before)
    await press(viewer, keys.down)
    assert.deepEqual(screenText(viewer.screen).slice(1, 4), [
      '│ 2026-10-11T10:05:00.000Z  INFO  *  foxtrot 05                                │',
      '│ 2026-10-11T10:00:00.000Z  debug     alpha 00                                 │',
      '│ 2026-10-11T10:28:00.000Z  debug  *  echo 28                                  │'
    ])
  })

  it('sorts levels as text: uppercase first, equal levels in file order, missing levels last', t => {
    const viewer = openFileViewer(t, characterization, { sort: 'level' })
    assert.deepEqual(viewer.panel.lines.map(entry => entry.level), levelOrder)
    assert.deepEqual(viewer.panel.lines.filter(entry => entry.level === 'info').map(entry => entry.message), ['delta 21', `lima 17 ${'x'.repeat(60)}`, 'bravo 01', 'foxtrot 29', 'bravo 25', 'delta 09'])
  })

  it('switches to descending when the ascending key is chosen again', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', 'l', 's', 'l')
    assert.equal(viewer.panel.sort, '-level')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/32 | 20 | sort: -level')
  })

  it('keeps the sort when the picker is closed with Escape', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's', keys.escape)
    assert.equal(viewer.panel.sort, '-timestamp')
    assert.equal(viewer.panel.mode, 'normal')
  })
})
