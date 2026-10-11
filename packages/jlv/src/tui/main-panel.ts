// Successor of upstream src/widgets/MainPanel.js: the records with the cursor, paging, search, sorting, filters and
// the dialogs that change them. The records come from the bounded store through a record view, which orders them
// once per revision; the panel normalizes only the rows it shows. It keeps upstream's behavior, including the defects
// that the characterization records for later phases, but filters and sorts levels by their normalized severity.
import type { Widgets } from 'blessed'
import type { LogLevel } from '../api.js'
import { fieldReader, valueAtField } from '../field-path.js'
import { isLogLevel, logLevels } from '../record.js'
import { BaseWidget } from './base-widget.js'
import {
  ask, createElement, createPrompt, createQuestion, destroyElement, readInput, setContentWrapping, toCells
} from './blessed-boundary.js'
import { formatRows, levelColors, markup } from './formatting.js'
import { LogDetails } from './log-details.js'
import type { LogRow } from './log-row.js'
import { Picker } from './picker.js'
import type { RecordView, ViewOrder, ViewQuery } from './record-view.js'

type PanelMode = 'normal' | 'sort' | 'filter' | 'search' | 'GOTO'

// The level filter keeps records of one normalized level, whatever case or alias their raw level had (upstream issue
// #14); a filter with the contains method looks for text, ignoring case.
type Filter =
  | { readonly key: 'level', readonly value: LogLevel, readonly method?: undefined }
  | { readonly key: string, readonly value: string, readonly method: 'contains' }

type PickerCallback = (error: unknown, value: string | undefined) => void

// How far the input has come: whether records still arrive, the records skipped and the warnings so far, the inputs
// that could not be read to their end, and the formats of the inputs.
interface InputProgress {
  readonly activity: 'loading' | 'live' | 'done'
  readonly skipped: number
  readonly warnings: number
  readonly failed: number
  readonly formats: ReadonlySet<string>
}

interface MainPanelOptions {
  readonly screen: Widgets.Screen
  readonly view: RecordView
  // What the border label names: the file, or the inputs.
  readonly label: string
  readonly progress?: InputProgress
  // The configuration file that the run read, for the status line.
  readonly configuration?: string | undefined
  // The initial level filter.
  readonly level?: LogLevel | undefined
  // The initial order; -timestamp without one.
  readonly sort?: string | undefined
  readonly currentPage?: number
  readonly initialRow?: number
  readonly colSpacing?: number
  // Whether rows longer than the panel continue on the next line; w toggles it. Rows wrap unless this is false.
  readonly wrap?: boolean
}

const entryFields: ReadonlySet<string> = new Set(['timestamp', 'level', 'message'])

// The orders that the sort picker offers.
const sortFields: readonly string[] = [...entryFields, 'arrival']

// The levels that the level picker offers: all, then the levels in their order of severity.
const levelChoices: readonly string[] = ['all', ...logLevels]

// Upstream called levelColors[level](level): a level without a color throws here, and formatRows then shows the raw
// value.
const colorLevel = (level: unknown): string => {
  const colored = levelColors[String(level)]?.(String(level))
  if (colored === undefined) {
    throw new TypeError(`The level ${String(level)} has no color.`)
  }
  return colored
}

// A record without data counts as empty, as lodash.isEmpty did for the objects that readLog creates.
const hasData = (data: unknown): boolean => typeof data === 'object' && data !== null && Object.keys(data).length > 0

const isKeptByFilter = (line: LogRow, filter: Filter): boolean => {
  if (filter.method === undefined) {
    return line.record.level === filter.value
  }
  const key = entryFields.has(filter.key) ? filter.key : `data.${filter.key}`
  const value = valueAtField(line, key)
  // Like upstream, an object field is searched as [object Object].
  return Boolean(value) && String(value).toLowerCase().includes(filter.value.toLowerCase())
}

// Upstream reduces over the filters but ignores the accumulator: every filter runs, and only the last one decides
// (upstream issue #19).
const isKeptByLastFilter = (line: LogRow, filters: readonly Filter[]): boolean => {
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
  // Upstream kept this flag in blessed's own Element#wrap of the panel, which has no content, so w changed nothing.
  isWrappingRows: boolean
  row: number
  rows: LogRow[]
  lastSearchTerm: string | undefined
  levelFilter: LogLevel | undefined
  filters: Filter[]
  sort: string
  mode: PanelMode
  readonly view: RecordView
  readonly sourceLabel: string
  readonly progress: InputProgress | undefined
  readonly configuration: string | undefined
  // The sort and the filters change with queryRevision, the records with the store's data revision. The view
  // computes the visible order once per pair of revisions, never on cursor moves or renders.
  queryRevision = 0
  // The order shown last and the query revision it belongs to.
  shownOrder: readonly number[] = []
  shownQueryRevision = 0
  // The one element that shows the rows. Every render replaces its content; the panel's other children, the border
  // label and open dialogs, stay (plan section 0.10). The persistent element follows danielannan17/json-log-viewer
  // 8a1aef1.
  readonly rowsElement: Widgets.BoxElement = createElement({ screen: this.screen, tags: true })

  constructor (options: MainPanelOptions) {
    super({ top: '0', height: '99%', handleKeys: true, screen: options.screen })

    this.currentPage = options.currentPage || 1
    this.initialRow = options.initialRow || 0
    this.colSpacing = options.colSpacing || 2
    this.isWrappingRows = options.wrap !== false
    this.row = 0
    this.rows = []
    this.lastSearchTerm = undefined
    this.levelFilter = options.level
    this.filters = []
    this.sort = options.sort || '-timestamp'
    this.mode = 'normal'
    this.view = options.view
    this.sourceLabel = options.label
    this.progress = options.progress
    this.configuration = options.configuration
    this.append(this.rowsElement)
    // blessed places a border label one cell further left when it creates it than when it changes it later. The
    // label is created here, so that every render puts it in the same place; upstream rendered twice before the
    // first screen, once empty and once after reading the file.
    this.setLabel(' ')
    setContentWrapping(this.rowsElement, this.isWrappingRows)

    this.log('pageWidth', this.pageWidth)
    this.on('resize', () => {
      this.screen.render()
      this.fixCursor()
      this.renderLines()
    })
    this.renderLines()
  }

  // The rows after the first one that the viewport shows, and the columns inside the border and the padding. Neither
  // is negative on a tiny terminal.
  get pageHeight (): number { return Math.max(toCells(this.height) - 3, 0) }
  get pageWidth (): number { return Math.max(toCells(this.width) - 2 - 2, 0) }
  // PageUp and PageDown move by the page height, and by at least one record when the viewport shows a single row.
  get pageStep (): number { return Math.max(this.pageHeight, 1) }

  get lastRow (): number {
    return this.order.length - 1
  }

  // How often the view computed the visible order.
  get orderComputations (): number {
    return this.view.computations
  }

  // The order in which the view shows the records, and its filter.
  get query (): ViewQuery {
    const isDescending = this.sort.startsWith('-')
    const key = this.sortKey
    let order: ViewOrder
    switch (key) {
      case 'arrival': {
        order = { kind: 'arrival', isDescending }
        break
      }
      case 'timestamp': {
        order = { kind: 'time', isDescending }
        break
      }
      case 'level': {
        order = { kind: 'level', isDescending }
        break
      }
      default: {
        order = { kind: 'field', isDescending, read: fieldReader(key) }
      }
    }
    const filters: readonly Filter[] = this.levelFilter === undefined
      ? this.filters
      : [...this.filters, { key: 'level', value: this.levelFilter }]
    return {
      revision: this.queryRevision,
      order,
      isKept: filters.length === 0 ? undefined : entry => isKeptByLastFilter(entry, filters)
    }
  }

  // The records arrive at one end of the order: the end for arrival and time in ascending order, the start
  // otherwise. A cursor there follows the newest records.
  get isNewestLast (): boolean {
    return !this.sort.startsWith('-') && (this.sortKey === 'arrival' || this.sortKey === 'timestamp')
  }

  // The sequences of the visible records in order. When only the records changed, a cursor at the end where the
  // records arrive stays there, and any other cursor stays on its record while that record is visible.
  get order (): readonly number[] {
    const { query } = this
    if (!this.view.isStale(query)) {
      return this.shownOrder
    }
    const previous = this.shownOrder
    const isDataChange = this.shownQueryRevision === this.queryRevision
    const isFollowing = previous.length === 0 || this.row === (this.isNewestLast ? previous.length - 1 : 0)
    const selected = previous[this.row]
    const order = this.view.order(query)
    this.shownOrder = order
    this.shownQueryRevision = this.queryRevision
    if (!isDataChange) {
      return order
    }
    const offset = this.row - this.initialRow
    if (isFollowing) {
      this.row = this.isNewestLast ? Math.max(order.length - 1, 0) : 0
      this.initialRow = this.isNewestLast ? this.row - this.pageHeight : 0
    } else if (selected !== undefined) {
      const row = order.indexOf(selected)
      if (row !== -1) {
        this.row = row
        this.initialRow = row - offset
      }
    }
    return order
  }

  // The row of the record at a position of the visible order.
  entryAt (position: number): LogRow | undefined {
    const sequence = this.order[position]
    return sequence === undefined ? undefined : this.view.entry(sequence)
  }

  // What the status line reports about the input: whether records still arrive, the formats other than generic JSON
  // lines, the configuration file, how many records the store keeps of those that arrived, how many records were
  // skipped, the warnings and how many inputs failed.
  get inputStatus (): string {
    const { store } = this.view
    const { progress } = this
    const parts: string[] = []
    if (progress !== undefined && progress.activity !== 'done') {
      parts.push(progress.activity)
    }
    const formats = [...progress?.formats ?? []].filter(format => format !== 'jsonl')
    if (formats.length > 0) {
      parts.push(`format: ${formats.join(', ')}`)
    }
    if (this.configuration !== undefined) {
      parts.push(`config: ${this.configuration}`)
    }
    if (store.evicted > 0) {
      parts.push(`kept ${String(store.retained)} of ${String(store.seen)}`)
    }
    if (progress !== undefined && progress.skipped > 0) {
      parts.push(`${String(progress.skipped)} skipped`)
    }
    if (progress !== undefined && progress.warnings > 0) {
      parts.push(`${String(progress.warnings)} ${progress.warnings === 1 ? 'warning' : 'warnings'}`)
    }
    if (progress !== undefined && progress.failed > 0) {
      parts.push(`${String(progress.failed)} failed`)
    }
    return parts.join(' | ')
  }

  // Shows the records that arrived since the last render, or the end of the input. An open dialog keeps its mode.
  refresh (): void {
    this.clampCursor()
    this.showRows()
    this.update()
  }

  renderLines (shouldNotify = true): void {
    this.clampCursor()
    this.resetMode()
    this.showRows()
    this.update(shouldNotify)
  }

  // Parses the records of the viewport.
  showRows (): void {
    const height = Math.max(toCells(this.height) - 2, 0)
    this.rows = this.order.slice(this.initialRow, this.initialRow + height).map(sequence => this.view.entry(sequence))
  }

  // Keeps the cursor on a record, or on row 0 of an empty view, and inside the viewport, whatever moved it: an empty
  // log, a tiny terminal, a line number past either end or without digits, G on a partial last page or C on a later
  // page.
  clampCursor (): void {
    // The order comes first: computing it after new records may move the cursor along with its record.
    const { lastRow } = this
    const row = Number.isNaN(this.row) ? 0 : this.row
    this.row = Math.min(Math.max(row, 0), Math.max(lastRow, 0))
    const initialRow = Number.isNaN(this.initialRow) ? 0 : this.initialRow
    this.initialRow = Math.min(Math.max(initialRow, this.row - this.pageHeight, 0), this.row)
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
      this.isWrappingRows = !this.isWrappingRows
      setContentWrapping(this.rowsElement, this.isWrappingRows)
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
      if (this.filters.length > 0 || this.levelFilter !== undefined) {
        this.clearFilters()
        return
      }
      this.openFilter()
      return
    }
    if (character === 'q') {
      // The application ends the process; upstream called process.exit here.
      this.emit('quit')
      return
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
    this.openPicker('Log Level', levelChoices, (error, level) => {
      if (!level || error) {
        return
      }

      this.log('selected', level)
      if (level === 'all') {
        this.clearFilters()
        return
      }
      if (isLogLevel(level)) {
        this.setLevelFilter(level)
      }
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
    this.openPicker('Sort by', sortFields, (error, sort) => {
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

  // Tells listeners such as the status line that the panel changed.
  setUpdated (): void {
    this.emit('update')
  }

  // The sort or the filters changed, so the visible order is computed again on its next use.
  setQueryChanged (): void {
    this.queryRevision += 1
    this.setUpdated()
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
    this.setQueryChanged()
    this.renderLines()
  }

  setLevelFilter (level: LogLevel): void {
    this.levelFilter = level
    this.filterChanged()
  }

  filterChanged (): void {
    this.row = 0
    this.initialRow = 0
    this.setQueryChanged()
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
      destroyElement(inputDialog)
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

  // Parses the records from the start row on until one matches.
  searchTerm (term: string, isCaseSensitive: boolean, startRow: number): number {
    const searchTerm = isCaseSensitive ? term : term.toLowerCase()
    const { order } = this
    for (let index = Math.max(startRow, 0); index < order.length; index += 1) {
      const sequence = order[index] ?? 0
      const entry = this.view.entry(sequence)
      const text = `${String(entry.timestamp)} ${entry.message}`
      if ((isCaseSensitive ? text : text.toLowerCase()).includes(searchTerm)) {
        return index
      }
    }
    return -1
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
      destroyElement(question)
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
    this.row = Math.min(this.lastRow, this.row + this.pageStep)
    this.initialRow = this.row - relativeRow
    this.renderLines()
  }

  pageUp (): void {
    const relativeRow = this.relativeRow
    this.row = Math.max(0, this.row - this.pageStep)
    this.initialRow = Math.max(0, this.row - relativeRow)
    this.renderLines()
  }

  displayDetails (): void {
    const entry = this.rows[this.relativeRow]
    // An empty view has no record to show. Upstream read the fields of the missing record there, which threw a
    // TypeError and ended the process.
    if (entry !== undefined) {
      new LogDetails({ screen: this.screen }).display(entry)
    }
  }

  get relativeRow (): number {
    return this.row - this.initialRow
  }

  get lastVisibleLine (): number {
    return this.initialRow + this.pageHeight
  }

  // The border label with the inputs and the cursor position. blessed wraps a label that is wider than the panel onto
  // the first row, so a long name, such as an absolute path, keeps only its end.
  get borderLabel (): string {
    const position = `${String(this.row + 1)}/${String(this.lastRow + 1)}`
    // The label starts three cells in and ends at the padding before the right border; brackets and spaces take nine.
    const room = toCells(this.width) - 5 - 9 - position.length
    const { sourceLabel } = this
    let label = sourceLabel
    if (sourceLabel.length > room) {
      label = room > 1 ? `…${sourceLabel.slice(sourceLabel.length - room + 1)}` : ''
    }
    return markup`[{bold} ${label} {/}] [{bold} ${position} {/}]`
  }

  update (shouldNotify = true): void {
    this.setLabel(this.borderLabel)

    const columns = [
      { title: 'Timestamp', key: 'timestamp' },
      { title: 'Level', key: 'level', format: (level: unknown) => colorLevel(level) },
      { title: 'D', key: 'data', length: 1, format: (data: unknown) => hasData(data) ? '*' : ' ' },
      { title: 'Message', key: 'message' }
    ]

    const highlight = (row: string, index: number): string => {
      const [firstLine = ''] = row.split('\n', 1)
      return index === this.relativeRow ? markup`{white-bg}{black-fg}${firstLine}{/}` : firstLine
    }

    const content = formatRows(this.rows, columns, this.colSpacing, this.pageWidth - 1)
      .map((row, index) => highlight(row, index))
      .join('\n')
    this.rowsElement.setContent(content)
    this.screen.render()
    if (shouldNotify) {
      this.setUpdated()
    }
  }
}

export { MainPanel }
export type { InputProgress, MainPanelOptions }
