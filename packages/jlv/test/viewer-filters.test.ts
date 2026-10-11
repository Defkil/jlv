// Characterization of the level and custom filters in the upstream viewer, including known defects.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, plainTopBorder, press, screenText } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))

describe('level filter', () => {
  it('opens the level picker with l', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l')
    assert.deepEqual(dialog(screenText(viewer.screen), 6, 13), [
      '┌── Log Level ─────────────────────────┐',
      '│                                      │',
      '│ all                                  │',
      '│ debug                                │',
      '│ info                                 │',
      '│ warn                                 │',
      '│ error                                │'
    ])
  })

  it('keeps only the exact, case-sensitive level and shows it in the status line', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', 'i')
    assert.deepEqual(viewer.panel.lines.map(entry => entry.message), ['foxtrot 29', 'bravo 25', 'delta 21', `lima 17 ${'x'.repeat(60)}`, 'delta 09', 'bravo 01'])
    // The uppercase INFO record does not match (upstream issue #14).
    assert.ok(viewer.panel.lines.every(entry => entry.level === 'info'))
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], plainTopBorder())
    assert.equal(rows[1], '│ 2026-10-11T10:29:00.000Z  info  *  foxtrot 29                                │')
    assert.equal(rows[23], '  NORMAL  1/6 | 20 | sort: -timestamp | filters: level:info')
  })

  it('chooses a level with the arrow keys and Enter', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', keys.down, keys.down, keys.enter)
    assert.equal(viewer.panel.levelFilter, 'info')
    assert.equal(viewer.panel.lines.length, 6)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/6 | 20 | sort: -timestamp | filters: level:info')
  })

  it('clears the level filter with all and keeps it when the picker is closed with Escape', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', 'e')
    assert.equal(viewer.panel.lines.length, 7)
    await press(viewer, 'l', keys.escape)
    assert.equal(viewer.panel.lines.length, 7)
    await press(viewer, 'l', 'a')
    assert.equal(viewer.panel.lines.length, 32)
    assert.equal(viewer.panel.levelFilter, null)
  })

  it('accepts the initial level from the options', t => {
    const viewer = openFileViewer(t, characterization, { level: 'warn' })
    assert.equal(viewer.panel.lines.length, 7)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: level:warn')
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
    assert.deepEqual(viewer.panel.lines.map(entry => entry.message), ['alpha 24', 'alpha 18', 'alpha 12', 'alpha 06', 'alpha 00'])
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/5 | 20 | sort: -timestamp | filters: message:ALPHA')
  })

  it('filters a timestamp as text', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 't', '10:1', keys.enter)
    assert.equal(viewer.panel.lines.length, 10)
    assert.equal(viewer.panel.lines[0]?.timestamp, '2026-10-11T10:19:00.000Z')
  })

  it('filters other data fields given as key:value', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'o')
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Field to filter:                    │')
    await press(viewer, 'requestId:REQ-2', keys.enter)
    assert.deepEqual(viewer.panel.lines.map(entry => entry.message), ['foxtrot 29', 'echo 28', 'charlie 26', 'bravo 25', 'foxtrot 23', 'echo 22', 'charlie 20'])
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: requestId:REQ-2')
  })

  it('asks for the term when other gets a nested field name only', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'o', 'user.name', keys.enter)
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Filter user.name by:                │')
    await press(viewer, '07', keys.enter)
    assert.deepEqual(viewer.panel.lines.map(entry => entry.message), ['bravo 07'])
  })

  it('clears all filters with f instead of opening the picker', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'm', 'alpha', keys.enter, 'f')
    assert.equal(viewer.panel.lines.length, 32)
    assert.deepEqual(viewer.panel.filters, [])
    assert.notEqual(viewer.panel.mode, 'filter')
  })

  it('applies only the last of a custom and a level filter (upstream defect, issue #19)', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'm', 'alpha', keys.enter, 'l', 'e')
    assert.deepEqual(viewer.panel.lines.map(entry => entry.message), ['delta 27', 'foxtrot 23', 'bravo 19', 'delta 15', 'foxtrot 11', 'bravo 07', 'delta 03'])
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: message:alpha level:error')
  })
})
