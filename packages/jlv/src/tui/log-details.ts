// Successor of upstream src/widgets/LogDetails.js: a dialog with the data of one record as an indented tree or as
// pretty-printed JSON. j toggles the view; the arrows, PageUp, PageDown, Home and End scroll; Enter and Escape close
// the dialog.
//
// Keys and values are text from the record (plan section 6.3): they show without escape sequences, with control
// characters as JSON escapes and with blessed tags as text. The tree is bounded: values are cut after 4096 characters,
// an object or array shows its first 1000 entries, and below 16 levels a value shows as JSON on one line.
import type { Widgets } from 'blessed'
import { escapeControls } from '../terminal-text.js'
import { drawableText, toCells } from './blessed-boundary.js'
import { boundText, cutToWidth, displayText, displayWidth, escapeMarkup, markup, padToWidth } from './formatting.js'
import type { LogRow } from './log-row.js'
import { TextDialog } from './text-dialog.js'

// The levels of objects and arrays that the tree shows as such; deeper values show as JSON.
const maximumTreeDepth = 16
// The entries of one object or array that the tree shows; the rest are counted.
const maximumEntries = 1000
// Keys are padded to the widest key of their object, up to this many cells.
const maximumKeyPadding = 32
// The longest JSON text that the JSON view shows.
const maximumJsonText = 1024 * 1024

const formatKey = (key: string, padding: number): string =>
  markup`{blue-fg}{bold}${padToWidth(`${displayText(key)}:`, padding + 1)}{/bold}{/blue-fg}`

// A value that is no object or array as text: text as it is, anything else as JavaScript writes it.
const formatValue = (value: unknown): string => {
  const text = typeof value === 'string' ? value : String(value)
  return ` ${escapeMarkup(displayText(text))}`
}

// Upstream prefixed new Array(width).join(' '): one space less than the width, and none for a width of 0.
const indent = (text: string, width: number): string => `${' '.repeat(Math.max(width - 1, 0))}${text}`

// Objects and arrays become nested trees, as lodash.isObject decided before.
const isNested = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function'

const formatEntry = (key: string, value: unknown, padding: number, depth: number): string => {
  if (!isNested(value)) {
    return `${formatKey(key, padding)}${formatValue(value)}`
  }
  // An empty object or array shows as such, not as an empty line that looks like empty text.
  if (Object.keys(value).length === 0) {
    return `${formatKey(key, padding)} ${escapeMarkup(Array.isArray(value) ? '[]' : '{}')}`
  }
  return depth >= maximumTreeDepth
    ? `${formatKey(key, padding)} ${escapeMarkup(displayText(JSON.stringify(value)))}`
    : `${formatKey(key, padding)}${formatObject(value, depth + 1)}`
}

// The entries of an object or an array, one per line below an empty first line.
const formatObject = (object: object, depth = 0): string => {
  const keys = Object.keys(object)
  const shown = keys.slice(0, maximumEntries)
  let padding = 0
  for (const key of shown) {
    const width = displayWidth(displayText(key))
    padding = Math.max(padding, Math.min(width, maximumKeyPadding))
  }
  const entries = shown.map(key => indent(formatEntry(key, Reflect.get(object, key), padding, depth), depth * 2))
  if (keys.length > shown.length) {
    entries.push(indent(markup`… ${String(keys.length - shown.length)} more`, depth * 2))
  }
  return ['', ...entries].join('\n')
}

// Pretty-printed JSON. JSON.stringify escapes most control characters itself; escapeControls takes the rest, line by
// line so that the line breaks between the entries stay, without changing a value.
const jsonText = (data: unknown): string =>
  JSON.stringify(data, undefined, 2).split('\n').map(line => escapeControls(line)).join('\n')

// The JSON view: pretty-printed JSON, bounded, in characters whose cells blessed and the terminal agree on.
const jsonView = (data: unknown): string => {
  const json = boundText(jsonText(data), maximumJsonText)
  return escapeMarkup(drawableText(json))
}

// A part of the title, or a dash for a part that the record lacks.
const titlePart = (text: string | undefined): string => text === undefined || text === '' ? '-' : text

interface LogDetailsOptions {
  readonly screen: Widgets.Screen
}

class LogDetails extends TextDialog {
  json = false
  // The data of the record; display() sets it before update() runs.
  entryData!: LogRow['data']

  constructor (options: LogDetailsOptions) {
    super({ screen: options.screen, closingKeys: ['enter', 'escape'] })
  }

  override handleDialogKey (_character: string | undefined, key: Widgets.Events.IKeyEventArg): boolean {
    if (key.name !== 'j') {
      return false
    }
    this.json = !this.json
    this.update()
    return true
  }

  // The label names the record's timestamp, level and message, cut to the width of the dialog: blessed would wrap a
  // wider label onto the first line of the data.
  display (entry: Pick<LogRow, 'timestamp' | 'level' | 'message' | 'data'>): void {
    const title = `${titlePart(entry.timestamp)} - ${titlePart(entry.level)} - ${titlePart(entry.message)}`
    this.setLabel(markup`{bold} ${cutToWidth(displayText(title), toCells(this.width) - 6)} {/}`)
    this.entryData = entry.data
    this.update()
  }

  update (): void {
    const content = this.json ? jsonView(this.entryData) : formatObject(this.entryData)
    this.showContent(content)
  }
}

export { LogDetails }
