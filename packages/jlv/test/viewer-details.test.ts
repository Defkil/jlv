// Characterization of the details view: tree and JSON rendering, toggling, scrolling and closing.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, type TestContext } from 'node:test'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { LogDetails } from '../src/tui/log-details.js'
import { keys, openFileViewer, press, screenText } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)

// Reads the element that display() replaces on every call.
const contentOf = (details: LogDetails): string | undefined => details.element?.content

// The details box spans columns 4 to 75.
const detailsBox = (rows: readonly string[], from: number, to: number): string[] => rows.slice(from, to).map(row => row.slice(4, 76))

// A log with one record whose 40 data fields need 41 lines, more than the 17 lines inside the details dialog of a
// 24-row screen. The directory is removed after the test.
const longRecordLog = (context: TestContext): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jlv-details-'))
  context.after(() => {
    process.chdir(tmpdir())
    rmSync(directory, { recursive: true, force: true })
  })
  const fields = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`field${String(index).padStart(2, '0')}`, `value ${String(index)}`]))
  const file = path.join(directory, 'long.log')
  writeFileSync(file, `${JSON.stringify({ timestamp: '2026-10-11T10:00:00.000Z', level: 'info', message: 'long', ...fields })}\n`)
  return file
}

// The first and the last line inside the details dialog, which shows 17 lines on screen rows 4 to 20.
const visibleFields = (rows: readonly string[]): [string, string] => [rows[4]?.slice(6, 23).trim() ?? '', rows[20]?.slice(6, 23).trim() ?? '']

describe('details', () => {
  it('opens the cursor record with Enter and shows nested data as an indented tree', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.enter)
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
    await press(viewer, keys.down, keys.enter, 'j')
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

  it('explains a record without extra data and shows {} as JSON', async t => {
    const viewer = openFileViewer(t, characterization)
    await press(viewer, keys.down, keys.down, keys.enter)
    assert.deepEqual(detailsBox(screenText(viewer.screen), 3, 6), [
      '┌─ 2026-10-11T10:27:00.000Z - error - delta 27 ────────────────────────┐',
      '│                                                                      │',
      '│ (no other fields)                                                    │'
    ])
    await press(viewer, 'j')
    assert.equal(detailsBox(screenText(viewer.screen), 4, 5)[0], '│ {}                                                                   │')
  })

  // Adopted from farolanf/json-log-viewer 7758d95, with the PageUp step of 9d478af.
  it('scrolls by a page with PageUp and PageDown and to the ends with Home and End', async t => {
    const viewer = openFileViewer(t, longRecordLog(t))
    await press(viewer, keys.enter)
    assert.deepEqual(visibleFields(screenText(viewer.screen)), ['', 'field15: value 15'])
    await press(viewer, keys.pageDown)
    assert.deepEqual(visibleFields(screenText(viewer.screen)), ['field15: value 15', 'field31: value 31'])
    await press(viewer, keys.pageUp)
    assert.deepEqual(visibleFields(screenText(viewer.screen)), ['', 'field15: value 15'])
    await press(viewer, keys.end)
    assert.deepEqual(visibleFields(screenText(viewer.screen)), ['field23: value 23', 'field39: value 39'])
    await press(viewer, keys.home)
    assert.deepEqual(visibleFields(screenText(viewer.screen)), ['', 'field15: value 15'])
    await press(viewer, keys.shiftPageDown)
    assert.deepEqual(visibleFields(screenText(viewer.screen)), ['field23: value 23', 'field39: value 39'])
    await press(viewer, keys.up)
    assert.deepEqual(visibleFields(screenText(viewer.screen)), ['field22: value 22', 'field38: value 38'])
    await press(viewer, keys.escape)
    assert.equal(screenText(viewer.screen)[1], '│ 2026-10-11T10:00:00.000Z  info  *  long                                      │')
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

  // Plan section 6.3: the tree is bounded. Upstream padded keys with Math.max(...keys), which throws for very many
  // keys, and showed every value in full.
  it('shows nesting below 16 levels as JSON, the first 1000 entries of an object and the first 4096 characters of a value', t => {
    const viewer = openFileViewer(t, characterization)
    const details = new LogDetails({ screen: viewer.screen })
    let deep: unknown = 'leaf'
    for (let level = 0; level < 20; level += 1) {
      deep = { a: deep }
    }
    const many = Object.fromEntries(Array.from({ length: 150_000 }, (_, index) => [`key${String(index)}`, index]))
    details.display({ timestamp: 'now', level: 'info', message: 'bounds', data: { deep, many, long: 'x'.repeat(10_000), ['k'.repeat(100)]: 'wide key', short: 1 } })
    const lines = (contentOf(details) ?? '').split('\n')
    // Sixteen levels of tree, then the rest as JSON text with its braces escaped for blessed.
    assert.ok(lines.some(line => line.endsWith(' {open}"a":{open}"a":{open}"a":{open}"a":"leaf"{close}{close}{close}{close}')), lines.slice(0, 20).join('\n'))
    assert.equal(lines.filter(line => line.includes('{bold}key')).length, 1000)
    assert.ok(lines.some(line => line.endsWith('… 149000 more')))
    const long = lines.find(line => line.includes('long:')) ?? ''
    assert.ok(long.endsWith(`${'x'.repeat(4096)}…`) && !long.includes('x'.repeat(4097)))
    // A wide key pads the others to 32 cells at most.
    assert.ok(lines.some(line => line.includes('{bold}' + 'short:'.padEnd(33) + '{/bold}')))
  })
})
