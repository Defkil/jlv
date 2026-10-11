// Text for terminals (plan section 6.3). Records, file names, labels and the messages about them may hold control
// characters and escape sequences that a terminal acts on: colors, cursor moves, a cleared screen, a window title or a
// write to the clipboard. Whatever jlv writes to a terminal from them, in the viewer, as plain output or on standard
// error, passes through visibleText first: escape sequences are removed, and every other control character shows as
// its JSON escape, such as \n, \t or \u001b. The viewer escapes blessed tags on top of that.
//
// Records keep their original values: JSON lines and saved records only escape the control characters that
// JSON.stringify leaves as they are, which reads back as the same values.

// The control characters C0, DEL and C1, the line and paragraph separators, and the bidirectional embeddings,
// overrides and isolates, which reorder the text around them on screen.
// eslint-disable-next-line no-control-regex -- the pattern exists to find control characters
const controlPattern = /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u
const controlCharacters = new RegExp(controlPattern.source, 'gu')

// The escape sequences of ECMA-48, with ESC or as 8-bit controls, in the order in which they are tried:
// - control sequences: CSI, parameter bytes, intermediate bytes and a final byte, such as colors and cursor moves;
// - operating system commands, such as a window title, a hyperlink or a clipboard write, which BEL or ST end;
// - device control strings, start of string, privacy messages and application program commands, which ST ends;
// - any other sequence of ESC, intermediate bytes and a final byte, such as a character set or a reset.
// A control sequence, command or string without its end stays, and its ESC shows as \u001b.
// util.stripVTControlCharacters is not used: on Node 22 it leaves most of a window title or a hyperlink as text and
// drops text after a color, so that its result depends on the Node version.
const escapeSequences = new RegExp([
  String.raw`(?:\u{1B}\[|\u{9B})[\u{30}-\u{3F}]*[\u{20}-\u{2F}]*[\u{40}-\u{7E}]`,
  String.raw`(?:\u{1B}\]|\u{9D})[^\u{7}\u{1B}\u{9C}]*(?:\u{7}|\u{1B}\\|\u{9C})`,
  String.raw`(?:\u{1B}[PX\^_]|[\u{90}\u{98}\u{9E}\u{9F}])[^\u{1B}\u{9C}]*(?:\u{1B}\\|\u{9C})`,
  String.raw`\u{1B}[\u{20}-\u{2F}]*[\u{30}-\u{4F}\u{51}-\u{57}\u{59}\u{5A}\u{5C}\u{60}-\u{7E}]`
].join('|'), 'gu')

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

// The text without its escape sequences.
const stripEscapeSequences = (text: string): string => text.replaceAll(escapeSequences, '')

// The text as a terminal may show it: without escape sequences, and with the other control characters as JSON
// escapes. Text without control characters, the usual case, comes back as it is. The result holds no control
// characters, so a second pass changes nothing.
const visibleText = (text: string): string => hasControls(text) ? escapeControls(stripEscapeSequences(text)) : text

export { escapeControls, hasControls, visibleText }
