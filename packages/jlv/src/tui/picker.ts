// Successor of upstream src/widgets/Picker.js: a list dialog that emits select with the chosen item, or with
// undefined when it is closed with Escape.
import type { Widgets } from 'blessed'
import { BaseWidget } from './base-widget.js'
import { createList, destroyElement, toCells } from './blessed-boundary.js'
import { cutToWidth, displayText, markup } from './formatting.js'

interface PickerOptions {
  readonly items: readonly string[]
  readonly label?: string
  // Chooses the first item that starts with a typed lowercase letter.
  readonly keySelect?: boolean
}

class Picker extends BaseWidget {
  items: readonly string[]
  label: string
  keySelect: boolean
  // Created by update(), which the constructor calls.
  list!: Widgets.ListElement

  constructor (parent: Widgets.Node, options: PickerOptions) {
    super({
      ...options,
      parent,
      top: 'center',
      left: 'center',
      width: 'shrink',
      height: 'shrink',
      shadow: true,
      padding: 1,
      style: {
        border: {
          fg: 'red'
        },
        header: {
          fg: 'blue',
          bold: true
        },
        cell: {
          fg: 'magenta',
          selected: {
            bg: 'blue'
          }
        }
      }
    })
    this.items = options.items
    this.label = options.label || 'Select item'
    this.keySelect = !!options.keySelect
    this.update()
  }

  update (): void {
    this.setLabel(markup`{bold} ${this.label} {/}`)
    this.list = createList({
      screen: this.screen,
      interactive: true,
      keys: true,
      style: {
        selected: {
          bg: 'white',
          fg: 'black',
          bold: true
        }
      }
    })
    this.list.on('focus', () => { this.log('focus') })
    this.list.on('blur', () => { this.log('blur') })
    this.list.on('keypress', this.handleKeyPressed.bind(this))
    this.list.on('select', this.handleSelected.bind(this))
    // Items may name profiles, fields and values: they show as visible text, which the list does not read as tags, and
    // no wider than the screen allows.
    const width = Math.max(toCells(this.screen.width) - 12, 8)
    this.list.setItems(this.items.map(item => cutToWidth(displayText(item), width)))
    this.append(this.list)
  }

  handleSelected (_item: Widgets.BoxElement, index: number): void {
    this.selected(index)
  }

  // Closes the picker for good, with its list, and reports the chosen item and its position, or undefined for none.
  selected (index: number | undefined): void {
    destroyElement(this)
    this.screen.render()
    this.emit('select', undefined, index === undefined ? undefined : this.items[index], index)
  }

  // blessed passes no character for keys such as the arrows. Like upstream, the check then sees the text
  // "undefined", which no item starts with.
  handleKeyPressed (character: string | undefined, key: Widgets.Events.IKeyEventArg): void {
    if (this.keySelect && /[a-z]/.test(String(character))) {
      const index = this.items.findIndex(candidate => candidate.startsWith(String(character)))
      if (index !== -1) {
        this.log('item', this.items[index])
        this.selected(index)
      }
    }

    if (key.name === 'escape') {
      this.selected(undefined)
    }
  }

  override setCurrent (): this {
    this.list.focus()
    this.screen.render()
    return this
  }
}

export { Picker }
