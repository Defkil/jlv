// The level filter and the filter manager of the viewer (plan section 6.3, upstream issues #14 and #19): l chooses
// the normalized level; f adds text filters on the record's parts and original fields, removes them one by one,
// chooses profiles of the configuration and predicates of plugins, and clears all. Everything active applies together.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import type { NamedPredicate } from '../src/filters.js'
import { keys, openFileViewer, press, screenText, topBorder, visibleEntries, type Viewer } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))

const messages = (viewer: Viewer): string[] => visibleEntries(viewer.panel).map(entry => entry.message)

// The items of the open picker, read from the screen.
const pickerItems = (viewer: Viewer): string[] => screenText(viewer.screen)
  .flatMap(row => /│ ([^│]*\S)\s*│/u.exec(row.slice(18, 62))?.[1] ?? [])

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
    assert.deepEqual(messages(viewer), [
      'foxtrot 29', 'bravo 25', 'delta 21', `lima 17 ${'x'.repeat(60)}`, 'delta 09', 'foxtrot 05', 'bravo 01'
    ])
    assert.ok(visibleEntries(viewer.panel).every(entry => entry.record.level === 'info'))
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], topBorder('characterization.log', '1/7'))
    assert.equal(rows[1], '│ 2026-10-11T10:29:00.000Z  info  req-29  *  foxtrot 29                        │')
    assert.equal(rows[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: level=info | 4 skipped')
  })

  it('chooses a level with the arrow keys and Enter', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', keys.down, keys.down, keys.down, keys.enter)
    assert.equal(viewer.panel.filter.level, 'info')
    assert.equal(visibleEntries(viewer.panel).length, 7)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: level=info | 4 skipped')
  })

  it('keeps the records of an unknown or missing level with unknown', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', 'u')
    assert.equal(viewer.panel.filter.level, 'unknown')
    assert.deepEqual(messages(viewer), [])
    await press(viewer, 'l', 'f')
    assert.deepEqual(messages(viewer), ['bravo 13'])
  })

  it('clears the level with all, keeps the other filters and keeps the level when the picker is closed with Escape', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'l', 'e')
    assert.equal(visibleEntries(viewer.panel).length, 7)
    await press(viewer, 'l', keys.escape)
    assert.equal(visibleEntries(viewer.panel).length, 7)
    await press(viewer, 'f', 'a', 'm', 'fox', keys.enter)
    assert.deepEqual(messages(viewer), ['foxtrot 23', 'foxtrot 11'])
    await press(viewer, 'l', 'a')
    assert.equal(viewer.panel.filter.level, undefined)
    assert.deepEqual(messages(viewer), ['foxtrot 29', 'foxtrot 23', 'foxtrot 11', 'foxtrot 05'])
  })

  it('accepts the initial level from the options', t => {
    const viewer = openFileViewer(t, characterization, { level: 'warn' })
    assert.equal(visibleEntries(viewer.panel).length, 7)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/7 | 20 | sort: -timestamp | filters: level=warn | 4 skipped')
  })
})

describe('filter manager', () => {
  it('opens with f and offers to add a filter, and the parts of a record to filter by', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f')
    assert.equal(viewer.panel.mode, 'filter')
    assert.deepEqual(pickerItems(viewer), ['add a filter'])
    await press(viewer, 'a')
    assert.deepEqual(pickerItems(viewer), ['timestamp', 'level', 'message', 'correlation identifier', 'other'])
    await press(viewer, keys.escape)
    assert.equal(viewer.panel.mode, 'normal')
  })

  it('filters the message by a case-insensitive substring', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 'm')
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Filter message by:                  │')
    await press(viewer, 'ALPHA', keys.enter)
    assert.deepEqual(messages(viewer), ['alpha 24', 'alpha 18', 'alpha 12', 'alpha 06', 'alpha 00'])
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/5 | 20 | sort: -timestamp | filters: message~ALPHA | 4 skipped')
  })

  it('filters the timestamp by the time that the viewer shows', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 't', '10:1', keys.enter)
    assert.equal(visibleEntries(viewer.panel).length, 10)
    assert.equal(visibleEntries(viewer.panel)[0]?.timestamp, '2026-10-11T10:19:00.000Z')
  })

  it('filters the correlation identifier', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 'c', 'REQ-2', keys.enter)
    assert.deepEqual(messages(viewer), ['foxtrot 29', 'echo 28', 'charlie 26', 'bravo 25', 'foxtrot 23', 'echo 22', 'charlie 20'])
    assert.match(screenText(viewer.screen)[23] ?? '', /\| filters: correlationIdentifier~REQ-2 \|/u)
  })

  it('filters original fields given as key:value', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 'o')
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Field to filter:                    │')
    await press(viewer, 'requestId:REQ-2', keys.enter)
    assert.deepEqual(messages(viewer), ['foxtrot 29', 'echo 28', 'charlie 26', 'bravo 25', 'foxtrot 23', 'echo 22', 'charlie 20'])
    assert.deepEqual(viewer.panel.filterDescriptions, ['fields.requestId~REQ-2'])
    assert.ok(screenText(viewer.screen)[23]?.startsWith('  NORMAL  1/7 | 20 | sort: -timestamp | filters: fields.requestId~REQ-2 |'))
  })

  it('asks for the term when other gets a nested field name only', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 'o', 'user.name', keys.enter)
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Filter user.name by:                │')
    await press(viewer, '07', keys.enter)
    assert.deepEqual(messages(viewer), ['bravo 07'])
  })

  // lodash.get found the Object function as data.constructor of every record, so upstream kept all 32.
  it('finds no inherited member such as constructor in the fields', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 'o', 'constructor:function', keys.enter)
    assert.equal(visibleEntries(viewer.panel).length, 0)
  })

  // Upstream issue #19: upstream reduced over its filters and let the last one decide, and f cleared them all.
  it('applies every filter at once, whatever their order', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 'm', 'alpha', keys.enter, 'l', 'd')
    assert.deepEqual(messages(viewer), ['alpha 24', 'alpha 12', 'alpha 00'])
    await press(viewer, 'f', 'a', 'm', '2', keys.enter)
    assert.deepEqual(messages(viewer), ['alpha 24', 'alpha 12'])
    assert.deepEqual(viewer.panel.filterDescriptions, ['level=debug', 'message~alpha', 'message~2'])
    // The same filter again adds nothing.
    await press(viewer, 'f', 'a', 'm', '2', keys.enter)
    assert.equal(viewer.panel.filter.clauses.length, 2)
  })

  it('removes one filter at a time and clears all', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'f', 'a', 'm', 'alpha', keys.enter, 'l', 'd', 'f')
    assert.deepEqual(pickerItems(viewer), ['add a filter', 'remove level=debug', 'remove message~alpha', 'clear all filters'])
    await press(viewer, keys.down, keys.down, keys.enter)
    assert.deepEqual(messages(viewer), ['echo 28', 'alpha 24', 'charlie 20', 'echo 16', 'alpha 12', 'charlie 08', 'echo 04', 'alpha 00'])
    await press(viewer, 'f', 'c')
    assert.equal(visibleEntries(viewer.panel).length, 31)
    assert.deepEqual(viewer.panel.filter, { clauses: [], predicates: [] })
    assert.notEqual(viewer.panel.mode, 'filter')
  })

  it('chooses a profile of the configuration and a predicate of a plugin, and removes them again', async t => {
    const shortMessage: NamedPredicate = { name: 'isShort', owner: './plugin.mjs', test: record => record.message.length <= 8 }
    const viewer = openFileViewer(t, characterization, {
      profiles: {
        failures: { mode: 'any', clauses: [{ field: ['level'], operator: 'equals', value: 'error' }, { field: ['level'], operator: 'equals', value: 'fatal' }] }
      },
      predicates: [shortMessage]
    })
    await press(viewer, 'f')
    assert.deepEqual(pickerItems(viewer), ['add a filter', 'profile failures', 'predicate isShort'])
    await press(viewer, 'p')
    assert.equal(visibleEntries(viewer.panel).length, 8)
    await press(viewer, 'f', keys.down, keys.down, keys.enter)
    assert.deepEqual(messages(viewer), ['delta 27', 'bravo 19', 'delta 15', 'bravo 13', 'bravo 07', 'delta 03'])
    assert.deepEqual(viewer.panel.filterDescriptions, ['profile failures', 'predicate isShort'])
    await press(viewer, 'f')
    assert.deepEqual(pickerItems(viewer), ['add a filter', 'remove profile failures', 'remove predicate isShort', 'clear all filters'])
    await press(viewer, 'r')
    assert.equal(viewer.panel.filter.profile, undefined)
    assert.equal(visibleEntries(viewer.panel).length, 19)
  })
})
