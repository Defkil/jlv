// Characterization of search, repeated search and search messages in the upstream viewer.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const dialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(20, 60))
const messageDialog = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(8, 72))
const messageLine = (text: string): string => `│ ${text.padEnd(60)} │`

describe('search', () => {
  it('opens a prompt with / and moves to the first case-insensitive match below the cursor', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/')
    assert.equal(viewer.panel.mode, 'search')
    assert.equal(screenText(viewer.screen)[23], '  SEARCH  1/31 | 20 | sort: -timestamp | 4 skipped | ? help')
    assert.equal(dialog(screenText(viewer.screen), 8, 9)[0], '│  Search:                             │')
    await press(viewer, 'CHARLIE', keys.enter)
    assert.equal(viewer.panel.row, 3)
    assert.equal(viewer.panel.initialRow, 3)
    assert.equal(viewer.panel.mode, 'normal')
    assert.equal(screenText(viewer.screen)[1], '│ 2026-10-11T10:26:00.000Z  warn   req-26  *  charlie 26                       │')
  })

  it('repeats the search with n from the row after the cursor', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/', 'charlie', keys.enter)
    const visited = [viewer.panel.row]
    for (let step = 0; step < 4; step += 1) {
      await press(viewer, 'n')
      visited.push(viewer.panel.row)
    }
    assert.deepEqual(visited, [3, 9, 15, 21, 27])
  })

  it('reports a missing match in a message box and keeps the cursor', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/', 'zzz', keys.enter)
    assert.equal(viewer.panel.row, 0)
    assert.deepEqual(messageDialog(screenText(viewer.screen), 8, 15), [
      `┌─ Message ${'─'.repeat(52)}┐`,
      messageLine(''),
      messageLine(' No matches for \'zzz\''),
      messageLine(''),
      messageLine('   Okay   Cancel'),
      messageLine(''),
      `└${'─'.repeat(62)}┘`
    ])
    await press(viewer, keys.enter)
    assert.ok(screenText(viewer.screen).every(row => !row.includes('No matches')))
  })

  it('reports n without a previous search', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 'n')
    assert.equal(messageDialog(screenText(viewer.screen), 10, 11)[0], messageLine(' No previous search'))
  })

  // Upstream's undocumented ? opened the search with the last term; ? shows the keys now, and n searches again.
  it('starts a new search with / and searches with the last term again with n, not with ?', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/', 'bravo', keys.enter)
    assert.equal(viewer.panel.row, 4)
    await press(viewer, '?')
    assert.notEqual(viewer.panel.mode, 'search')
    assert.ok(screenText(viewer.screen).every(row => !row.includes('Search:')))
    await press(viewer, keys.escape, 'n')
    assert.equal(viewer.panel.row, 10)
    await press(viewer, '/')
    assert.equal(dialog(screenText(viewer.screen), 11, 12)[0], '│                                      │')
    await press(viewer, keys.escape)
  })

  it('looks at the timestamp and the message only', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/', 'req-28', keys.enter)
    assert.equal(viewer.panel.row, 0)
    assert.equal(messageDialog(screenText(viewer.screen), 10, 11)[0], messageLine(' No matches for \'req-28\''))
  })
})
