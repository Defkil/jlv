// Text for terminals (plan section 6.3). Records, file names, labels and the messages about them may hold control
// characters and escape sequences that a terminal acts on: colors, cursor moves, a cleared screen, a window title or a
// write to the clipboard. Whatever jlv writes to a terminal from them, in the viewer, as plain output or on standard
// error, passes through visibleText first: escape sequences are removed, and every other control character shows as
// its JSON escape, such as \n, \t or \u001b. The viewer escapes blessed tags on top of that.
//
// Records keep their original values: JSON lines and saved records only escape the control characters that
// JSON.stringify leaves as they are, which reads back as the same values.
import { stripVTControlCharacters } from 'node:util'

// The control characters C0, DEL and C1, the line and paragraph separators, and the bidirectional embeddings,
// overrides and isolates, which reorder the text around them on screen.
// eslint-disable-next-line no-control-regex -- the pattern exists to find control characters
const controlPattern = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u
const controlCharacters = new RegExp(controlPattern.source, 'gu')

// JSON's short escapes; every other control character becomes \u and four hexadecimal digits, as in JSON.stringify.
const shortEscapes: ReadonlyMap<string, string> = new Map([
  ['\b', String.raw`\b`], ['\t', String.raw`\t`], ['\n', String.raw`\n`], ['\f', String.raw`\f`], ['\r', String.raw`\r`]
])

const unicodeEscape = String.raw`\u`

const escapeOf = (character: string): string =>
  shortEscapes.get(character) ?? `${unicodeEscape}${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`

// Whether the text holds a character that visibleText or escapeControls changes.
const hasControls = (text: string): boolean => controlPattern.test(text)

// The text with each control character as its JSON escape.
const escapeControls = (text: string): string =>
  hasControls(text) ? text.replaceAll(controlCharacters, character => escapeOf(character)) : text

// The text as a terminal may show it: without escape sequences, and with the other control characters as JSON
// escapes. Text without control characters, the usual case, comes back as it is. The result holds no control
// characters, so a second pass changes nothing.
const visibleText = (text: string): string => hasControls(text) ? escapeControls(stripVTControlCharacters(text)) : text

export { escapeControls, hasControls, visibleText }
