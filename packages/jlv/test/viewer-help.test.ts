// The key help of the viewer (plan section 6.3): ? shows every key in a dialog that scrolls and closes, and the status
// line names ? while it has room.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keySections } from '../src/tui/key-help.js'
import { keys, openFileViewer, press, screenText, type Viewer } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

const isHelpOpen = (viewer: Viewer): boolean => screenText(viewer.screen).some(row => row.includes('─ Keys ─'))

const children = (viewer: Viewer): string[] => viewer.screen.children.map(child => child.type)

describe('key help', () => {
  it('opens with ? and lists the keys of the records, the details, the dialogs and itself', async t => {
    const viewer = openFileViewer(t, characterization, { columns: 120, rows: 60 })
    assert.match(screenText(viewer.screen).at(-1) ?? '', /\| \? help$/u)
    await press(viewer, '?')
    assert.ok(isHelpOpen(viewer))
    const text = screenText(viewer.screen).join('\n')
    for (const [title, rows] of keySections) {
      assert.ok(text.includes(title), title)
      for (const [, action] of rows) {
        assert.ok(text.includes(action), action)
      }
    }
    assert.match(text, /│ {3}c {19}show only the records of the correlation identifier of the record, or all again/u)
  })

  for (const closing of [keys.escape, keys.enter, 'q', '?']) {
    it(`closes with ${JSON.stringify(closing)} and gives the keys back to the records`, async t => {
      const viewer = openFileViewer(t, characterization)
      let quits = 0
      viewer.panel.on('quit', () => { quits += 1 })
      await press(viewer, '?', closing)
      assert.equal(isHelpOpen(viewer), false)
      assert.deepEqual(children(viewer), ['box', 'box'])
      assert.equal(viewer.screen.focused, viewer.panel)
      assert.equal(quits, 0)
      await press(viewer, keys.down)
      assert.equal(viewer.panel.row, 1)
    })
  }

  it('scrolls on a small screen to its last line and back', async t => {
    const viewer = openFileViewer(t, characterization, { rows: 16 })
    await press(viewer, '?')
    assert.equal(screenText(viewer.screen).some(row => row.includes('Enter, Escape, q, ?')), false)
    await press(viewer, keys.end)
    assert.ok(screenText(viewer.screen).some(row => row.includes('Enter, Escape, q, ?')))
    await press(viewer, keys.home)
    assert.ok(screenText(viewer.screen).some(row => row.includes('Records')))
    await press(viewer, keys.pageDown, keys.down, keys.up, keys.pageUp, keys.escape)
    assert.equal(isHelpOpen(viewer), false)
  })
})
