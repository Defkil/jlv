// Successor of upstream src/widgets/StatusLine.js: the bottom line with the mode, the cursor position, the page
// height, the sort and the filters of the main panel.
import type { Widgets } from 'blessed'
import boundary = require('./blessed-boundary.js')
import formatting = require('./formatting.js')

const { markup } = formatting

interface StatusFilter {
  readonly key: string
  readonly value: unknown
}

// What the status line reads from the main panel, which emits update when it changes.
interface PanelState {
  readonly row: number
  readonly lastRow: number
  readonly mode: string
  readonly sort: string
  readonly pageHeight: number
  readonly filters: readonly StatusFilter[]
  readonly levelFilter: unknown
  readonly on: (event: 'update', listener: () => void) => unknown
}

interface StatusLineOptions {
  readonly screen: Widgets.Screen
  readonly mainPanel: PanelState
}

class StatusLine extends boundary.Box {
  readonly mainPanel: PanelState

  constructor (options: StatusLineOptions) {
    super({
      top: boundary.toCells(options.screen.height) - 1,
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
      this.position.top = boundary.toCells(options.screen.height) - 1
      this.update()
    })
    this.update()
  }

  get row (): number { return this.mainPanel.row + 1 }
  get lastRow (): number { return this.mainPanel.lastRow + 1 }
  get mode (): string { return this.mainPanel.mode.toUpperCase() }
  get sort (): string { return this.mainPanel.sort }
  get pageHeight (): number { return this.mainPanel.pageHeight }
  get filters (): readonly StatusFilter[] {
    const { filters, levelFilter } = this.mainPanel
    return this.mainPanel.levelFilter ? [...filters, { key: 'level', value: levelFilter }] : filters
  }

  log (...messages: unknown[]): void {
    this.screen.log(...messages)
  }

  update (): void {
    const mode = markup`{yellow-bg}{black-fg}{bold} ${this.mode} {/}`
    const line = markup`{bold}${String(this.row)}{/}/{bold}${String(this.lastRow)}{/}`
    const pageSize = markup`| {bold}${String(this.pageHeight)}{/}`
    const sort = this.sort ? markup`| sort: {bold}${this.sort}{/}` : ''
    const filterExpression = this.filters.map(filter => `${filter.key}:${String(filter.value)}`).join(' ')
    const filters = filterExpression ? markup`| filters: {bold}${filterExpression}{/}` : ''
    this.setContent(` ${mode} ${line} ${pageSize} ${sort} ${filters}`)
    this.screen.render()
  }
}

export = StatusLine
