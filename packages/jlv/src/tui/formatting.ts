// The text of the viewer (plan section 6.3, upstream issue #18): trusted blessed markup around text from records,
// files, the configuration and the user. Such text can never act as markup or reach the terminal as an escape
// sequence: it is bounded, passes through visibleText (terminal-text.ts) and escapeMarkup, and is measured and cut by
// the cells that blessed gives it, without splitting a character.
//
// Successor of upstream src/utils.js, whose column layout measured text by its length, read tags inside values as
// markup and let blessed act on their escape sequences.
import { visibleText } from '../terminal-text.js'
import { cellCount, drawableText, singleCellText } from './blessed-boundary.js'

// The longest text that the viewer prepares for one cell, label or value; longer text is cut before it is sanitized
// and measured, so that showing a record of a megabyte costs no more than showing a short one.
const maximumDisplayText = 4096

const ellipsis = '…'

// { and } show as themselves in an element that reads blessed tags.
const escapeMarkup = (text: string): string => text.replaceAll(/[{}]/gu, brace => brace === '{' ? '{open}' : '{close}')

// The text cut to a number of UTF-16 code units without splitting a surrogate pair, with an ellipsis when it was
// longer.
const boundText = (text: string, limit = maximumDisplayText): string => {
  if (text.length <= limit) {
    return text
  }
  // A code point beyond 0xFFFF at the last kept position is a surrogate pair that the limit would split.
  const end = (text.codePointAt(limit - 1) ?? 0) > 0xFF_FF ? limit - 1 : limit
  return `${text.slice(0, end)}${ellipsis}`
}

// Text from a record, a file, the configuration or the user as the viewer shows it: bounded, without escape sequences,
// with control characters as JSON escapes, and with only characters whose cells blessed and the terminal agree on.
const displayText = (text: string): string => drawableText(visibleText(boundText(text)))

// Trusted blessed markup: the literal parts may hold tags such as {bold}, and every interpolated value is text, which
// shows as it is. Markup is combined with composeMarkup or by concatenation, never by interpolating it here, where its
// tags would show as text.
const markup = (literals: TemplateStringsArray, ...values: readonly string[]): string =>
  String.raw({ raw: literals }, ...values.map(value => escapeMarkup(displayText(value))))

// Combines markup that is trusted already, such as the result of markup or an escaped row, with trusted tags.
const composeMarkup = (literals: TemplateStringsArray, ...values: readonly string[]): string =>
  String.raw({ raw: literals }, ...values)

// The cells that visible text takes on the screen.
const displayWidth = (text: string): number => singleCellText.test(text) ? text.length : cellCount(text)

// Visible text cut to a number of cells, ending with an ellipsis when it was wider.
const cutToWidth = (text: string, width: number): string => {
  if (width <= 0) {
    return ''
  }
  if (displayWidth(text) <= width) {
    return text
  }
  if (singleCellText.test(text)) {
    return `${text.slice(0, width - 1)}${ellipsis}`
  }
  let cut = ''
  let used = 0
  for (const character of text) {
    const cells = displayWidth(character)
    if (used + cells > width - 1) {
      break
    }
    cut += character
    used += cells
  }
  return `${cut}${ellipsis}`
}

// Visible text cut to a number of cells from its start, so that it keeps its end, such as the name of a file.
const cutStartToWidth = (text: string, width: number): string => {
  if (width <= 0) {
    return ''
  }
  if (displayWidth(text) <= width) {
    return text
  }
  // The characters by code point, as for...of gives them; a combining mark takes no cell of its own.
  const characters = text.match(/./gsu) ?? []
  let kept = ''
  let used = 0
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index] ?? ''
    const cells = displayWidth(character)
    if (used + cells > width - 1) {
      break
    }
    kept = `${character}${kept}`
    used += cells
  }
  return `${ellipsis}${kept}`
}

// Visible text followed by spaces up to a number of cells.
const padToWidth = (text: string, width: number): string => `${text}${' '.repeat(Math.max(width - displayWidth(text), 0))}`

// A cell of a row: text, and the color and the weight that trusted tags give it. A color is a blessed color such as
// cyan, #ffa500 or the 256-color number 167.
interface Cell {
  readonly text: string
  readonly color?: string | undefined
  readonly isBold?: boolean | undefined
}

// The widest that a column grows; the last column takes the width that the others leave.
interface Column {
  readonly maximumWidth: number
}

// Escaped text in the cell's color and weight.
const styledText = (text: string, cell: Cell): string => {
  const escaped = escapeMarkup(text)
  const weighted = cell.isBold === true ? composeMarkup`{bold}${escaped}{/bold}` : escaped
  return cell.color === undefined ? weighted : composeMarkup`{${cell.color}-fg}${weighted}{/${cell.color}-fg}`
}

// The widest text of a column.
const naturalWidth = (texts: readonly (readonly string[])[], index: number): number => {
  let natural = 0
  for (const row of texts) {
    natural = Math.max(natural, displayWidth(row[index] ?? ''))
  }
  return natural
}

// Lays rows out in columns of markup: each column but the last as wide as its widest text up to its maximum, the last
// one as wide as the rest, and spacing after each column but the last. The last column keeps up to a third of the
// width; the others take what is left from the left, each with its spacing, so no row is wider than the width. Text
// that does not fit its column ends with an ellipsis.
const layoutRows = (rows: readonly (readonly Cell[])[], columns: readonly Column[], spacing: number, width: number): string[] => {
  const texts = rows.map(row => row.map(cell => displayText(cell.text)))
  const widths: number[] = []
  const gaps: number[] = []
  const total = Math.max(width, 0)
  const reserved = Math.min(naturalWidth(texts, columns.length - 1), Math.floor(total / 3))
  let remaining = total - reserved
  for (const [index, column] of columns.entries()) {
    if (index === columns.length - 1) {
      widths.push(remaining + reserved)
      break
    }
    const columnWidth = Math.min(naturalWidth(texts, index), column.maximumWidth, Math.max(remaining - spacing, 0))
    remaining -= columnWidth
    const gap = Math.min(spacing, remaining)
    remaining -= gap
    widths.push(columnWidth)
    gaps.push(gap)
  }
  return rows.map((row, rowIndex) => widths.map((columnWidth, index) => {
    const text = cutToWidth(texts[rowIndex]?.[index] ?? '', columnWidth)
    return `${styledText(text, row[index] ?? { text: '' })}${' '.repeat(columnWidth - displayWidth(text) + (gaps[index] ?? 0))}`
  }).join(''))
}

export {
  boundText, composeMarkup, cutStartToWidth, cutToWidth, displayText, displayWidth, escapeMarkup, layoutRows, markup,
  maximumDisplayText, padToWidth
}
export type { Cell, Column }
