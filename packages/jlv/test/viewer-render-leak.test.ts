// Characterization of how the main panel manages its children on every render (upstream PR #13 topic).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

const childTypes = (children: readonly { readonly type: string }[]): string[] => children.map(child => child.type)

describe('main panel children', () => {
  it('appends one more row element on every render (upstream leak)', async t => {
    const viewer = openFileViewer(t, characterization)
    // The border label plus one element for the constructor render and one for loading the file.
    assert.deepEqual(childTypes(viewer.panel.children), ['box', 'element', 'element'])
    await press(viewer, ...Array.from({ length: 10 }, () => keys.down))
    assert.equal(viewer.panel.children.length, 13)
    for (let render = 0; render < 100; render += 1) {
      viewer.panel.renderLines()
    }
    assert.equal(viewer.panel.children.length, 113)
  })

  it('keeps the border label with the file name and the cursor position', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, ...Array.from({ length: 10 }, () => keys.down))
    assert.equal(screenText(viewer.screen)[0], '┌──[ characterization.log ] [ 11/32 ]──────────────────────────────────────────┐')
  })

  it('keeps closed prompts and messages as hidden children', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/', 'zzz', keys.enter, keys.enter)
    const dialogs = viewer.panel.children.filter(child => child.type === 'prompt' || child.type === 'question')
    assert.deepEqual(childTypes(dialogs), ['prompt', 'question'])
    assert.ok(dialogs.every(child => Reflect.get(child, 'hidden') === true))
  })
})
