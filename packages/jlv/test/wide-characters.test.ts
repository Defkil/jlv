// Wide characters, emoji, combining marks and umlauts in the viewer (plan sections 0.15 and 8, phase 8). The screen
// runs with fullUnicode, and displayText leaves only characters on whose cells blessed and terminals agree: CJK in two
// cells, combining marks on the character before them, composed umlauts, and ? for emoji and every other character
// whose width they disagree on. Each sample is measured by the viewer, laid out by blessed with and without fullUnicode,
// and drawn to the terminal; the cells and the written text must match the measure.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it, type TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Widgets } from 'blessed'
import { createElement, createScreen } from '../src/tui/blessed-boundary.js'
import { cutToWidth, displayText, displayWidth } from '../src/tui/formatting.js'
import { TerminalOutput, keys, openFileViewer, press } from './support/terminal.js'

interface Sample {
  readonly name: string
  readonly text: string
  // What the viewer shows, and in how many cells.
  readonly shown: string
  readonly cells: number
}

const samples: readonly Sample[] = [
  { name: 'CJK', text: '漢字のログ', shown: '漢字のログ', cells: 10 },
  { name: 'Hangul', text: '한국어', shown: '한국어', cells: 6 },
  { name: 'fullwidth forms', text: 'ＡＢＣ', shown: 'ＡＢＣ', cells: 6 },
  { name: 'CJK beyond the Basic Multilingual Plane', text: '\u{20000}x', shown: '\u{20000}x', cells: 3 },
  { name: 'composed German umlauts', text: 'Grüße, Mäuse', shown: 'Grüße, Mäuse', cells: 12 },
  { name: 'decomposed German umlauts', text: 'Gru\u{308}ße, Ma\u{308}use', shown: 'Grüße, Mäuse', cells: 12 },
  { name: 'combining marks without a composed form', text: 'q\u{308}x\u{323}', shown: 'q\u{308}x\u{323}', cells: 2 },
  { name: 'emoji', text: 'go 🚀 now', shown: 'go ? now', cells: 8 },
  { name: 'emoji of the Basic Multilingual Plane', text: '✅ ok ❌', shown: '? ok ?', cells: 6 },
  { name: 'a text symbol with the emoji presentation selector', text: '❤\u{FE0F} x', shown: '❤ x', cells: 3 },
  { name: 'an emoji with a skin tone', text: '👍🏽', shown: '??', cells: 2 },
  { name: 'a flag', text: '🇩🇪', shown: '??', cells: 2 },
  { name: 'a joined family', text: '👨\u{200D}👩\u{200D}👧', shown: '?\u{200D}?\u{200D}?', cells: 3 },
  { name: 'a character that blessed lays out in one cell but draws in two', text: 'k\u{A960}m', shown: 'k?m', cells: 3 },
  { name: 'a symbol beyond the Basic Multilingual Plane', text: '\u{1D400}', shown: '?', cells: 1 },
  { name: 'a mark that blessed does not know', text: 'a\u{1AB0}b', shown: 'ab', cells: 2 }
]

const placeholder = '\u{3}'

// blessed moves the cursor over blank cells instead of writing spaces; a terminal shows the moves as the cells they
// skip.
const movesAsSpaces = (written: string): string =>
  // eslint-disable-next-line no-control-regex -- the pattern exists to find the cursor moves that start with ESC
  written.replaceAll(/\u{1B}\[(\d*)C/gu, (_, count: string) => ' '.repeat(count === '' ? 1 : Number(count)))

// The character of each cell of a screen row.
const lineCharacters = (screen: Widgets.Screen, row: number): string[] => {
  const lines: unknown = Reflect.get(screen, 'lines')
  const line: unknown = Array.isArray(lines) ? lines[row] : undefined
  return Array.isArray(line)
    ? line.map((cell: unknown) => {
      const character: unknown = Array.isArray(cell) ? cell[1] : undefined
      return typeof character === 'string' ? character : ''
    })
    : []
}

interface LaidOut {
  readonly isFullUnicode: boolean
  // The character of each cell; with fullUnicode, a wide character's second cell holds blessed's placeholder.
  readonly cells: readonly string[]
  readonly written: string
}

// Lays text out in a plain element on a screen of its own, which blessed gives fullUnicode only when the terminal takes
// Unicode, and returns the cells of the line and what the screen wrote to the terminal.
const layOut = async (text: string, isUnicodeTerminal: boolean): Promise<LaidOut> => {
  const output = new TerminalOutput(40, 3, true)
  const screen = createScreen({ input: new PassThrough(), output, terminal: 'xterm-256color', forceUnicode: isUnicodeTerminal, warnings: false })
  try {
    createElement({ screen, parent: screen, top: 0, left: 0, width: 40, height: 1, content: `${text}|` })
    screen.render()
    await nextTurn()
    return {
      isFullUnicode: screen.fullUnicode,
      cells: lineCharacters(screen, 0),
      written: output.written
    }
  } finally {
    screen.destroy()
  }
}

describe('characters of every width', () => {
  for (const sample of samples) {
    it(`${sample.name}: shown as blessed and terminals draw it, in the cells that the viewer measures`, async () => {
      const shown = displayText(sample.text)
      assert.equal(shown, sample.shown)
      assert.equal(displayWidth(shown), sample.cells)

      const full = await layOut(shown, true)
      assert.equal(full.isFullUnicode, true)
      // The marker after the text lands in the cell that the measure names.
      assert.equal(full.cells.indexOf('|'), sample.cells)
      // A wide character is drawn with blessed's placeholder in its second cell; nothing else holds one.
      for (const [index, character] of full.cells.entries()) {
        assert.equal(character === placeholder, /^[\u{1100}-\u{115F}\u{2E80}-\u{A4CF}\u{AC00}-\u{D7A3}\u{FF00}-\u{FF60}\u{20000}-\u{2FFFD}]/u.test(full.cells[index - 1] ?? ''), `cell ${String(index)}`)
      }
      // The terminal gets the text itself, without placeholders and without a character left out.
      assert.ok(movesAsSpaces(full.written).includes(`${shown}|`), JSON.stringify(full.written))
      assert.equal(full.written.includes(placeholder), false)

      // Without Unicode, blessed draws wide characters as ?? and drops combining marks, in the same cells.
      const plain = await layOut(shown, false)
      assert.equal(plain.isFullUnicode, false)
      assert.equal(plain.cells.indexOf('|'), sample.cells)
    })
  }

  it('cut without splitting a wide character or a character from its marks', () => {
    assert.equal(cutToWidth(displayText('漢字漢字'), 6), '漢字…')
    assert.equal(cutToWidth(displayText('漢字漢字'), 5), '漢字…')
    assert.equal(cutToWidth(displayText('Gru\u{308}ße'), 4), 'Grü…')
    assert.equal(cutToWidth(displayText('q\u{308}q\u{308}q\u{308}'), 2), 'q\u{308}…')
  })
})

// A log whose messages hold the samples, in a directory that is removed after the test.
const sampleLog = (context: TestContext): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jlv-wide-'))
  context.after(() => {
    process.chdir(tmpdir())
    rmSync(directory, { recursive: true, force: true })
  })
  const file = path.join(directory, '漢字.log')
  const records = samples.map((sample, index) => ({
    timestamp: `2026-10-11T10:${String(index).padStart(2, '0')}:00.000Z`,
    level: 'info',
    message: `${sample.text} end`,
    note: sample.text
  }))
  writeFileSync(file, records.map(record => `${JSON.stringify(record)}\n`).join(''))
  return file
}

describe('wide characters in the viewer', () => {
  it('line up the rows, the label and the details on a screen with fullUnicode', async t => {
    const viewer = openFileViewer(t, sampleLog(t), { columns: 60, rows: 24, isRecording: true })
    assert.equal(viewer.screen.fullUnicode, true)
    const rows = Array.from({ length: 24 }, (_, row) => lineCharacters(viewer.screen, row))
    const text = (cells: readonly string[]): string => cells.filter(character => character !== placeholder).join('')
    // The label names the file in its CJK characters.
    assert.match(text(rows[0] ?? []), /^┌──\[ 漢字\.log \] \[ 1\/16 \]─+┐$/u)
    // Newest first: the last sample is in the first row. Every record row shows its message as the viewer measured it,
    // and ends with the panel's border in the last cell.
    for (const [index, sample] of samples.entries()) {
      const cells = rows[samples.length - index] ?? []
      assert.equal(cells.length, 60)
      assert.equal(cells[59], '│', sample.name)
      assert.ok(text(cells).includes(`${sample.shown} end`), `${sample.name}: ${text(cells)}`)
    }
    assert.equal(viewer.output.written.includes(placeholder), false)
    for (const emoji of ['🚀', '✅', '🇩', '👍']) {
      assert.equal(viewer.output.written.includes(emoji), false, emoji)
    }
    // The details of the decomposed umlauts, ten rows down, show them composed: in the title, the tree and the JSON.
    await press(viewer, ...Array.from({ length: 10 }, () => keys.down), keys.enter)
    const details = (): string => Array.from({ length: 24 }, (_, row) => text(lineCharacters(viewer.screen, row))).join('\n')
    assert.ok(details().includes('info - Grüße, Mäuse'), details())
    assert.ok(details().includes('note: Grüße, Mäuse'), details())
    await press(viewer, 'j')
    assert.ok(details().includes('"note": "Grüße, Mäuse"'), details())
  })
})
