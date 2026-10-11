// Successor of upstream src/widgets/LogDetails.js: a dialog with the data of one record as an indented tree or as
// pretty-printed JSON. j toggles the view; Enter and Escape close the dialog.
import type { Widgets } from 'blessed'
import lodash from 'lodash'
import type { LogEntry } from '../log.js'
import { BaseWidget } from './base-widget.js'
import { createElement } from './blessed-boundary.js'
import { markup } from './formatting.js'

const formatKey = (key: string, padding?: number): string => {
  const label = padding ? `${key}:`.padEnd(padding + 1) : `${key}:`
  return markup`{blue-fg}{bold}${label}{/bold}{/blue-fg}`
}

const formatValue = (value: unknown): string => ` ${String(value)}`

// Upstream prefixed new Array(width).join(' '): one space less than the width, and none for a width of 0.
const indent = (text: string, width: number): string => `${' '.repeat(Math.max(width - 1, 0))}${text}`

const formatEntry = (key: string, value: unknown, padding?: number, level = 0): string => {
  const formattedValue = lodash.isObject(value) ? formatObject(value, level + 1) : formatValue(value)
  return `${formatKey(key, padding)}${formattedValue}`
}

const formatObject = (object: object, level = 0): string => {
  const keys = Object.keys(object)
  const padding = Math.max(...keys.map(key => key.length))
  const entries = keys
    .map(key => formatEntry(key, Reflect.get(object, key), padding, level))
    .map(entry => indent(entry, level * 2))
  return ['', ...entries].join('\n')
}

interface LogDetailsOptions {
  readonly screen: Widgets.Screen
}

class LogDetails extends BaseWidget {
  json = false
  // The data of the record; display() sets it before update() runs.
  entryData!: LogEntry['data']
  // The scrollable element with the formatted data, replaced by every update.
  element: Widgets.BoxElement | undefined

  constructor (options: LogDetailsOptions) {
    super({
      ...options,
      width: '90%',
      height: '80%',
      shadow: true,
      handleKeys: true
    })
  }

  override handleKeyPress (_character: string | undefined, key: Widgets.Events.IKeyEventArg): void {
    if (key.name === 'enter' || key.name === 'escape') {
      this.log('detach')
      if (this.element === undefined) {
        // Upstream detached the missing element of a dialog that shows no record yet.
        throw new TypeError('The details dialog shows no record.')
      }
      this.element.detach()
      this.detach()
      this.screen.render()
      return
    }
    if (key.name !== 'j') {
      return
    }
    this.json = !this.json
    this.update()
  }

  display (entry: LogEntry): void {
    this.setLabel(markup`{bold} ${String(entry.timestamp)} - ${String(entry.level)} - ${String(entry.message)} {/}`)
    this.entryData = entry.data
    this.update()
  }

  update (): void {
    if (this.element) {
      this.element.detach()
      this.element = undefined
    }
    const content = this.json
      ? JSON.stringify(this.entryData, undefined, 2)
      : formatObject(this.entryData)
    this.element = createElement({
      screen: this.screen,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'yellow' } },
      tags: true,
      content
    })
    this.element.on('keypress', this.handleKeyPress.bind(this))
    this.element.focus()

    this.append(this.element)
    this.screen.render()
  }
}

export { LogDetails }
