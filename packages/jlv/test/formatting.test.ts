// The viewer's text of src/tui/formatting.ts (plan section 6.3, upstream issue #18): markup whose values are always
// text, widths in the cells that blessed draws, cuts that never split a character, and rows that never grow wider than
// the panel. Replaces the characterization of upstream src/utils.js, whose layout read tags inside values as markup.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  boundText, composeMarkup, cutStartToWidth, cutToWidth, displayText, displayWidth, escapeMarkup, layoutRows, markup,
  maximumDisplayText, padToWidth
} from '../src/tui/formatting.js'

describe('markup', () => {
  it('keeps the tags of its literal parts and shows every value as text', () => {
    assert.equal(markup`{bold}${'{red-fg}red{/red-fg}'}{/}`, '{bold}{open}red-fg{close}red{open}/red-fg{close}{/}')
    assert.equal(markup`{bold}${String.raw`a/b\c`}{/}`, String.raw`{bold}a/b\c{/}`)
    assert.equal(markup`{bold}${'\u{1B}[31mred\u{1B}[0m\tnext'}{/}`, String.raw`{bold}red\tnext{/}`)
  })

  it('combines trusted markup without escaping it', () => {
    const row = markup`${'{x}'}`
    assert.equal(composeMarkup`{white-bg}${row}{/}`, '{white-bg}{open}x{close}{/}')
  })

  it('escapes braces only', () => {
    assert.equal(escapeMarkup('{}{/}{{'), '{open}{close}{open}/{close}{open}{open}')
    assert.equal(escapeMarkup('plain [text] (here)'), 'plain [text] (here)')
  })
})

describe('display text', () => {
  it('bounds long text without splitting a surrogate pair', () => {
    const long = 'x'.repeat(maximumDisplayText + 10)
    assert.equal(boundText(long), `${'x'.repeat(maximumDisplayText)}…`)
    const emoji = `${'x'.repeat(maximumDisplayText - 1)}😀😀`
    assert.equal(boundText(emoji), `${'x'.repeat(maximumDisplayText - 1)}…`)
    assert.equal(boundText('short'), 'short')
    assert.equal(displayText(`${'\u{1B}[31m'.repeat(10)}text\u{7}`), String.raw`text\u0007`)
  })
})

describe('widths', () => {
  // A wide character takes two cells and a combining mark none, with fullUnicode or without; displayText replaces other
  // characters outside the Basic Multilingual Plane with ?, which counts the cell that blessed gives such a character.
  // wide-characters.test.ts lays the samples out and draws them.
  it('count the cells that blessed draws', () => {
    assert.equal(displayWidth('plain text'), 10)
    assert.equal(displayWidth('café'), 4)
    assert.equal(displayWidth('cafe\u{301}'), 4)
    assert.equal(displayWidth('漢字'), 4)
    assert.equal(displayWidth('😀'), 1)
    assert.equal(displayWidth('\u{20000}'), 2)
    assert.equal(displayWidth('…'), 1)
  })

  it('cut at a number of cells with an ellipsis and never split a character', () => {
    assert.equal(cutToWidth('abcdef', 4), 'abc…')
    assert.equal(cutToWidth('abcdef', 6), 'abcdef')
    assert.equal(cutToWidth('abcdef', 1), '…')
    assert.equal(cutToWidth('abcdef', 0), '')
    assert.equal(cutToWidth('abcdef', -3), '')
    assert.equal(cutToWidth('漢字漢字', 5), '漢字…')
    assert.equal(cutToWidth('漢字漢字', 4), '漢…')
    assert.equal(cutToWidth('😀😀😀😀', 3), '😀😀…')
    assert.equal(cutToWidth('e\u{301}e\u{301}e\u{301}', 2), 'e\u{301}…')
  })

  it('cut from the start to keep the end', () => {
    assert.equal(cutStartToWidth('very-long-name.log', 8), '…ame.log')
    assert.equal(cutStartToWidth('😀😀😀😀', 3), '…😀😀')
    assert.equal(cutStartToWidth('name', 8), 'name')
    assert.equal(cutStartToWidth('name', 0), '')
  })

  it('pad to a number of cells', () => {
    assert.equal(padToWidth('漢', 4), '漢  ')
    assert.equal(padToWidth('wider', 3), 'wider')
  })
})

describe('rows', () => {
  const columns = [{ maximumWidth: 10 }, { maximumWidth: 3 }, { maximumWidth: 0 }]

  it('size each column by its widest text up to its maximum and give the last one the rest', () => {
    assert.deepEqual(layoutRows([
      [{ text: 'first' }, { text: 'ab' }, { text: 'message' }],
      [{ text: 'second one' }, { text: 'abcd' }, { text: 'm' }]
    ], columns, 2, 30), [
      'first       ab   message        ',
      'second one  ab…  m              '
    ].map(row => row.slice(0, 30)))
  })

  it('never grow wider than the width, also when the columns take it all', () => {
    for (const width of [0, 1, 5, 12, 16, 17, 40]) {
      const rows = layoutRows([[{ text: 'abcdefghij' }, { text: 'xyz' }, { text: 'message' }]], columns, 2, width)
      assert.equal(rows[0]?.length, width, String(width))
    }
    assert.deepEqual(layoutRows([[{ text: 'abcdefghij' }, { text: 'xyz' }, { text: 'message' }]], columns, 2, 12), ['abcde…  mes…'])
  })

  it('escape the text of a cell and wrap it in the cell\'s color and weight', () => {
    const [row] = layoutRows([[{ text: 'info', color: '#ffff94', isBold: true }, { text: '{x}' }, { text: 'a\nb {red-fg}' }]], columns, 1, 30)
    assert.equal(row, '{#ffff94-fg}{bold}info{/bold}{/#ffff94-fg} {open}x{close} ' + String.raw`a\nb` + ' {open}red-fg{close}' + ' '.repeat(8))
  })

  it('measure cells by their visible text', () => {
    const [row] = layoutRows([[{ text: '\u{1B}[31mred\u{1B}[0m' }, { text: '漢' }, { text: 'tab\tend' }]], columns, 1, 16)
    assert.equal(row, String.raw`red 漢 tab\tend `)
  })
})
