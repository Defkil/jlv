// Lifecycle of the main panel and its dialogs: one persistent row element, the restored border label, dialogs that
// are destroyed when they close, bounded widget and listener counts, and a visible order that is computed once per
// revision (plan section 8, phase 4). Upstream appended one row element per render (113 children after 110
// renders); upstream PR #13 then removed every second child per render, the border label and open prompts included.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Widgets } from 'blessed'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText, topBorder, type Viewer } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

// The cycles of the bounded-count tests. Plan section 8 proves the bounds with 10,000, which takes minutes with real
// keys and renders, so the suite runs 200 unless JLV_LIFECYCLE_CYCLES sets another count.
const cycles = Number(process.env['JLV_LIFECYCLE_CYCLES'] ?? 200)

const children = (node: Widgets.Node): string[] => node.children.map(child =>
  `${child.type}${Reflect.get(child, 'hidden') === true ? ' (hidden)' : ''}`)

// Listeners of an event emitter. blessed's own emitter and Node's both keep them in _events, as a function or a list.
const listenerCount = (emitter: object): number => {
  const events: unknown = Reflect.get(emitter, '_events')
  if (typeof events !== 'object' || events === null) {
    return 0
  }
  let count = 0
  for (const listeners of Object.values(events)) {
    count += Array.isArray(listeners) ? listeners.length : Number(typeof listeners === 'function')
  }
  return count
}

interface Census {
  readonly panelChildren: readonly string[]
  readonly screenChildren: readonly string[]
  readonly nodes: number
  readonly keyable: number
  readonly clickable: number
  readonly focusHistory: number
  readonly nodeListeners: number
  readonly programListeners: number
  readonly streamListeners: number
}

// Everything that a leaking widget or listener would grow.
const census = (viewer: Viewer): Census => {
  const { screen } = viewer
  let nodes = 0
  let nodeListeners = 0
  screen.forDescendants(node => {
    nodes += 1
    nodeListeners += listenerCount(node)
  }, true)
  const history: unknown = Reflect.get(screen, 'history')
  return {
    panelChildren: children(viewer.panel),
    screenChildren: children(screen),
    nodes,
    keyable: screen.keyable.length,
    clickable: screen.clickable.length,
    focusHistory: Array.isArray(history) ? history.length : -1,
    nodeListeners,
    programListeners: listenerCount(screen.program),
    streamListeners: listenerCount(viewer.input) + listenerCount(viewer.output)
  }
}

// One round of navigation, renders, a resize and every dialog the panel opens, each closed again.
const cycle = async (viewer: Viewer): Promise<void> => {
  await press(viewer, keys.down, keys.down, keys.up, keys.pageDown, keys.pageUp, '$', '0', 'G', 'A')
  await press(viewer, keys.enter, 'j', keys.pageDown, keys.escape)
  await press(viewer, 's', keys.escape, 'l', keys.escape)
  await press(viewer, '/', 'zzz', keys.enter, keys.enter)
  await press(viewer, 'g', keys.escape)
  viewer.output.resizeTo(100, 30)
  await nextTurn()
  viewer.output.resizeTo(80, 24)
  await nextTurn()
}

describe('main panel lifecycle', () => {
  it('keeps the row element and the border label as its only children however often it renders', async t => {
    const viewer = openFileViewer(t, characterization)
    assert.deepEqual(children(viewer.panel), ['element', 'box'])
    await press(viewer, ...Array.from({ length: 10 }, () => keys.down))
    assert.deepEqual(children(viewer.panel), ['element', 'box'])
    for (let render = 0; render < 100; render += 1) {
      viewer.panel.renderLines()
    }
    assert.deepEqual(children(viewer.panel), ['element', 'box'])
  })

  it('shows the file name and the cursor position in the border label again', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, ...Array.from({ length: 10 }, () => keys.down))
    assert.equal(screenText(viewer.screen)[0], topBorder('characterization.log', '11/32'))
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  11/32 | 20 | sort: -timestamp')
  })

  it('destroys a prompt and a message when they close', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/', 'zzz', keys.enter)
    assert.deepEqual(children(viewer.panel), ['element', 'box', 'question'])
    await press(viewer, keys.enter)
    assert.deepEqual(children(viewer.panel), ['element', 'box'])
    assert.equal(viewer.screen.focused, viewer.panel)
  })

  it('destroys the details and the pickers when they close and gives the focus back to the panel', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.enter)
    assert.deepEqual(children(viewer.screen), ['box', 'box', 'box'])
    await press(viewer, keys.escape)
    assert.deepEqual(children(viewer.screen), ['box', 'box'])
    assert.equal(viewer.screen.focused, viewer.panel)
    await press(viewer, 'l', keys.escape, 's', 'l')
    assert.deepEqual(children(viewer.screen), ['box', 'box'])
    assert.equal(viewer.screen.focused, viewer.panel)
  })

  // PR #13 detached an open prompt on the second resize while the prompt kept reading keys.
  it('keeps an open prompt through resizes', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/')
    viewer.output.resizeTo(100, 30)
    await nextTurn()
    viewer.output.resizeTo(80, 24)
    await nextTurn()
    assert.deepEqual(children(viewer.panel), ['element', 'box', 'prompt'])
    assert.ok(screenText(viewer.screen).some(row => row.includes('Search:')))
    await press(viewer, 'charlie', keys.enter)
    assert.equal(viewer.panel.row, 5)
    assert.deepEqual(children(viewer.panel), ['element', 'box'])
    assert.equal(Reflect.get(viewer.screen, 'grabKeys'), false)
  })

  it(`keeps widget and listener counts bounded over ${String(cycles)} cycles of navigation, renders, resizes and dialogs`, async t => {
    const viewer = openFileViewer(t, characterization)
    // blessed keeps the last ten focused elements; two cycles fill that history.
    await cycle(viewer)
    await cycle(viewer)
    const before = census(viewer)
    assert.equal(before.focusHistory, 10)
    for (let round = 0; round < cycles; round += 1) {
      await cycle(viewer)
    }
    assert.deepEqual(census(viewer), before)
    assert.deepEqual(before.panelChildren, ['element', 'box'])
    assert.deepEqual(before.screenChildren, ['box', 'box'])
  })

  it('computes the visible order once per data or query revision, never on cursor moves or renders', async t => {
    const viewer = openFileViewer(t, characterization)
    const computations = viewer.panel.orderComputations
    for (let move = 0; move < cycles; move += 1) {
      viewer.panel.moveDown()
      viewer.panel.moveUp()
    }
    await press(viewer, keys.pageDown, keys.pageUp, '$', '0', 'G', 'A', 'C', keys.enter, keys.escape)
    assert.equal(viewer.panel.orderComputations, computations)
    await press(viewer, 's', 'l')
    assert.equal(viewer.panel.orderComputations, computations + 1)
    await press(viewer, 'l', 'e')
    assert.equal(viewer.panel.orderComputations, computations + 2)
    await press(viewer, keys.down, keys.down, keys.up)
    assert.equal(viewer.panel.orderComputations, computations + 2)
    await press(viewer, 'f')
    assert.equal(viewer.panel.orderComputations, computations + 3)
    viewer.panel.loadFile('characterization.log')
    assert.equal(viewer.panel.orderComputations, computations + 4)
  })
})
