// Characterization of the details view: tree and JSON rendering, toggling and closing.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { LogDetails } from '../src/tui/log-details.js'
import { keys, openFileViewer, press, screenText } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

// Reads the element that display() replaces on every call.
const contentOf = (details: LogDetails): string | undefined => details.element?.content

// The details box spans columns 4 to 75.
const detailsBox = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(4, 76))

describe('details', () => {
  it('opens the cursor record with Enter and shows nested data as an indented tree', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down, keys.enter)
    assert.deepEqual(detailsBox(screenText(viewer.screen), 3, 10), [
      '┌─ 2026-10-11T10:28:00.000Z - debug - echo 28 ─────────────────────────┐',
      '│                                                                      │',
      '│ requestId: req-28                                                    │',
      '│ user:                                                                │',
      '│  id:   28                                                            │',
      '│  name: user 28                                                       │',
      '│                                                                      │'
    ])
  })

  it('toggles between the tree and pretty-printed JSON with j', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down, keys.enter, 'j')
    assert.deepEqual(detailsBox(screenText(viewer.screen), 4, 12), [
      '│ {                                                                    │',
      '│   "requestId": "req-28",                                             │',
      '│   "user": {                                                          │',
      '│     "id": 28,                                                        │',
      '│     "name": "user 28"                                                │',
      '│   }                                                                  │',
      '│ }                                                                    │',
      '│                                                                      │'
    ])
    await press(viewer, 'j')
    assert.equal(detailsBox(screenText(viewer.screen), 5, 6)[0], '│ requestId: req-28                                                    │')
  })

  it('closes with Escape or Enter', async t => {
    const viewer = openFileViewer(t, characterization)
    const main = screenText(viewer.screen)
    await press(viewer, keys.enter)
    assert.notDeepEqual(screenText(viewer.screen), main)
    await press(viewer, keys.escape)
    assert.deepEqual(screenText(viewer.screen), main)
    await press(viewer, keys.enter, keys.enter)
    assert.deepEqual(screenText(viewer.screen), main)
  })

  it('shows an empty tree and {} for a record without extra data', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down, keys.down, keys.enter)
    assert.deepEqual(detailsBox(screenText(viewer.screen), 3, 5), [
      '┌─ 2026-10-11T10:27:00.000Z - error - delta 27 ────────────────────────┐',
      '│                                                                      │'
    ])
    await press(viewer, 'j')
    assert.equal(detailsBox(screenText(viewer.screen), 4, 5)[0], '│ {}                                                                   │')
  })

  it('throws a TypeError when Enter reaches a details dialog that shows no record', t => {
    const viewer = openFileViewer(t, characterization)
    const details = new LogDetails({ screen: viewer.screen })
    const enter = { name: 'enter', full: 'enter', sequence: '\r', ctrl: false, meta: false, shift: false }
    assert.throws(() => details.emit('keypress', '\r', enter), TypeError)
  })

  // Replaces the useful formatEntry expectations of the skipped upstream browser.test.js.
  it('formats keys in bold blue and indents nested objects by one space', t => {
    const viewer = openFileViewer(t, characterization)
    const details = new LogDetails({ screen: viewer.screen })
    details.display({ timestamp: 'now', level: 'info', message: 'formatting', data: { Name: 'felipe' } })
    assert.equal(contentOf(details), '\n{blue-fg}{bold}Name:{/bold}{/blue-fg} felipe')
    details.display({ timestamp: 'now', level: 'info', message: 'formatting', data: { Data: { name: 'felipe', age: 12 } } })
    assert.equal(contentOf(details), [
      '',
      '{blue-fg}{bold}Data:{/bold}{/blue-fg}',
      ' {blue-fg}{bold}name:{/bold}{/blue-fg} felipe',
      ' {blue-fg}{bold}age: {/bold}{/blue-fg} 12'
    ].join('\n'))
  })
})
