// Successor of upstream src/widgets/StatusLine.js: the bottom line with the mode, the cursor position, the page
// height, the sort and the filters of the main panel, and what it reports about the input.
import type { Widgets } from 'blessed'
import { Box, toCells } from './blessed-boundary.js'
import { markup } from './formatting.js'

// What the status line reads from the main panel, which emits update when it changes.
interface PanelState {
  readonly row: number
  readonly lastRow: number
  readonly mode: string
  readonly sort: string
  readonly pageHeight: number
  // The active filters, each as text.
  readonly filterDescriptions: readonly string[]
  readonly inputStatus: string
  readonly on: (event: 'update', listener: () => void) => unknown
}

interface StatusLineOptions {
  readonly screen: Widgets.Screen
  readonly mainPanel: PanelState
}

class StatusLine extends Box {
  readonly mainPanel: PanelState

  constructor (options: StatusLineOptions) {
    super({
      top: Math.max(toCells(options.screen.height) - 1, 0),
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue'
      },
      ...options
    })

    this.mainPanel = options.mainPanel
    this.mainPanel.on('update', this.update.bind(this))
    this.on('resize', () => {
      this.position.top = Math.max(toCells(options.screen.height) - 1, 0)
      this.update()
    })
    this.update()
  }

  get row (): number { return this.mainPanel.row + 1 }
  get lastRow (): number { return this.mainPanel.lastRow + 1 }
  get mode (): string { return this.mainPanel.mode.toUpperCase() }
  get sort (): string { return this.mainPanel.sort }
  get pageHeight (): number { return this.mainPanel.pageHeight }
  get filters (): readonly string[] {
    return this.mainPanel.filterDescriptions
  }

  log (...messages: unknown[]): void {
    this.screen.log(...messages)
  }

  update (): void {
    const mode = markup`{yellow-bg}{black-fg}{bold} ${this.mode} {/}`
    const line = markup`{bold}${String(this.row)}{/}/{bold}${String(this.lastRow)}{/}`
    const pageSize = markup`| {bold}${String(this.pageHeight)}{/}`
    const sort = this.sort ? markup`| sort: {bold}${this.sort}{/}` : ''
    const filterExpression = this.filters.join(', ')
    const filters = filterExpression ? markup`| filters: {bold}${filterExpression}{/}` : ''
    // The input status names formats and the configuration file, which are text of the user and of plugins.
    const { inputStatus } = this.mainPanel
    const input = inputStatus ? markup`| ${inputStatus}` : ''
    this.setContent(` ${[mode, line, pageSize, sort, filters, input].filter(Boolean).join(' ')}`)
    this.screen.render()
  }
}

export { StatusLine }
