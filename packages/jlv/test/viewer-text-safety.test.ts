// Text safety of the viewer (plan sections 6.3 and 8, phase 7; upstream issues #6 and #18): text from records, file
// names, the configuration and the user shows literally in rows, labels, the details, the status line and dialogs, at
// narrow and wide widths. Blessed tags in it stay text, escape sequences never reach the terminal, other control
// characters show as JSON escapes, and log text never changes the colors around it.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, type TestContext } from 'node:test'
import { cellStyle, keys, openFileViewer, press, screenText, type Viewer } from './support/terminal.js'

const escape = '\u{1B}'
const bell = '\u{7}'
const defaultColor = 0x1_FF

// Records whose text holds blessed tags, slashes, backslashes, ANSI and OSC sequences, the 8-bit CSI, tabs, line
// breaks and other control characters, in their messages, levels, timestamps, keys, values and identifiers.
const hostileRecords = [
  {
    timestamp: '2026-10-11T10:02:00.000Z',
    level: 'info',
    message: String.raw`GET /api/{id} C:\temp\new {red-fg}red{/red-fg} {bold}b{/bold} {/}`,
    path: String.raw`a/b\c`
  },
  {
    timestamp: '2026-10-11T10:01:00.000Z',
    level: 'error',
    message: `${escape}[31mansi${escape}[0m ${escape}]0;pwned title${bell}osc \u{9B}2Jcsi tab\there`,
    requestId: `{red-fg}id${escape}[1m`
  },
  {
    timestamp: 'not {a} time' + escape + '[2J',
    level: `{blue-fg}loud${escape}[5m`,
    message: 'line\nbreak\u{7F}',
    '{key}': '{value}' + escape + ']52;c;cHduZWQ=' + bell,
    nested: { deep: { empty: {} } },
    list: []
  }
]

// A log of the records in a directory with a name of blessed tags; the directory is removed after the test.
const hostileLog = (context: TestContext): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jlv-text-'))
  context.after(() => {
    process.chdir(tmpdir())
    rmSync(directory, { recursive: true, force: true })
  })
  const file = path.join(directory, '{red-fg}hostile{bold}.log')
  writeFileSync(file, hostileRecords.map(record => `${JSON.stringify(record)}\n`).join(''))
  return file
}

// The screen row that shows a text, and its column.
const find = (viewer: Viewer, text: string): { readonly row: number, readonly column: number } => {
  const rows = screenText(viewer.screen)
  const row = rows.findIndex(line => line.includes(text))
  assert.ok(row !== -1, `no row shows ${text}:\n${rows.join('\n')}`)
  return { row, column: rows[row]?.indexOf(text) ?? -1 }
}

// The styles of the cells of a text on the screen.
const stylesOf = (viewer: Viewer, text: string): string[] => {
  const { row, column } = find(viewer, text)
  return Array.from({ length: text.length }, (_, offset) => {
    const style = cellStyle(viewer.screen, column + offset, row)
    return `${String(style.foreground)}/${String(style.background)}/${String(style.isBold)}`
  })
}

describe('log text in the viewer', () => {
  for (const columns of [40, 80, 160]) {
    it(`shows tags, slashes and backslashes literally and no escape sequence on ${String(columns)} columns`, t => {
      const viewer = openFileViewer(t, hostileLog(t), { columns, isRecording: true })
      const rows = screenText(viewer.screen)
      const text = rows.join('\n')
      assert.ok(rows.every(row => row.length <= columns), text)
      // The newest record is the cursor row; its message starts with the request line. On 40 columns the message
      // keeps a third of the row.
      assert.ok(text.includes(columns >= 80 ? 'GET /api/{id}' : 'GET /api/{…'), text)
      if (columns === 160) {
        assert.ok(text.includes(String.raw`GET /api/{id} C:\temp\new {red-fg}red{/red-fg} {bold}b{/bold} {/}`), text)
        assert.ok(text.includes(String.raw`ansi osc csi tab\there`), text)
        assert.ok(text.includes(String.raw`line\nbreak\u007f`), text)
        assert.ok(text.includes('not {a} time'), text)
        assert.ok(text.includes('{blue-fg}lo…'), text)
      }
      // The terminal never received the window title, the clipboard write, the 8-bit CSI or a bell.
      const written = viewer.output.written
      assert.ok(!written.includes('pwned') && !written.includes('cHduZWQ=') && !written.includes('\u{9B}') && !written.includes(bell))
    })
  }

  it('keeps the colors of the row around tags and ANSI sequences of the message', async t => {
    const viewer = openFileViewer(t, hostileLog(t), { columns: 160 })
    // The cursor row is black on white, also over the text of tags.
    assert.deepEqual(new Set(stylesOf(viewer, '{red-fg}red{/red-fg} {bold}b{/bold} {/}')), new Set(['0/7/false']))
    await press(viewer, keys.down)
    // Off the cursor, the message has the default colors; the error level keeps its red.
    assert.deepEqual(new Set(stylesOf(viewer, '{red-fg}red{/red-fg} {bold}b{/bold} {/}')), new Set([`${String(defaultColor)}/${String(defaultColor)}/false`]))
    assert.deepEqual(new Set(stylesOf(viewer, 'ansi osc csi')), new Set(['0/7/false']))
    assert.deepEqual(new Set(stylesOf(viewer, 'error')), new Set(['1/7/false']))
    await press(viewer, keys.down)
    assert.deepEqual(new Set(stylesOf(viewer, 'ansi osc csi')), new Set([`${String(defaultColor)}/${String(defaultColor)}/false`]))
  })

  it('shows the file name of the border label literally', t => {
    const viewer = openFileViewer(t, hostileLog(t), { columns: 80 })
    assert.match(screenText(viewer.screen)[0] ?? '', /^┌──\[ \{red-fg\}hostile\{bold\}\.log \] \[ 1\/3 \]─+┐$/u)
    assert.deepEqual(new Set(stylesOf(viewer, '{red-fg}hostile{bold}.log').map(style => style.split('/', 1)[0])), new Set([String(defaultColor)]))
  })
})

describe('log text in the details', () => {
  it('shows keys and values with tags and escape sequences literally in the tree and as JSON', async t => {
    const viewer = openFileViewer(t, hostileLog(t), { columns: 100, rows: 30 })
    await press(viewer, '$', keys.enter)
    let text = screenText(viewer.screen).join('\n')
    assert.ok(text.includes(String.raw`─ not {a} time - {blue-fg}loud - line\nbreak\u007f ─`), text)
    assert.ok(text.includes('{key}:  {value}'), text)
    assert.ok(text.includes('nested:'), text)
    assert.ok(text.includes('   empty: {}'), text)
    assert.ok(text.includes('list:   []'), text)
    // The JSON view shows the exact JSON, with the escape sequence as JSON escapes.
    await press(viewer, 'j')
    text = screenText(viewer.screen).join('\n')
    assert.ok(text.includes(String.raw`"{key}": "{value}\u001b]52;c;cHduZWQ=\u0007",`), text)
    assert.ok(text.includes('"empty": {}'), text)
  })

  it('shows a value with the 8-bit CSI and an identifier with tags as text', async t => {
    const viewer = openFileViewer(t, hostileLog(t), { columns: 100, rows: 30 })
    await press(viewer, keys.down, keys.enter)
    const text = screenText(viewer.screen).join('\n')
    assert.ok(text.includes('requestId: {red-fg}id'), text)
    assert.deepEqual(new Set(stylesOf(viewer, '{red-fg}id').map(style => style.split('/', 1)[0])), new Set([String(defaultColor)]))
  })
})

describe('user text in dialogs', () => {
  it('shows a search term with tags literally in its message', async t => {
    const viewer = openFileViewer(t, hostileLog(t))
    await press(viewer, '/', '{red-fg}none{/}', keys.enter)
    assert.ok(screenText(viewer.screen).some(row => row.includes("No matches for '{red-fg}none{/}'")))
    assert.deepEqual(new Set(stylesOf(viewer, '{red-fg}none{/}').map(style => style.split('/', 1)[0])), new Set([String(defaultColor)]))
    await press(viewer, keys.enter)
  })
})
