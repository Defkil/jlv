// The key help of the viewer (plan section 6.3): ? shows every key of the main view, the details and the dialogs in a
// dialog that scrolls like the details and closes with Enter, Escape, q or ?. The status line names ? while it has
// room. Upstream had no help, and its undocumented ? opened the search with the last term, which n repeats.
import type { Widgets } from 'blessed'
import { markup, padToWidth } from './formatting.js'
import { TextDialog } from './text-dialog.js'

type KeyRow = readonly [keys: string, action: string]

// The keys and what they do, by where they work.
const keySections: readonly (readonly [title: string, rows: readonly KeyRow[]])[] = [
  ['Records', [
    ['Up, Down', 'move the cursor'],
    ['PageUp, PageDown', 'move by a page'],
    ['0, $', 'go to the first or the last record'],
    ['A, C, G', 'go to the first, the middle or the last row of the page'],
    ['g', 'go to a line'],
    ['Enter', 'show the details of the record'],
    ['/', 'search the timestamps and the messages, ignoring case'],
    ['n', 'search again from the next record'],
    ['s', 'sort by timestamp, level, message or arrival; the same again sorts descending'],
    ['l', 'show one level, or all levels again'],
    ['f', 'add a filter, remove one, choose a profile or a predicate, or clear all'],
    ['c', 'show only the records of the correlation identifier of the record, or all again'],
    ['?', 'show these keys'],
    ['q, Ctrl-C', 'quit']
  ]],
  ['Details', [
    ['j', 'show the data as JSON or as a tree'],
    ['Up, Down', 'scroll by a line'],
    ['PageUp, PageDown', 'scroll by a page, by five with Shift'],
    ['Home, End', 'go to the first or the last line'],
    ['Enter, Escape', 'close']
  ]],
  ['Pickers and prompts', [
    ['Up, Down, Enter', 'choose an item'],
    ['a letter', 'choose the first item that starts with it'],
    ['Escape', 'close without a choice']
  ]],
  ['These keys', [
    ['Up, Down, PageUp, PageDown, Home, End', 'scroll'],
    ['Enter, Escape, q, ?', 'close']
  ]]
]

// The keys take this many cells before their action.
const keyWidth = 18

// The help as trusted markup: a bold title per section, then a line per key.
const keyHelpContent = (): string => keySections.map(([title, rows]) => [
  markup`{bold}${title}{/bold}`,
  ...rows.map(([keys, action]) => markup`  {bold}${padToWidth(keys, keyWidth)}{/bold}  ${action}`)
].join('\n')).join('\n\n')

class KeyHelp extends TextDialog {
  constructor (screen: Widgets.Screen) {
    super({ screen, closingKeys: ['enter', 'escape', 'q', '?'] })
    this.setLabel(markup`{bold} Keys {/}`)
  }

  showKeys (): void {
    this.showContent(keyHelpContent())
  }
}

export { KeyHelp, keyHelpContent, keySections }
