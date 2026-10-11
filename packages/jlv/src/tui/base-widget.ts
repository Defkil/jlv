// Successor of upstream src/widgets/BaseWidget.js: a bordered box that attaches itself to the screen.
import type { Widgets } from 'blessed'
import boundary = require('./blessed-boundary.js')

// A widget joins a screen directly or through the screen of a parent element.
type Placement =
  | { readonly screen: Widgets.Screen, readonly parent?: undefined }
  | { readonly parent: Widgets.Node, readonly screen?: undefined }

type BaseWidgetOptions = Widgets.BoxOptions & Placement & {
  // Passes the keys of the widget itself to handleKeyPress.
  readonly handleKeys?: boolean
}

class BaseWidget extends boundary.Box {
  constructor (options: BaseWidgetOptions) {
    super({
      top: 'center',
      left: 'center',
      width: '100%',
      height: '100%',
      tags: true,
      border: { type: 'line' },
      interactive: true,
      padding: { left: 1, right: 1 },
      ...options
    })

    if (options.handleKeys && this.handleKeyPress) {
      this.on('keypress', this.handleKeyPress.bind(this))
    }

    this.screen = options.screen === undefined ? options.parent.screen : options.screen
    this.screen.append(this)
  }

  // blessed passes no character for keys such as the arrows.
  handleKeyPress? (character: string | undefined, key: Widgets.Events.IKeyEventArg): void

  log (...messages: unknown[]): void {
    this.screen.log(...messages)
  }

  setCurrent (): this {
    this.focus()
    this.screen.render()
    return this
  }
}

export = BaseWidget
