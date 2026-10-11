// Characterization of how the main panel manages its children on every render. Upstream PR #13 makes
// update() remove the panel's children before it appends the new row element. Before the patch, every
// render appended one more element (3 children after loading, 13 after ten moves, 113 after another
// hundred renders) and kept the border label and closed dialogs.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, plainTopBorder, press, screenText, type Viewer } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

const children = (viewer: Viewer): string[] => viewer.panel.children.map(child =>
  `${child.type}${Reflect.get(child, 'hidden') === true ? ' (hidden)' : ''}`)

describe('main panel children', () => {
  it('keeps one row element however often the panel renders', async t => {
    const viewer = openFileViewer(t, characterization)
    assert.deepEqual(children(viewer), ['element'])
    await press(viewer, ...Array.from({ length: 10 }, () => keys.down))
    assert.deepEqual(children(viewer), ['element'])
    for (let render = 0; render < 100; render += 1) {
      viewer.panel.renderLines()
    }
    assert.deepEqual(children(viewer), ['element'])
  })

  it('removes the border label with the other children (regression of the patch)', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, ...Array.from({ length: 10 }, () => keys.down))
    assert.equal(screenText(viewer.screen)[0], plainTopBorder())
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  11/32 | 20 | sort: -timestamp')
  })

  // The patch removes children while iterating over the same array, so each render removes only every
  // second child. Once a dialog has been a child, two row elements remain.
  it('removes closed dialogs one render later and then keeps two row elements', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/', 'zzz', keys.enter)
    assert.deepEqual(children(viewer), ['element', 'prompt (hidden)', 'question'])
    await press(viewer, keys.enter)
    assert.deepEqual(children(viewer), ['prompt (hidden)', 'element'])
    await press(viewer, keys.down)
    assert.deepEqual(children(viewer), ['element', 'element'])
    for (let render = 0; render < 100; render += 1) {
      viewer.panel.renderLines()
    }
    assert.deepEqual(children(viewer), ['element', 'element'])
  })

  it('detaches an open prompt on the second resize while it keeps reading keys (modal limitation)', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/')
    assert.ok(screenText(viewer.screen).some(row => row.includes('Search:')))
    viewer.output.resizeTo(100, 30)
    await nextTurn()
    viewer.output.resizeTo(80, 24)
    await nextTurn()
    assert.deepEqual(children(viewer), ['element', 'element'])
    assert.ok(screenText(viewer.screen).every(row => !row.includes('Search:')))
    assert.equal(Reflect.get(viewer.screen, 'grabKeys'), true)
    await press(viewer, 'charlie', keys.enter)
    assert.equal(viewer.panel.row, 5)
  })
})
