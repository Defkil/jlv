// The only module that loads the terminal backend, neo-blessed 0.2.0 (plan §4.2). Widgets extend Box and create
// their parts through these factories. src/types/neo-blessed.d.ts declares the library with the corrected types of
// blessed 0.1.81, whose API it keeps; callback payloads that the declarations describe wrongly are normalized here
// before they reach the widgets.
import terminalLibrary from 'neo-blessed'
import type { ScreenOptions } from 'neo-blessed'
import type { Widgets } from 'blessed'
import type { Writable } from 'node:stream'

const { Box, unicode } = terminalLibrary

// The viewer's screen draws wide characters such as CJK in two cells and combines combining marks with the character
// before them (fullUnicode). blessed turns that off by itself when the terminal does not take Unicode; then it draws a
// wide character as ??, drops zero-width characters and draws other characters outside the Basic Multilingual Plane
// as ?. Text that drawableText prepared takes the same cells either way.
const createScreen = (options: ScreenOptions, debugOutput?: Writable): Widgets.Screen => {
  // The backend opens log paths with truncating access and never closes its logger. The application instead owns
  // a checked destination; _logger is neo-blessed's private write-only stream slot used by Program#log.
  const screen = terminalLibrary.screen({ fullUnicode: true, ...options, log: undefined, dump: undefined })
  if (debugOutput !== undefined) {
    Reflect.set(screen.program, '_logger', debugOutput)
  }
  return screen
}

// Characters that take one cell in blessed and in every terminal: printable ASCII and the Latin letters and signs
// before the combining marks.
const singleCellText = /^[\u{20}-\u{7E}\u{A0}-\u{2FF}]*$/u

// blessed lays a character out in two cells when its pattern of wide characters matches it, and draws it as wide when
// its width table says 2; the two disagree on a few characters. Its patterns match UTF-16 code units, so they take no
// u flag; the copies are anchored and not global, so that testing one character keeps no state.
const laidOutWidePattern = new RegExp(`^(?:${unicode.chars.all.source})$`)
// Emoji that terminals draw in two cells, which blessed's tables, older than Unicode 9, give one.
const emojiPresentationPattern = /^\p{Emoji_Presentation}$/u
// Marks and format characters that terminals draw in no cell of their own and blessed's tables do not know.
const invisiblePattern = /^[\p{Mn}\p{Me}\p{Cf}]$/u
// The text and emoji presentation selectors, after which terminals disagree on the width of the character before.
const variationSelectors: ReadonlySet<string> = new Set(['\u{FE0E}', '\u{FE0F}'])

// One character as the viewer gives it to blessed: itself when blessed and terminals agree on its cells, ? when they
// do not, or nothing for an invisible character that only one of them would give a cell.
const drawableCharacter = (character: string): string => {
  if (character === '\n' || singleCellText.test(character)) {
    return character
  }
  if (variationSelectors.has(character)) {
    return ''
  }
  if (emojiPresentationPattern.test(character)) {
    return '?'
  }
  const point = character.codePointAt(0) ?? 0
  const width = unicode.charWidth(point)
  const isWide = laidOutWidePattern.test(character)
  if (isWide || width === 2) {
    return isWide && width === 2 ? character : '?'
  }
  if (width === 0) {
    return character
  }
  if (point > 0xFF_FF) {
    return '?'
  }
  return invisiblePattern.test(character) ? '' : character
}

// Visible text in the form whose cells blessed and the terminal agree on, whether blessed draws it with fullUnicode or
// without: composed (NFC, so that a decomposed ä is one character), with wide characters that both know as wide,
// combining marks that both know as such, and ? for emoji and every other character whose width they disagree on.
// Line breaks stay.
const drawableText = (text: string): string => {
  if (singleCellText.test(text)) {
    return text
  }
  let drawable = ''
  for (const character of text.normalize('NFC')) {
    drawable += drawableCharacter(character)
  }
  return drawable
}

// The cells that blessed gives text that drawableText prepared: two for a wide character, none for a combining mark,
// one for anything else. blessed's own patterns measure it, so the viewer's columns line up with what blessed draws.
const cellCount = (text: string): number => text
  .replaceAll(unicode.chars.all, '??')
  .replaceAll(unicode.chars.combining, '')
  .replaceAll(unicode.chars.surrogate, '?')
  .length

const createElement = (options: Widgets.BoxOptions): Widgets.BoxElement => terminalLibrary.element(options)

const createList = (options: Widgets.ListOptions<Widgets.ListElementStyle>): Widgets.ListElement => terminalLibrary.list(options)

const createPrompt = (options: Widgets.PromptOptions): Widgets.PromptElement => terminalLibrary.prompt(options)

const createQuestion = (options: Widgets.QuestionOptions): Widgets.QuestionElement => terminalLibrary.question(options)

// Shows the prompt and reports the entered text. blessed reports a cancelled prompt with null, which the declarations
// do not admit; it arrives here as undefined.
const readInput = (
  prompt: Widgets.PromptElement,
  text: string,
  value: string,
  callback: (error: unknown, input: string | undefined) => void
): void => {
  prompt.input(text, value, (error: unknown, input: unknown) => {
    callback(error, typeof input === 'string' ? input : undefined)
  })
}

// Shows the question and reports whether it was accepted. blessed answers with a boolean, not the declared text.
const ask = (question: Widgets.QuestionElement, text: string, callback: (error: unknown, isAccepted: boolean) => void): void => {
  question.ask(text, (error: unknown, answer: unknown) => {
    callback(error, answer === true)
  })
}

// blessed computes the size of an element or a screen as a number of cells; the declarations also admit the
// percentages of the options. Number() keeps upstream's implicit conversion.
const toCells: (size: number | string) => number = Number

// Turns blessed's wrapping of an element's content on or off; without it, lines longer than the element are cut at
// its edge. @types/blessed omits Element#wrap, and blessed keeps the lines it wrapped while the content stays the
// same, so the content is cleared: the next setContent() wraps it anew.
const setContentWrapping = (element: Widgets.BoxElement, isWrapping: boolean): void => {
  Reflect.set(element, 'wrap', isWrapping)
  element.setContent('')
}

// Removes an element that a widget owns for good. blessed's destroy() detaches the element and frees the screen
// listeners of its subtree, but two things stay behind: the screen keeps every descendant that ever took keys or
// clicks (the input and the buttons of a prompt, for example) in its keyable and clickable lists, and it moves the
// focus back only when the element itself had it, so a focused descendant keeps receiving keys. Both are handled.
const destroyElement = (element: Widgets.Node): void => {
  const subtree = new Set<Widgets.Node>()
  element.forDescendants(node => { subtree.add(node) }, true)
  const { screen } = element
  const hasFocus = subtree.has(screen.focused)
  screen.keyable = screen.keyable.filter(candidate => !subtree.has(candidate))
  screen.clickable = screen.clickable.filter(candidate => !subtree.has(candidate))
  element.destroy()
  if (hasFocus && subtree.has(screen.focused)) {
    screen.rewindFocus()
  }
}

export {
  Box, ask, cellCount, createElement, createList, createPrompt, createQuestion, createScreen, destroyElement, drawableText,
  readInput, setContentWrapping, singleCellText, toCells
}
