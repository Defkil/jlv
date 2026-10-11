// A dialog with scrollable text, shared by the details of a record and the key help: the arrows scroll by a line,
// PageUp and PageDown by a page, Home and End to the ends, and its closing keys close it for good. Its content is
// trusted markup, which the dialog shows in one scrollable element that every new content replaces.
import type { Widgets } from 'blessed'
import { BaseWidget } from './base-widget.js'
import { createElement, destroyElement, toCells } from './blessed-boundary.js'

interface TextDialogOptions {
  readonly screen: Widgets.Screen
  // The names of the keys that close the dialog, such as escape, or the characters, such as q.
  readonly closingKeys: readonly string[]
}

class TextDialog extends BaseWidget {
  readonly closingKeys: ReadonlySet<string>
  // The scrollable element with the content, replaced by every new content.
  element: Widgets.BoxElement | undefined

  constructor (options: TextDialogOptions) {
    super({
      screen: options.screen,
      width: '90%',
      height: '80%',
      shadow: true,
      handleKeys: true
    })
    this.closingKeys = new Set(options.closingKeys)
  }

  override handleKeyPress (character: string | undefined, key: Widgets.Events.IKeyEventArg): void {
    if (this.closingKeys.has(key.name) || (character !== undefined && this.closingKeys.has(character))) {
      this.close()
      return
    }
    if (!this.handleDialogKey(character, key)) {
      this.scrollByKey(key)
    }
  }

  // A key of the dialog itself; true when the dialog used it.
  handleDialogKey (_character: string | undefined, _key: Widgets.Events.IKeyEventArg): boolean {
    return false
  }

  // Closes the dialog for good, with its element and label.
  close (): void {
    this.log('detach')
    if (this.element === undefined) {
      // Upstream detached the missing element of a dialog that shows no record yet.
      throw new TypeError('The dialog shows no content.')
    }
    destroyElement(this)
    this.screen.render()
  }

  // Home and End jump to the first and the last line. PageUp and PageDown move by the height of the dialog less three
  // lines, at least one line, and five pages at once with Shift.
  scrollByKey (key: Widgets.Events.IKeyEventArg): void {
    const { element } = this
    if (element === undefined) {
      return
    }
    const pageStep = (): number => {
      const pages = key.shift ? 5 : 1
      return Math.max(toCells(this.height) * pages - pages * 3, 1)
    }
    switch (key.name) {
      case 'home': {
        element.scroll(-element.getScrollHeight())
        break
      }
      case 'end': {
        element.scroll(element.getScrollHeight())
        break
      }
      case 'pageup': {
        element.scroll(-pageStep())
        break
      }
      case 'pagedown': {
        element.scroll(pageStep())
        break
      }
      default: {
        return
      }
    }
    this.screen.render()
  }

  // Shows the content, trusted markup, from its first line, and takes the keys.
  showContent (content: string): void {
    if (this.element) {
      destroyElement(this.element)
      this.element = undefined
    }
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

export { TextDialog }
export type { TextDialogOptions }
