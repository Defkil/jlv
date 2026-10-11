// Successor of upstream src/widgets/StatusLine.js: the bottom line with the mode, the cursor position, the page
// height, the sort and the filters of the main panel, what it reports about the input, and a hint for the key help.
//
// The line fits the width of the screen (plan section 6.3): when it is too long, the hint and then the page height
// go, then the filters, the formats and the configuration file are cut, the widest first, so that the counts of
// skipped lines, warnings and failures stay visible. Its text shows literally, also the names of files and formats.
import type { Widgets } from 'blessed'
import { Box, toCells } from './blessed-boundary.js'
import { composeMarkup, cutStartToWidth, cutToWidth, displayText, displayWidth, escapeMarkup, markup } from './formatting.js'

// A part of the status line after the cursor position: a trusted label, a value whose text may come from the user,
// files or plugins, and how it gives way to a narrow screen. Parts without giveWay stay as they are.
interface StatusPart {
  readonly label?: string
  readonly value: string
  readonly isBold?: boolean
  readonly giveWay?: 'drop' | 'cut' | 'cut-start'
}

// What the status line reads from the main panel, which emits update when it changes.
interface PanelState {
  readonly row: number
  readonly lastRow: number
  readonly mode: string
  readonly sort: string
  readonly pageHeight: number
  // The active filters, each as text.
  readonly filterDescriptions: readonly string[]
  readonly inputStatus: readonly StatusPart[]
  readonly on: (event: 'update', listener: () => void) => unknown
}

interface StatusLineOptions {
  readonly screen: Widgets.Screen
  readonly mainPanel: PanelState
}

// A part that is cut keeps at least this many cells of its value.
const minimumCut = 8

// "| ", the label and the value, as the line shows them.
const partWidth = (part: StatusPart): number => 2 + displayWidth(part.label ?? '') + displayWidth(displayText(part.value))

const isCuttable = (part: StatusPart): boolean => part.giveWay === 'cut' || part.giveWay === 'cut-start'

// The parts that fit into the width, with one space between them. Parts that can go are dropped from the last; then
// the parts that can be cut are cut, the widest first, to eight cells, then to their ellipsis alone, and at last
// dropped too. The other parts always stay; blessed cuts a line that is still too long at the edge of the screen.
const fitParts = (parts: readonly StatusPart[], width: number): StatusPart[] => {
  const fitted = [...parts]
  const overflow = (): number => fitted.reduce((sum, part) => sum + 1 + partWidth(part), 0) - width
  for (let index = fitted.length - 1; index >= 0 && overflow() > 0; index -= 1) {
    if (fitted[index]?.giveWay === 'drop') {
      fitted.splice(index, 1)
    }
  }
  for (const minimum of [minimumCut, 1]) {
    const cuttable = fitted
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => isCuttable(part))
      .toSorted((left, right) => partWidth(right.part) - partWidth(left.part))
    for (const { part, index } of cuttable) {
      const excess = overflow()
      if (excess <= 0) {
        return fitted
      }
      const value = displayText(part.value)
      const cells = Math.min(Math.max(displayWidth(value) - excess, minimum), displayWidth(value))
      fitted[index] = { ...part, value: part.giveWay === 'cut' ? cutToWidth(value, cells) : cutStartToWidth(value, cells) }
    }
  }
  for (let index = fitted.length - 1; index >= 0 && overflow() > 0; index -= 1) {
    if (isCuttable(fitted[index] ?? { value: '' })) {
      fitted.splice(index, 1)
    }
  }
  return fitted
}

const partMarkup = (part: StatusPart): string => {
  const value = escapeMarkup(displayText(part.value))
  return markup`| ${part.label ?? ''}` + (part.isBold === true ? composeMarkup`{bold}${value}{/}` : value)
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

  // The parts after the cursor position, before they give way.
  get parts (): StatusPart[] {
    const { filters, sort } = this
    return [
      { value: String(this.pageHeight), isBold: true, giveWay: 'drop' },
      ...sort ? [{ label: 'sort: ', value: sort, isBold: true }] : [],
      ...filters.length > 0 ? [{ label: 'filters: ', value: filters.join(', '), isBold: true, giveWay: 'cut' } as const] : [],
      ...this.mainPanel.inputStatus,
      { value: '? help', giveWay: 'drop' }
    ]
  }

  update (): void {
    const mode = markup`{yellow-bg}{black-fg}{bold} ${this.mode} {/}`
    const line = markup`{bold}${String(this.row)}{/}/{bold}${String(this.lastRow)}{/}`
    // The line is as wide as the screen. A space starts it, and one more follows the mode and the position each.
    const room = toCells(this.screen.width) - 1 - (displayWidth(this.mode) + 2) - 1 - displayWidth(`${String(this.row)}/${String(this.lastRow)}`)
    const parts = fitParts(this.parts, room).map(part => partMarkup(part))
    this.setContent(` ${[mode, line, ...parts].join(' ')}`)
    this.screen.render()
  }
}

export { StatusLine, fitParts }
export type { PanelState, StatusPart }
