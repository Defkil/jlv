// The terminal sanitizer of src/terminal-text.ts (plan section 6.3, upstream issues #6 and #18): escape sequences are
// removed, other control characters show as JSON escapes, and everything else, slashes, backslashes and braces
// included, stays literal text.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { escapeControls, hasControls, visibleText } from '../src/terminal-text.js'

const escape = '\u{1B}'
const bell = '\u{7}'
const stringTerminator = `${escape}\\`

// Characters that a terminal acts on: C0, DEL, C1, the line and paragraph separators and the bidirectional controls.
// eslint-disable-next-line no-control-regex -- the test looks for control characters
const actionable = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u

// Escape sequences and control characters as logs may hold them: colors, cursor moves, a cleared screen, the alternate
// screen, a window title, a hyperlink, a clipboard write, a device control string, a lone escape and the 8-bit CSI.
const hostile = [
  `${escape}[31mred${escape}[0m`,
  `${escape}[2J${escape}[Hcleared`,
  `${escape}[?1049h${escape}[?25l`,
  `${escape}]0;window title${bell}after the title`,
  `${escape}]2;title${stringTerminator}after the title`,
  `${escape}]8;;https://example.invalid${stringTerminator}link${escape}]8;;${stringTerminator}`,
  `${escape}]52;c;aGVsbG8=${bell}clipboard`,
  `${escape}Pdevice control${stringTerminator}`,
  `lone ${escape} escape`,
  '\u{9B}31m8-bit CSI',
  `bell${bell} and backspace\b`,
  'tab\tline\nreturn\r',
  'delete\u{7F} next line\u{85}',
  'line separator\u{2028}paragraph separator\u{2029}',
  'right-to-left \u{202E}override\u{202C} and isolate \u{2066}x\u{2069}'
]

describe('visible text', () => {
  it('removes escape sequences and keeps the text around them', () => {
    assert.equal(visibleText(`${escape}[31mred${escape}[0m`), 'red')
    assert.equal(visibleText(`${escape}[2J${escape}[Hcleared`), 'cleared')
    assert.equal(visibleText(`${escape}]0;window title${bell}after the title`), 'after the title')
    assert.equal(visibleText(`${escape}]8;;https://example.invalid${stringTerminator}link${escape}]8;;${stringTerminator}`), 'link')
    assert.equal(visibleText(`${escape}]52;c;aGVsbG8=${bell}clipboard`), 'clipboard')
  })

  // Node 22's util.stripVTControlCharacters left most of these as text, or dropped the text after a color.
  it('removes every kind of ECMA-48 sequence, whatever the Node version', () => {
    assert.equal(visibleText(`${escape}]0;title with spaces and é${bell}after`), 'after')
    assert.equal(visibleText(`${escape}[38:5:9mcolon ${escape}[38;2;255;0;0mtrue color`), 'colon true color')
    assert.equal(visibleText(`${escape}[31mtext${bell}`), String.raw`text\u0007`)
    assert.equal(visibleText(`${escape}Pdevice control${stringTerminator}after`), 'after')
    assert.equal(visibleText(`${escape}_application command${stringTerminator}after`), 'after')
    assert.equal(visibleText(`charset${escape}(B reset${escape}c save${escape}7`), 'charset reset save')
    assert.equal(visibleText('\u{9D}0;8-bit title\u{9C}after \u{9B}1m8-bit color'), 'after 8-bit color')
  })

  it('keeps a sequence without its end visible', () => {
    assert.equal(visibleText(`${escape}]0;no end`), String.raw`\u001b]0;no end`)
    assert.equal(visibleText(`end with ${escape}`), String.raw`end with \u001b`)
    assert.equal(visibleText(`${escape}Pno end`), String.raw`\u001bPno end`)
  })

  it('shows the remaining control characters as JSON escapes', () => {
    assert.equal(visibleText('tab\tline\nreturn\r'), String.raw`tab\tline\nreturn\r`)
    assert.equal(visibleText(`escape and line feed ${escape}\n`), String.raw`escape and line feed \u001b\n`)
    assert.equal(visibleText(`bell${bell} and backspace\b form feed\f`), String.raw`bell\u0007 and backspace\b form feed\f`)
    assert.equal(visibleText('nul\u{0} delete\u{7F} next line\u{85}'), String.raw`nul\u0000 delete\u007f next line\u0085`)
    assert.equal(visibleText('a\u{2028}b\u{2029}c'), String.raw`a\u2028b\u2029c`)
    assert.equal(visibleText('\u{202E}evil\u{202C} \u{2066}x\u{2069}'), String.raw`\u202eevil\u202c \u2066x\u2069`)
  })

  it('leaves no character that a terminal acts on, also after a second pass', () => {
    for (const text of hostile) {
      const visible = visibleText(text)
      assert.equal(hasControls(visible), false, JSON.stringify(text))
      assert.doesNotMatch(visible, actionable, JSON.stringify(text))
      assert.equal(visibleText(visible), visible, JSON.stringify(text))
    }
  })

  // Upstream issue #18: a slash, a backslash or a blessed tag in a log field is text.
  it('keeps slashes, backslashes, braces, quotes and other characters literal', () => {
    const literal = String.raw`GET /api/v1/{id} C:\temp\new {red-fg}{/} "quoted" 'single' é 漢字 😀 …`
    assert.equal(visibleText(literal), literal)
    assert.equal(visibleText(''), '')
  })
})

describe('escaped controls', () => {
  // JSON lines keep their values: the escapes read back as the original characters.
  it('escapes the control characters that JSON.stringify leaves as they are, and JSON reads them back', () => {
    const value = {
      text: 'delete\u{7F} csi\u{9B} next\u{85} separators\u{2028}\u{2029} bidi\u{202E}\u{2066}',
      escape: `${escape}[31m`,
      tab: '\t'
    }
    const line = escapeControls(JSON.stringify(value))
    assert.doesNotMatch(line, actionable)
    assert.deepEqual(JSON.parse(line), value)
    for (const escaped of [String.raw`\u007f`, String.raw`\u009b`, String.raw`\u2028`, String.raw`\u202e`]) {
      assert.ok(line.includes(escaped), escaped)
    }
  })

  it('returns text without control characters as it is', () => {
    const text = '{"message":"plain"}'
    assert.equal(escapeControls(text), text)
    assert.equal(escapeControls('a\nb'), String.raw`a\nb`)
  })
})
