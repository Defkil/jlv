// Successor of upstream src/widgets/MainPanel.js: the records with the cursor, paging, search, sorting, filters and
// the dialogs that change them. It keeps upstream's behavior, including the defects that the characterization
// records for later phases.
import type { Widgets } from 'blessed'
import lodash from 'lodash'
import { readLog, type LogEntry } from '../log.js'
import { BaseWidget } from './base-widget.js'
import { ask, createElement, createPrompt, createQuestion, readInput, toCells } from './blessed-boundary.js'
import { formatRows, levelColors, markup } from './formatting.js'
import { LogDetails } from './log-details.js'
import { Picker } from './picker.js'

type PanelMode = 'normal' | 'sort' | 'filter' | 'search' | 'GOTO'

// The level filter compares the exact value; a filter with the contains method looks for text, ignoring case.
type Filter =
  | { readonly key: string, readonly value: unknown, readonly method?: undefined }
  | { readonly key: string, readonly value: string, readonly method: 'contains' }

type PickerCallback = (error: unknown, value: string | undefined) => void

interface MainPanelOptions {
  readonly screen: Widgets.Screen
  // The initial level filter. The command line passes any value that minimist parsed.
  readonly level?: unknown
  readonly sort?: string | undefined
  readonly currentPage?: number
  readonly initialRow?: number
  readonly colSpacing?: number
  readonly wrap?: boolean
}

const entryFields: readonly string[] = ['timestamp', 'level', 'message']

// Upstream called levelColors[level](level): a level without a color throws here, and formatRows then shows the raw
// value.
const colorLevel = (level: unknown): string => {
  const colored = levelColors[String(level)]?.(String(level))
  if (colored === undefined) {
    throw new TypeError(`The level ${String(level)} has no color.`)
  }
  return colored
}

const isKeptByFilter = (line: LogEntry, filter: Filter): boolean => {
  const key = entryFields.includes(filter.key) ? filter.key : `data.${filter.key}`
  const value: unknown = lodash.get(line, key)
  if (!value) {
    return false
  }
  return filter.method === undefined
    ? value === filter.value
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- like upstream, an object field is searched as [object Object]
    : String(value).toLowerCase().includes(filter.value.toLowerCase())
}

// Upstream reduces over the filters but ignores the accumulator: every filter runs, and only the last one decides
// (upstream issue #19).
const isKeptByLastFilter = (line: LogEntry, filters: readonly Filter[]): boolean => {
  let isKept = true
  for (const filter of filters) {
    isKept = isKeptByFilter(line, filter)
  }
  return isKept
}

class MainPanel extends BaseWidget {
  currentPage: number
  initialRow: number
  colSpacing: number
  wrap: boolean
  row: number
  rows: LogEntry[]
  lastSearchTerm: string | undefined
  levelFilter: unknown
  filters: Filter[]
  sort: string
  mode: PanelMode
  updated: boolean
  file: string | undefined
  rawLines: LogEntry[] | undefined
  linesCache: LogEntry[] = []

  constructor (options: MainPanelOptions) {
    super({ top: '0', height: '99%', handleKeys: true, ...options })

    this.currentPage = options.currentPage || 1
    this.initialRow = options.initialRow || 0
    this.colSpacing = options.colSpacing || 2
    this.wrap = options.wrap || true
    this.row = 0
    this.rows = []
    this.lastSearchTerm = undefined
    this.levelFilter = options.level
    this.filters = []
    this.sort = options.sort || '-timestamp'
    this.mode = 'normal'
    this.updated = true

    this.log('pageWidth', this.pageWidth)
    this.on('resize', () => {
      this.screen.render()
      this.fixCursor()
      this.renderLines()
    })
    this.renderLines()
  }

  get pageHeight (): number { return toCells(this.height) - 3 }
  get pageWidth (): number { return toCells(this.width) - 2 - 2 }

  loadFile (file: string): void {
    this.file = file
    this.rawLines = readLog(file)
    this.log('loaded', this.lines.length)
    this.renderLines()
  }

  get lastRow (): number {
    return this.lines.length - 1
  }

  get lines (): LogEntry[] {
    if (this.updated) {
      this.linesCache = this.calcLines()
      this.updated = false
    }
    return this.linesCache
  }

  calcLines (): LogEntry[] {
    if (!this.rawLines) {
      return []
    }

    this.log('calcLines', this.sort, this.filters, this.levelFilter)

    const sort = (lines: LogEntry[]): LogEntry[] => {
      if (!this.sort) {
        return lines
      }

      const sorted = lodash.sortBy(lines, this.sortKey)
      return this.sort.startsWith('-') ? lodash.reverse(sorted) : sorted
    }

    const filters = structuredClone(this.filters)
    if (this.levelFilter) {
      filters.push({ key: 'level', value: this.levelFilter })
    }

    if (filters.length === 0) {
      return sort(this.rawLines)
    }

    this.log('filters', filters)

    return sort(this.rawLines.filter(line => isKeptByLastFilter(line, filters)))
  }

  renderLines (shouldNotify = true): void {
    this.resetMode()
    this.rows = this.lines.slice(this.initialRow, this.initialRow + toCells(this.height) - 2)
    this.update(shouldNotify)
  }

  override handleKeyPress (character: string | undefined, key: Widgets.Events.IKeyEventArg): void {
    this.log('key', character || key.name)

    if (key.name === 'down') {
      this.moveDown()
      return
    }
    if (key.name === 'up') {
      this.moveUp()
      return
    }
    if (key.name === 'w') {
      this.wrap = !this.wrap
      this.update()
      return
    }
    if (key.name === 'pagedown') {
      this.pageDown()
      return
    }
    if (key.name === 'pageup') {
      this.log('pageup triggering...')
      this.pageUp()
      return
    }
    if (key.name === 'enter') {
      this.displayDetails()
      return
    }
    if (character === '0') {
      this.firstPage()
      return
    }
    if (character === '$') {
      this.lastPage()
      return
    }
    if (character === '/') {
      this.openSearch(true)
      return
    }
    if (character === '?') {
      this.openSearch()
      return
    }
    if (character === 'n') {
      this.search()
      return
    }
    if (character === 'l') {
      this.openLevelFilter()
      return
    }
    if (character === 'g') {
      this.openGoToLine()
      return
    }
    if (character === 's') {
      this.openSort()
      return
    }
    if (character === 'f') {
      if (this.filters.length > 0 || this.levelFilter) {
        this.clearFilters()
        return
      }
      this.openFilter()
      return
    }
    if (character === 'q') {
      // eslint-disable-next-line unicorn/no-process-exit -- upstream quits from the panel; phase 5 moves the process lifecycle out of the widgets
      process.exit(0)
    }
    if (character === 'A') {
      this.moveToFirstViewportLine()
      return
    }
    if (character === 'G') {
      this.moveToLastViewportLine()
      return
    }
    if (character === 'C') {
      this.moveToCenterViewportLine()
    }
  }

  openLevelFilter (): void {
    const levels = ['all', 'debug', 'info', 'warn', 'error']
    this.openPicker('Log Level', levels, (error, level) => {
      if (!level || error) {
        return
      }

      this.log('selected', level)
      if (level === 'all') {
        this.clearFilters()
        return
      }
      this.setLevelFilter(level)
    })
  }

  get sortKey (): string {
    return this.sort && this.sort.replace(/^-/, '')
  }

  get sortAsc (): boolean {
    return !this.sort.startsWith('-')
  }

  openSort (): void {
    this.setMode('sort')
    this.openPicker('Sort by', entryFields, (error, sort) => {
      if (!sort) {
        this.resetMode()
        return
      }
      if (error) {
        return
      }
      if (this.sortKey === sort && this.sortAsc) {
        this.setSort(`-${sort}`)
        return
      }
      this.setSort(sort)
    })
  }

  setUpdated (): void {
    this.updated = true
    this.emit('update')
  }

  setMode (mode: PanelMode): void {
    this.mode = mode
    this.emit('update')
  }

  resetMode (): void {
    this.setMode('normal')
  }

  openFilter (): void {
    this.setMode('filter')
    const fields = ['timestamp', 'level', 'message', 'other']
    this.openPicker('Filter by', fields, (error, field) => {
      if (error || !field) {
        this.resetMode()
        return
      }
      if (field === 'level') {
        this.openLevelFilter()
        return
      }
      if (field === 'other') {
        this.openCustomFilter()
        return
      }
      this.openFilterTerm(field)
    })
  }

  openCustomFilter (): void {
    this.prompt('Field to filter:', '', field => {
      if (!field) {
        this.resetMode()
        return
      }
      if (field.includes(':')) {
        // Like upstream, text after a second colon is dropped.
        const [key = '', value = ''] = field.split(':', 2)
        this.setFilter(key, value, 'contains')
        return
      }
      this.openFilterTerm(field)
    })
  }

  openFilterTerm (field: string): void {
    this.prompt(`Filter ${field} by:`, '', value => {
      if (!value) {
        this.resetMode()
        return
      }
      this.setFilter(field, value, 'contains')
    })
  }

  setSort (sort: string): void {
    this.sort = sort
    this.renderLines()
  }

  setLevelFilter (level: string): void {
    this.levelFilter = level
    this.filterChanged()
  }

  filterChanged (): void {
    this.row = 0
    this.initialRow = 0
    this.setUpdated()
    this.renderLines()
  }

  setFilter (key: string, value: string, method: 'contains'): void {
    this.filters = [{ key, value, method }]
    this.filterChanged()
  }

  clearFilters (): void {
    this.levelFilter = undefined
    this.filters = []
    this.filterChanged()
  }

  openPicker (label: string, items: readonly string[], callback: PickerCallback): void {
    const picker = new Picker(this, { label, items, keySelect: true })
    picker.on('select', (_error: unknown, value: string | undefined) => {
      callback(undefined, value)
    })
    picker.setCurrent()
  }

  // Asks for text and calls back only with a non-empty answer; an empty answer renders the panel again.
  prompt (text: string, value: string | undefined, callback: (input: string) => void): void {
    const inputDialog = createPrompt({
      parent: this,
      border: 'line',
      height: 'shrink',
      width: 'half',
      top: 'center',
      left: 'center',
      label: ' {blue-fg}Prompt{/blue-fg} ',
      tags: true,
      keys: true,
      vi: true,
      padding: 1
    })

    readInput(inputDialog, text, value || '', (error, input) => {
      if (error) {
        return
      }
      if (input) {
        callback(input)
      } else {
        this.renderLines()
      }
    })
  }

  openSearch (shouldClear = false): void {
    this.setMode('search')
    if (shouldClear) {
      this.lastSearchTerm = undefined
    }
    this.prompt('Search:', this.lastSearchTerm, value => {
      this.search(value)
    })
  }

  openGoToLine (): void {
    this.setMode('GOTO')
    this.prompt('Line:', '', value => {
      // eslint-disable-next-line unicorn/prefer-number-coercion -- go-to-line keeps parseInt's prefix parsing: "12abc" goes to line 12
      this.moveToLine(Number.parseInt(value, 10) - 1)
    })
  }

  searchTerm (term: string, isCaseSensitive: boolean, startRow: number): number {
    const searchTerm = isCaseSensitive ? term : term.toLowerCase()
    return this.lines.findIndex((entry, index) => {
      if (index < startRow) {
        return false
      }
      const match = isCaseSensitive
        ? `${String(entry.timestamp)} ${String(entry.message)}`
        : `${String(entry.timestamp)} ${String(entry.message)}`.toLowerCase()
      return match.includes(searchTerm)
    })
  }

  message (text: string): void {
    const question = createQuestion({
      parent: this,
      border: 'line',
      height: 'shrink',
      width: 'half',
      top: 'center',
      left: 'center',
      label: ' {blue-fg}Message{/blue-fg} ',
      tags: true,
      keys: true,
      hidden: true,
      vi: true,
      padding: 1
    })

    ask(question, text, (_error, isAccepted) => {
      this.log('value', isAccepted)
      this.renderLines()
    })
  }

  search (term: string | undefined = this.lastSearchTerm): void {
    if (!term) {
      this.message('No previous search')
      return
    }
    this.lastSearchTerm = term
    const position = this.searchTerm(term, false, this.row + 1)
    if (position > -1) {
      this.moveToLine(position)
    } else {
      this.message(`No matches for '${term}'`)
    }
  }

  moveToLine (line: number): void {
    this.row = line
    this.initialRow = line
    this.renderLines()
  }

  isOutsideViewPort (): boolean {
    return this.row > this.initialRow + this.pageHeight
  }

  fixCursor (): void {
    if (this.isOutsideViewPort()) {
      this.initialRow = this.row - this.pageHeight
    }
  }

  moveToFirstViewportLine (): void {
    this.row = this.initialRow
    this.renderLines()
  }

  moveToCenterViewportLine (): void {
    // Upstream truncated with parseInt. The sum is a whole number (or NaN after an invalid line number), so its
    // half truncates to the same row with Math.trunc.
    this.row = Math.trunc((this.initialRow + this.pageHeight) / 2)
    this.renderLines()
  }

  moveToLastViewportLine (): void {
    this.row = this.initialRow + this.pageHeight
    this.renderLines()
  }

  moveUp (): void {
    this.row = Math.max(0, this.row - 1)
    const isOutside = this.row < this.initialRow
    if (isOutside) {
      this.initialRow = this.row
    }
    this.renderLines(isOutside)
  }

  moveDown (): void {
    this.row = Math.min(this.lastRow, this.row + 1)
    const isOutside = this.row > this.lastVisibleLine
    if (isOutside) {
      this.initialRow += 1
    }
    this.renderLines(isOutside)
  }

  firstPage (): void {
    this.row = 0
    this.initialRow = 0
    this.renderLines()
  }

  lastPage (): void {
    this.row = this.lastRow
    this.initialRow = this.row - this.pageHeight
    this.renderLines()
  }

  pageDown (): void {
    const relativeRow = this.relativeRow
    this.row = Math.min(this.lastRow, this.row + this.pageHeight)
    this.initialRow = this.row - relativeRow
    this.renderLines()
  }

  pageUp (): void {
    if (this.row < this.pageHeight) {
      return
    }
    const relativeRow = this.relativeRow
    this.row = Math.max(0, this.row - this.pageHeight)
    this.initialRow = Math.max(0, this.row - relativeRow)
    this.renderLines()
  }

  displayDetails (): void {
    const details = new LogDetails({ screen: this.screen })
    const entry = this.rows[this.relativeRow]
    if (entry === undefined) {
      // Upstream read the fields of the missing record, which threw a TypeError.
      throw new TypeError('There is no record at the cursor.')
    }
    details.display(entry)
  }

  get relativeRow (): number {
    return this.row - this.initialRow
  }

  get lastVisibleLine (): number {
    return this.initialRow + this.pageHeight
  }

  update (shouldNotify = true): void {
    this.setLabel(markup`[{bold} ${String(this.file)} {/}] [{bold} ${String(this.row + 1)}/${String(this.lastRow + 1)} {/}]`)

    const columns = [
      { title: 'Timestamp', key: 'timestamp' },
      { title: 'Level', key: 'level', format: (level: unknown) => colorLevel(level) },
      { title: 'D', key: 'data', length: 1, format: (data: unknown) => lodash.isEmpty(data) ? ' ' : '*' },
      { title: 'Message', key: 'message' }
    ]

    const highlight = (row: string, index: number): string => {
      const [firstLine = ''] = row.split('\n', 1)
      return index === this.relativeRow ? markup`{white-bg}{black-fg}${firstLine}{/}` : firstLine
    }

    const content = formatRows(this.rows, columns, this.colSpacing, this.pageWidth - 1)
      .map((row, index) => highlight(row, index))
      .join('\n')
    const list = createElement({ screen: this.screen, tags: true, content })
    // Upstream PR #13 removes the children while it iterates over them, so every second child stays (see
    // viewer-render-leak.test.ts). Phase 4 replaces this with one persistent row element.
    for (const child of this.children) {
      this.remove(child)
    }
    this.append(list)
    this.screen.render()
    if (shouldNotify) {
      this.setUpdated()
    }
  }
}

export { MainPanel }
