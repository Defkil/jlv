// Characterization of the level and custom filters in the upstream viewer, including known defects.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText, topBorder, visibleEntries } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))

describe('level filter', () => {
  // Upstream offered all, debug, info, warn and error; trace, fatal and unknown are levels too (upstream issue #14).
  it('opens the level picker with l and offers every level in the order of severity', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l')
    assert.deepEqual(dialog(screenText(viewer.screen), 6, 18), [
      '┌── Log Level ─────────────────────────┐',
      '│                                      │',
      '│ all                                  │',
      '│ trace                                │',
      '│ debug                                │',
      '│ info                                 │',
      '│ warn                                 │',
      '│ error                                │',
      '│ fatal                                │',
      '│ unknown                              │',
      '│                                      │',
      '└──────────────────────────────────────┘'
    ])
  })

  // Upstream compared the raw level exactly, so the uppercase INFO record did not match (upstream issue #14).
  it('keeps the records of the normalized level, whatever the case of their raw level, and shows it in the status line', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', 'i')
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.message), [
      'foxtrot 29', 'bravo 25', 'delta 21', `lima 17 ${'x'.repeat(60)}`, 'delta 09', 'foxtrot 05', 'bravo 01'
    ])
    assert.ok(visibleEntries(viewer.panel).every(entry => entry.record.level === 'info'))
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], topBorder('characterization.log', '1/7'))
    assert.equal(rows[1], '│ 2026-10-11T10:29:00.000Z  info  *  foxtrot 29                                │')
    assert.equal(rows[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: level:info | 4 skipped')
  })

  it('chooses a level with the arrow keys and Enter', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', keys.down, keys.down, keys.down, keys.enter)
    assert.equal(viewer.panel.levelFilter, 'info')
    assert.equal(visibleEntries(viewer.panel).length, 7)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: level:info | 4 skipped')
  })

  it('keeps the records of an unknown or missing level with unknown', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', 'u')
    assert.equal(viewer.panel.levelFilter, 'unknown')
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.message), [])
    await press(viewer, 'l', 'f')
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.message), ['bravo 13'])
  })

  it('clears the level filter with all and keeps it when the picker is closed with Escape', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', 'e')
    assert.equal(visibleEntries(viewer.panel).length, 7)
    await press(viewer, 'l', keys.escape)
    assert.equal(visibleEntries(viewer.panel).length, 7)
    await press(viewer, 'l', 'a')
    assert.equal(visibleEntries(viewer.panel).length, 31)
    assert.equal(viewer.panel.levelFilter, undefined)
  })

  it('accepts the initial level from the options', t => {
    const viewer = openFileViewer(t, characterization, { level: 'warn' })
    assert.equal(visibleEntries(viewer.panel).length, 7)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: level:warn | 4 skipped')
  })
})

describe('custom filters', () => {
  it('opens the field picker with f', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f')
    assert.equal(viewer.panel.mode, 'filter')
    assert.deepEqual(dialog(screenText(viewer.screen), 6, 12), [
      '┌── Filter by ─────────────────────────┐',
      '│                                      │',
      '│ timestamp                            │',
      '│ level                                │',
      '│ message                              │',
      '│ other                                │'
    ])
  })

  it('filters a field by a case-insensitive substring', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'm')
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Filter message by:                  │')
    await press(viewer, 'ALPHA', keys.enter)
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.message), ['alpha 24', 'alpha 18', 'alpha 12', 'alpha 06', 'alpha 00'])
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/5 | 20 | sort: -timestamp | filters: message:ALPHA | 4 skipped')
  })

  it('filters a timestamp as text', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 't', '10:1', keys.enter)
    assert.equal(visibleEntries(viewer.panel).length, 10)
    assert.equal(visibleEntries(viewer.panel)[0]?.timestamp, '2026-10-11T10:19:00.000Z')
  })

  it('filters other data fields given as key:value', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'o')
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Field to filter:                    │')
    await press(viewer, 'requestId:REQ-2', keys.enter)
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.message), ['foxtrot 29', 'echo 28', 'charlie 26', 'bravo 25', 'foxtrot 23', 'echo 22', 'charlie 20'])
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: requestId:REQ-2 | 4 skipped')
  })

  it('asks for the term when other gets a nested field name only', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'o', 'user.name', keys.enter)
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Filter user.name by:                │')
    await press(viewer, '07', keys.enter)
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.message), ['bravo 07'])
  })

  // lodash.get found the Object function as data.constructor of every record, so upstream kept all 32.
  it('finds no inherited member such as constructor in the data', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'o', 'constructor:function', keys.enter)
    assert.equal(visibleEntries(viewer.panel).length, 0)
  })

  it('clears all filters with f instead of opening the picker', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'm', 'alpha', keys.enter, 'f')
    assert.equal(visibleEntries(viewer.panel).length, 31)
    assert.deepEqual(viewer.panel.filters, [])
    assert.notEqual(viewer.panel.mode, 'filter')
  })

  it('applies only the last of a custom and a level filter (upstream defect, issue #19)', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'm', 'alpha', keys.enter, 'l', 'e')
    assert.deepEqual(visibleEntries(viewer.panel).map(entry => entry.message), ['delta 27', 'foxtrot 23', 'bravo 19', 'delta 15', 'foxtrot 11', 'bravo 07', 'delta 03'])
    // The status line ends at the edge of the screen.
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: message:alpha level:error | 4')
  })
})
