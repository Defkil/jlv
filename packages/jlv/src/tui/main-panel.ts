// Successor of upstream src/widgets/MainPanel.js: the records with the cursor, paging, search, sorting, filters and
// the dialogs that change them. The records come from the bounded store through a record view, which orders them
// once per revision; the panel normalizes only the rows it shows. It keeps upstream's keys and sorts levels by their
// normalized severity.
//
// The filters add up (plan section 6.3, upstream issue #19): the level of l, the clauses that f adds, a profile of the
// configuration and the predicates of plugins all apply together, starting with those of the command line. f opens a
// manager that adds and removes them and chooses profiles and predicates.
import { isDeepStrictEqual } from 'node:util'
import type { Widgets } from 'blessed'
import type { FieldPath, FilterClause, FilterGroup, LogLevel } from '../api.js'
import { fieldReader, parsePath } from '../field-path.js'
import {
  describeClause, describeFilter, emptyFilter, isFilterEmpty, recordTest, type NamedPredicate, type PredicateFailure,
  type RecordFilter
} from '../filters.js'
import { isLogLevel, levelCode, logLevels } from '../record.js'
import { BaseWidget } from './base-widget.js'
import { correlationColor } from './correlation-colors.js'
import {
  ask, createElement, createPrompt, createQuestion, destroyElement, readInput, setContentWrapping, toCells
} from './blessed-boundary.js'
import {
  composeMarkup, cutStartToWidth, displayText, displayWidth, layoutRows, markup, type Cell, type Column
} from './formatting.js'
import { KeyHelp } from './key-help.js'
import { LogDetails } from './log-details.js'
import type { LogRow } from './log-row.js'
import { Picker } from './picker.js'
import type { RecordView, ViewOrder, ViewQuery } from './record-view.js'
import type { StatusPart } from './status-line.js'

type PanelMode = 'normal' | 'sort' | 'filter' | 'search' | 'GOTO'

// The item that a picker reports, and its position; both are undefined when the picker closed without a choice.
type PickerCallback = (error: unknown, value: string | undefined, index: number | undefined) => void

// An item of the filter manager and what choosing it does.
interface FilterChoice {
  readonly label: string
  readonly choose: () => void
}

// How far the input has come: whether records still arrive, the records skipped and the warnings so far, the inputs
// that could not be read to their end, the formats of the inputs, and whether a record had a correlation identifier.
interface InputProgress {
  readonly activity: 'loading' | 'live' | 'done'
  readonly skipped: number
  readonly warnings: number
  readonly failed: number
  readonly formats: ReadonlySet<string>
  readonly hasCorrelation: boolean
}

interface MainPanelOptions {
  readonly screen: Widgets.Screen
  readonly view: RecordView
  // What the border label names: the file, or the inputs.
  readonly label: string
  readonly progress?: InputProgress
  // The configuration file that the run read, for the status line.
  readonly configuration?: string | undefined
  // The filter of the command line: the level, clauses, a profile and predicates.
  readonly filter?: RecordFilter | undefined
  // The profiles of the configuration, which the filter manager offers.
  readonly profiles?: Readonly<Record<string, FilterGroup>> | undefined
  // The predicates of the loaded plugins, which the filter manager offers.
  readonly predicates?: readonly NamedPredicate[] | undefined
  // Called when a predicate throws; the panel leaves the record out.
  readonly onPredicateFailure?: PredicateFailure | undefined
  // The initial order; -timestamp without one.
  readonly sort?: string | undefined
  readonly currentPage?: number
  readonly initialRow?: number
  readonly colSpacing?: number
}

const entryFields: ReadonlySet<string> = new Set(['timestamp', 'level', 'message'])

// The orders that the sort picker offers.
const sortFields: readonly string[] = [...entryFields, 'arrival']

// The levels that the level picker offers: all, then the levels in their order of severity.
const levelChoices: readonly string[] = ['all', ...logLevels]

// The colors and weights of the normalized levels; trace, fatal and unknown keep the default color.
const levelStyles: ReadonlyMap<LogLevel, Omit<Cell, 'text'>> = new Map([
  ['debug', { color: 'cyan' }],
  ['info', { color: '#ffff94', isBold: true }],
  ['warn', { color: '#ffa500' }],
  ['error', { color: 'red' }]
])

// The columns of a row: the timestamp, the level, the correlation identifier when the input has them, a mark for a
// record with details, and the message, which takes the rest of the width.
const rowColumns: readonly Column[] = [
  { maximumWidth: 32 }, { maximumWidth: 12 }, { maximumWidth: 1 }, { maximumWidth: 0 }
]
const correlatedColumns: readonly Column[] = [
  { maximumWidth: 32 }, { maximumWidth: 12 }, { maximumWidth: 16 }, { maximumWidth: 1 }, { maximumWidth: 0 }
]

// A record without data counts as empty, as lodash.isEmpty did for the objects that readLog creates.
const hasData = (data: unknown): boolean => typeof data === 'object' && data !== null && Object.keys(data).length > 0

// The cell of a correlation identifier, in the identifier's color.
const correlationCell = (identifier: string | undefined): Cell =>
  identifier === undefined ? { text: '' } : { text: identifier, color: correlationColor(identifier) }

// The cells of a row in the order of the columns.
const rowCells = (row: LogRow, isCorrelated: boolean): Cell[] => [
  { text: row.timestamp ?? '' },
  { text: row.level ?? '', ...levelStyles.get(row.record.level) },
  ...isCorrelated ? [correlationCell(row.record.correlationIdentifier)] : [],
  { text: hasData(row.data) ? '*' : ' ' },
  { text: row.message }
]

// The parts of a record that the Filter by picker offers, and the fields they filter; other takes the path of an
// original field.
const filterFields: ReadonlyMap<string, FieldPath> = new Map([
  ['timestamp', ['timestamp']],
  ['message', ['message']],
  ['correlation identifier', ['correlationIdentifier']]
])

// Without a listener, a predicate that throws only leaves its record out.
const ignorePredicateFailure: PredicateFailure = () => {}

class MainPanel extends BaseWidget {
  // The query of the current query revision, with its compiled filter.
  #query: ViewQuery | undefined
  currentPage: number
  initialRow: number
  colSpacing: number
  row: number
  rows: LogRow[]
  lastSearchTerm: string | undefined
  // The filter that applies: the level, the clauses, a profile and predicates.
  filter: RecordFilter
  readonly profiles: Readonly<Record<string, FilterGroup>>
  readonly predicates: readonly NamedPredicate[]
  readonly onPredicateFailure: PredicateFailure
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
    this.row = 0
    this.rows = []
    this.lastSearchTerm = undefined
    this.filter = options.filter ?? emptyFilter
    this.profiles = options.profiles ?? {}
    this.predicates = options.predicates ?? []
    this.onPredicateFailure = options.onPredicateFailure ?? ignorePredicateFailure
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
    // Every row fits the panel, so blessed never needs to wrap one; a row that it wrapped would push the others down.
    setContentWrapping(this.rowsElement, false)

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

  // The order in which the view shows the records, and its filter, computed once per query revision. The filter looks
  // at the store's level of a record first and reads the record only for the other parts.
  get query (): ViewQuery {
    if (this.#query?.revision === this.queryRevision) {
      return this.#query
    }
    const { view } = this
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
        const read = fieldReader(key)
        order = { kind: 'field', isDescending, read: sequence => read(view.record(sequence)) }
      }
    }
    const level = this.filter.level === undefined ? undefined : levelCode(this.filter.level)
    const test = recordTest(this.filter, this.onPredicateFailure)
    const isKept = level === undefined && test === undefined
      ? undefined
      : (sequence: number) => (level === undefined || view.store.levelAt(sequence) === level) && (test?.(view.record(sequence)) ?? true)
    this.#query = { revision: this.queryRevision, order, isKept }
    return this.#query
  }

  // The active filters as the status line shows them.
  get filterDescriptions (): readonly string[] {
    return describeFilter(this.filter)
  }

  // The records arrive at one end of the order: the end for arrival and time in ascending order, the start
  // otherwise. A cursor there follows the newest records.
  get isNewestLast (): boolean {
    return !this.sort.startsWith('-') && (this.sortKey === 'arrival' || this.sortKey === 'timestamp')
  }

  // The sequences of the visible records in order. When only the records changed, a cursor at the end where the
  // records arrive stays there, and any other cursor stays on its record while that record is visible; an evicted
  // record leaves the cursor on its row. When the sort or the filters changed, the cursor stays on its record in its
  // screen row, or starts at the first record when the filters left its record out.
  get order (): readonly number[] {
    const { query } = this
    if (!this.view.isStale(query)) {
      return this.shownOrder
    }
    const previous = this.shownOrder
    const isDataChange = this.shownQueryRevision === this.queryRevision
    const isFollowing = isDataChange && (previous.length === 0 || this.row === (this.isNewestLast ? previous.length - 1 : 0))
    const selected = previous[this.row]
    const offset = this.row - this.initialRow
    const order = this.view.order(query)
    this.shownOrder = order
    this.shownQueryRevision = this.queryRevision
    if (isFollowing) {
      this.row = this.isNewestLast ? Math.max(order.length - 1, 0) : 0
      this.initialRow = this.isNewestLast ? this.row - this.pageHeight : 0
      return order
    }
    const row = selected === undefined ? -1 : order.indexOf(selected)
    if (row !== -1) {
      this.row = row
      this.initialRow = row - offset
    } else if (!isDataChange) {
      this.row = 0
      this.initialRow = 0
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
  // skipped, the warnings and how many inputs failed. The names of formats and of the file are cut on a narrow screen,
  // the counts never.
  get inputStatus (): StatusPart[] {
    const { store } = this.view
    const { progress } = this
    const parts: StatusPart[] = []
    if (progress !== undefined && progress.activity !== 'done') {
      parts.push({ value: progress.activity })
    }
    const formats = [...progress?.formats ?? []].filter(format => format !== 'jsonl')
    if (formats.length > 0) {
      parts.push({ label: 'format: ', value: formats.join(', '), giveWay: 'cut' })
    }
    if (this.configuration !== undefined) {
      parts.push({ label: 'config: ', value: this.configuration, giveWay: 'cut-start' })
    }
    if (store.evicted > 0) {
      parts.push({ value: `kept ${String(store.retained)} of ${String(store.seen)}` })
    }
    if (progress !== undefined && progress.skipped > 0) {
      parts.push({ value: `${String(progress.skipped)} skipped` })
    }
    if (progress !== undefined && progress.warnings > 0) {
      parts.push({ value: `${String(progress.warnings)} ${progress.warnings === 1 ? 'warning' : 'warnings'}` })
    }
    if (progress !== undefined && progress.failed > 0) {
      parts.push({ value: `${String(progress.failed)} failed` })
    }
    return parts
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
      this.openSearch()
      return
    }
    if (character === '?') {
      // Upstream's undocumented ? searched again with the last term; n does that.
      new KeyHelp(this.screen).showKeys()
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
      this.openFilterManager()
      return
    }
    if (character === 'c') {
      this.filterByCorrelation()
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
      // all clears the level only; the other filters stay.
      if (level === 'all') {
        this.setFilter({ ...this.filter, level: undefined })
        return
      }
      if (isLogLevel(level)) {
        this.setFilter({ ...this.filter, level })
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

  // The filter manager: add a filter, remove one of the active ones, choose a profile or a predicate, or clear all.
  openFilterManager (): void {
    this.setMode('filter')
    const choices = this.filterChoices
    this.openPicker('Filters', choices.map(choice => choice.label), (_error, _label, index) => {
      const choice = index === undefined ? undefined : choices[index]
      if (choice === undefined) {
        this.resetMode()
        return
      }
      choice.choose()
    })
  }

  // The items of the filter manager.
  get filterChoices (): FilterChoice[] {
    const { filter } = this
    const choices: FilterChoice[] = [{ label: 'add a filter', choose: () => { this.openFilter() } }]
    if (filter.level !== undefined) {
      choices.push({ label: `remove level=${filter.level}`, choose: () => { this.setFilter({ ...filter, level: undefined }) } })
    }
    for (const [index, clause] of filter.clauses.entries()) {
      choices.push({
        label: `remove ${describeClause(clause)}`,
        choose: () => { this.setFilter({ ...filter, clauses: filter.clauses.toSpliced(index, 1) }) }
      })
    }
    for (const [name, group] of Object.entries(this.profiles)) {
      const isActive = filter.profile?.name === name
      choices.push({
        label: isActive ? `remove profile ${name}` : `profile ${name}`,
        choose: () => { this.setFilter({ ...filter, profile: isActive ? undefined : { name, group } }) }
      })
    }
    for (const predicate of this.predicates) {
      const isActive = filter.predicates.some(active => active.name === predicate.name)
      choices.push({
        label: isActive ? `remove predicate ${predicate.name}` : `predicate ${predicate.name}`,
        choose: () => {
          const predicates = isActive ? filter.predicates.filter(active => active.name !== predicate.name) : [...filter.predicates, predicate]
          this.setFilter({ ...filter, predicates })
        }
      })
    }
    if (!isFilterEmpty(filter)) {
      choices.push({ label: 'clear all filters', choose: () => { this.clearFilters() } })
    }
    return choices
  }

  // Adds a filter on a part of the record, the level, or an original field.
  openFilter (): void {
    this.setMode('filter')
    const fields = ['timestamp', 'level', 'message', 'correlation identifier', 'other']
    this.openPicker('Filter by', fields, (error, field) => {
      if (error || !field) {
        this.resetMode()
        return
      }
      if (field === 'level') {
        this.openLevelFilter()
        return
      }
      const path = filterFields.get(field)
      if (path === undefined) {
        this.openCustomFilter()
        return
      }
      this.openFilterTerm(field, path)
    })
  }

  // Asks for an original field in lodash's path grammar, as upstream did, with the text after a colon: user.name:ann.
  openCustomFilter (): void {
    this.prompt('Field to filter:', '', field => {
      if (field.includes(':')) {
        const separator = field.indexOf(':')
        const key = field.slice(0, separator)
        const value = field.slice(separator + 1)
        this.addClause({ field: ['fields', ...parsePath(key)], operator: 'contains', value })
        return
      }
      this.openFilterTerm(field, ['fields', ...parsePath(field)])
    })
  }

  openFilterTerm (name: string, field: FieldPath): void {
    this.prompt(`Filter ${name} by:`, '', value => {
      this.addClause({ field, operator: 'contains', value })
    })
  }

  setSort (sort: string): void {
    this.sort = sort
    this.setQueryChanged()
    this.renderLines()
  }

  // Applies another filter; the cursor stays on its record while the filter keeps it (see order).
  setFilter (filter: RecordFilter): void {
    this.filter = filter
    this.setQueryChanged()
    this.renderLines()
  }

  // Shows only the records with the correlation identifier of the selected record, upstream issue #15; for a record
  // with that filter active, shows all records again. The cursor stays on the record.
  filterByCorrelation (): void {
    const identifier = this.entryAt(this.row)?.record.correlationIdentifier
    if (identifier === undefined) {
      this.message('The record has no correlation identifier to filter by')
      return
    }
    const clause: FilterClause = { field: ['correlationIdentifier'], operator: 'equals', value: identifier }
    const { clauses } = this.filter
    const others = clauses.filter(active => !isDeepStrictEqual(active, clause))
    this.setFilter({ ...this.filter, clauses: others.length === clauses.length ? [...clauses, clause] : others })
  }

  // Adds a clause to the others, unless the same clause applies already.
  addClause (clause: FilterClause): void {
    const { clauses } = this.filter
    this.setFilter({ ...this.filter, clauses: clauses.some(active => isDeepStrictEqual(active, clause)) ? clauses : [...clauses, clause] })
  }

  clearFilters (): void {
    this.setFilter(emptyFilter)
  }

  openPicker (label: string, items: readonly string[], callback: PickerCallback): void {
    const picker = new Picker(this, { label, items, keySelect: true })
    picker.on('select', (_error: unknown, value: string | undefined, index: number | undefined) => {
      callback(undefined, value, index)
    })
    picker.setCurrent()
  }

  // Asks for text and calls back only with a non-empty answer; an empty answer renders the panel again. The question
  // is text, which may quote the user's input.
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

    readInput(inputDialog, markup`${text}`, value || '', (error, input) => {
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

  // Asks for a new search term; n searches with the last one again.
  openSearch (): void {
    this.setMode('search')
    this.lastSearchTerm = undefined
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

  // Shows text, which may quote the user's input, until it is confirmed.
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

    ask(question, markup`${text}`, (_error, isAccepted) => {
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
    this.row = this.initialRow + Math.floor(this.pageHeight / 2)
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
    const name = displayText(this.sourceLabel)
    let label = name
    if (displayWidth(name) > room) {
      label = room > 1 ? cutStartToWidth(name, room) : ''
    }
    return markup`[{bold} ${label} {/}] [{bold} ${position} {/}]`
  }

  update (shouldNotify = true): void {
    this.setLabel(this.borderLabel)

    // The correlation column shows once a record of the input had an identifier, so that the columns do not move.
    const isCorrelated = this.progress?.hasCorrelation === true || this.rows.some(row => row.record.correlationIdentifier !== undefined)
    const columns = isCorrelated ? correlatedColumns : rowColumns
    // The cursor row is black on white; the level and the identifier keep their colors there.
    const content = layoutRows(this.rows.map(row => rowCells(row, isCorrelated)), columns, this.colSpacing, this.pageWidth - 1)
      .map((row, index) => index === this.relativeRow ? composeMarkup`{white-bg}{black-fg}${row}{/}` : row)
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
