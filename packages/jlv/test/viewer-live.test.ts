// Records that arrive while the viewer is open (plan sections 6.1 and 8, phase 5): the selection stays on its
// record, a cursor at the newest end follows new records, the status line reports what the store keeps, and the
// panel asks the application to quit instead of ending the process itself.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { keys, openFileViewer, press, screenText, visibleEntries, type Viewer } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

const record = (minute: number, message: string): string =>
  `${JSON.stringify({ timestamp: `2026-10-11T11:${String(minute).padStart(2, '0')}:00.000Z`, level: 'info', message })}\n`

// The identifier of the record under the cursor: its source and record number.
const selected = (viewer: Viewer): string | undefined => {
  const sequence = viewer.panel.order[viewer.panel.row]
  return sequence === undefined ? undefined : viewer.store.identifierAt(sequence)
}

describe('arriving records', () => {
  it('keeps the cursor on its record and in its screen row when newer records sort in above it', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.down)
    const identifier = selected(viewer)
    assert.equal(viewer.panel.entryAt(viewer.panel.row)?.message, 'charlie 26')
    viewer.append(record(1, 'newer one') + record(2, 'newer two'))
    assert.equal(selected(viewer), identifier)
    assert.deepEqual([viewer.panel.row, viewer.panel.initialRow], [5, 2])
    assert.equal(screenText(viewer.screen)[4], '│ 2026-10-11T10:26:00.000Z  warn   *  charlie 26                               │')
  })

  it('follows the newest record while the cursor is at the start of a descending order', t => {
    const viewer = openFileViewer(t, characterization)
    viewer.append(record(1, 'newest'))
    assert.equal(viewer.panel.row, 0)
    assert.equal(viewer.panel.entryAt(0)?.message, 'newest')
    assert.match(screenText(viewer.screen)[0] ?? '', /\[ 1\/32 \]/u)
  })

  it('follows the newest record at the end of the arrival order until the cursor moves away and again from $', async t => {
    const viewer = openFileViewer(t, characterization, { sort: 'arrival' })
    assert.equal(viewer.panel.row, 30)
    viewer.append(record(1, 'first new'))
    assert.deepEqual([viewer.panel.row, viewer.panel.entryAt(viewer.panel.row)?.message], [31, 'first new'])
    await press(viewer, keys.up)
    const identifier = selected(viewer)
    viewer.append(record(2, 'second new'))
    assert.equal(viewer.panel.row, 30)
    assert.equal(selected(viewer), identifier)
    await press(viewer, '$')
    viewer.append(record(3, 'third new'))
    assert.deepEqual([viewer.panel.row, viewer.panel.entryAt(viewer.panel.row)?.message], [33, 'third new'])
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  34/34 | 20 | sort: arrival | 4 skipped')
  })

  it('reports the retained and the seen records once the store evicts and keeps the newest ones', t => {
    const viewer = openFileViewer(t, characterization, { maximumRecords: 10 })
    assert.equal(visibleEntries(viewer.panel).length, 10)
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/10 | 20 | sort: -timestamp | kept 10 of 31 | 4 skipped')
    viewer.append(record(1, 'one more'))
    assert.deepEqual([viewer.store.retained, viewer.store.seen, viewer.store.evicted], [10, 32, 22])
    assert.equal(viewer.panel.entryAt(0)?.message, 'one more')
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/10 | 20 | sort: -timestamp | kept 10 of 32 | 4 skipped')
  })

  it('moves the cursor to the nearest row when its record is evicted', async t => {
    const viewer = openFileViewer(t, characterization, { maximumRecords: 5, sort: 'arrival' })
    await press(viewer, '0')
    assert.equal(viewer.panel.row, 0)
    viewer.append(record(1, 'one more'))
    assert.equal(viewer.panel.row, 0)
    assert.equal(visibleEntries(viewer.panel).length, 5)
  })

  it('shows whether records are still loading or arriving', t => {
    const viewer = openFileViewer(t, characterization)
    viewer.ingestion.activity = 'live'
    viewer.panel.refresh()
    assert.equal(screenText(viewer.screen)[23], '  NORMAL  1/31 | 20 | sort: -timestamp | live | 4 skipped')
    viewer.ingestion.activity = 'loading'
    viewer.panel.refresh()
    assert.match(screenText(viewer.screen)[23] ?? '', /\| loading \|/u)
  })

  it('keeps the mode of an open dialog when records arrive', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, '/')
    viewer.append(record(1, 'during the search'))
    assert.equal(viewer.panel.mode, 'search')
    assert.ok(screenText(viewer.screen).some(row => row.includes('Search:')))
    await press(viewer, keys.escape)
  })
})

describe('arrival order and quitting', () => {
  it('offers arrival in the sort picker and shows the records in the order they arrived', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, 's')
    assert.ok(screenText(viewer.screen).some(row => row.includes('│ arrival ')))
    await press(viewer, 'a')
    assert.equal(viewer.panel.sort, 'arrival')
    assert.deepEqual(visibleEntries(viewer.panel).slice(0, 2).map(entry => entry.message), ['alpha 00', 'bravo 07'])
    await press(viewer, 's', 'a')
    assert.equal(viewer.panel.sort, '-arrival')
    assert.equal(viewer.panel.entryAt(0)?.message, 'foxtrot 23')
  })

  // Upstream called process.exit inside the panel.
  it('asks the application to quit with q', async t => {
    const viewer = openFileViewer(t, characterization)
    let quits = 0
    viewer.panel.on('quit', () => { quits += 1 })
    await press(viewer, 'q')
    assert.equal(quits, 1)
  })
})
