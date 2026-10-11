// CSV (plan section 6.2): a header line names the columns, a comma or the configured one-character delimiter separates
// the fields, and double quotes enclose fields with delimiters, quotes ("") or line breaks. Values stay text; there
// are no implicit casts.
//
// csv-parse 7 parses the records. It holds back the last character of each chunk until more data or the end arrives,
// so a followed file would show each row only when the next one is written. The reader therefore frames complete
// records itself, by csv-parse's own quote rules: a quote opens a quoted field only at the start of a field, "" inside
// it is a quote, and a quote closes it only before a delimiter or a line ending; a line feed outside a quoted field
// ends the record. The complete records of a chunk are parsed in one call. A record is bounded by the context's
// maximum size in bytes; an oversized one is dropped up to the next line feed. The framing restarts with each followed
// file, which reads its header again. The delimiter is one ASCII character.
//
// The header must name every column, each once. A row with another number of fields than the header is skipped with a
// diagnostic, as is a row that csv-parse cannot read, such as one with a quote that is not closed at the end of the
// file. The probe claims a source only when its header is valid and has a message column: the mapped one, or message
// or msg.
import { parse } from 'csv-parse/sync'
import type { FormatContext, FormatSample, JsonObject, LinePosition, LogFormat, ParseDiagnostic, ParseEvent } from '../api.js'
import { asJsonObject, normalizeFields, type FieldProfile } from '../record.js'
import { sizeText } from './json-lines.js'

const lineFeed = 0x0A
const carriageReturn = 0x0D
const quote = 0x22
const byteOrderMark: readonly number[] = [0xEF, 0xBB, 0xBF]

// A complete record's bytes without its line ending, or an oversized record, with its lines.
type CsvFrame =
  | { readonly kind: 'record', readonly bytes: Buffer, readonly position: LinePosition }
  | { readonly kind: 'oversized', readonly byteLength: number, readonly position: LinePosition }

// Frames the records of a CSV source by csv-parse's quote rules, bounded in size.
class CsvFramer {
  #pieces: Buffer[] = []
  #pendingLength = 0
  #droppedLength: number | undefined
  // Inside a quoted field; after a quote inside it, which a quote escapes and a delimiter or line ending closes.
  #isQuoted = false
  #isAfterQuote = false
  // At the start of a field, where a quote opens a quoted field.
  #isFieldStart = true
  // The line of the next record's start, and the line feeds inside the pending record.
  #firstLine = 1
  #lineFeeds = 0
  #startBytes: number[] | undefined = []
  readonly maximumBytes: number
  readonly delimiter: number

  constructor (maximumBytes: number, delimiter = ',') {
    this.maximumBytes = maximumBytes
    this.delimiter = delimiter.codePointAt(0) ?? 0x2C
  }

  #withoutByteOrderMark (bytes: Buffer): Buffer {
    const startBytes = this.#startBytes
    if (startBytes === undefined) {
      return bytes
    }
    const earlierLength = startBytes.length
    let index = 0
    while (index < bytes.length && startBytes.length < byteOrderMark.length) {
      const byte = bytes[index] ?? 0
      if (byte !== byteOrderMark[startBytes.length]) {
        this.#startBytes = undefined
        return earlierLength === 0 ? bytes : Buffer.concat([Buffer.from(startBytes.slice(0, earlierLength)), bytes])
      }
      startBytes.push(byte)
      index += 1
    }
    if (startBytes.length === byteOrderMark.length) {
      this.#startBytes = undefined
    }
    return bytes.subarray(index)
  }

  #hold (bytes: Buffer): void {
    if (this.#droppedLength !== undefined) {
      this.#droppedLength += bytes.length
      return
    }
    this.#pendingLength += bytes.length
    if (this.#pendingLength > this.maximumBytes + 1) {
      // Too large: dropped up to the next line feed, whatever the quotes, so that an unclosed quote cannot swallow
      // the rest of the source.
      this.#droppedLength = this.#pendingLength
      this.#pieces = []
      this.#pendingLength = 0
      this.#isQuoted = false
      this.#isAfterQuote = false
      return
    }
    this.#pieces.push(Buffer.from(bytes))
  }

  #complete (frames: CsvFrame[]): void {
    const position = { firstLine: this.#firstLine, lastLine: this.#firstLine + this.#lineFeeds }
    this.#firstLine = position.lastLine + 1
    this.#lineFeeds = 0
    const droppedLength = this.#droppedLength
    const pieces = this.#pieces
    this.#pieces = []
    this.#droppedLength = undefined
    if (droppedLength !== undefined) {
      this.#pendingLength = 0
      frames.push({ kind: 'oversized', byteLength: droppedLength, position })
      return
    }
    const bytes = Buffer.concat(pieces, this.#pendingLength)
    this.#pendingLength = 0
    const length = bytes.at(-1) === carriageReturn ? bytes.length - 1 : bytes.length
    // The extra byte held above is allowed only for a CRLF ending, not for another content byte.
    frames.push(length > this.maximumBytes
      ? { kind: 'oversized', byteLength: bytes.length, position }
      : { kind: 'record', bytes: bytes.subarray(0, length), position })
  }

  // Follows the quote state through one byte other than a line feed.
  #scan (byte: number): void {
    if (this.#isQuoted) {
      if (this.#isAfterQuote) {
        this.#isAfterQuote = false
        if (byte === carriageReturn || byte === this.delimiter) {
          this.#isQuoted = false
          this.#isFieldStart = byte === this.delimiter
        }
        // A quote after a quote is an escaped quote; anything else is text after a closing quote, which csv-parse
        // reports while the field stays quoted.
        return
      }
      this.#isAfterQuote = byte === quote
      return
    }
    if (byte === quote && this.#isFieldStart) {
      this.#isQuoted = true
    }
    this.#isFieldStart = byte === this.delimiter
  }

  // Whether a line feed now ends the record: outside a quoted field, or right after its closing quote.
  #isRecordEnd (): boolean {
    if (!this.#isQuoted || this.#isAfterQuote || this.#droppedLength !== undefined) {
      this.#isQuoted = false
      this.#isAfterQuote = false
      this.#isFieldStart = true
      return true
    }
    return false
  }

  // Frames the complete records of the chunk and holds back the rest.
  push (chunk: Uint8Array): CsvFrame[] {
    const frames: CsvFrame[] = []
    const bytes = this.#withoutByteOrderMark(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
    let start = 0
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index] ?? 0
      if (byte !== lineFeed) {
        if (this.#droppedLength === undefined) {
          this.#scan(byte)
        }
        continue
      }
      this.#hold(bytes.subarray(start, index))
      start = index + 1
      if (this.#isRecordEnd()) {
        this.#complete(frames)
      } else {
        // A line break inside a quoted field belongs to the record.
        this.#hold(Buffer.of(lineFeed))
        this.#lineFeeds += 1
      }
    }
    this.#hold(bytes.subarray(start))
    return frames
  }

  // Ends the source: an unfinished record is a record of its own, also with a quote that is not closed.
  end (): CsvFrame[] {
    const frames: CsvFrame[] = []
    if (this.#startBytes !== undefined && this.#startBytes.length > 0) {
      this.#hold(Buffer.from(this.#startBytes))
    }
    this.#startBytes = undefined
    if (this.#pendingLength > 0 || this.#droppedLength !== undefined) {
      this.#complete(frames)
    }
    return frames
  }
}

interface CsvOptions {
  // The field delimiter, one ASCII character other than a quote or a line break; a comma by default.
  readonly delimiter?: string
}

const errorDiagnostic = (code: string, message: string, position?: LinePosition): ParseDiagnostic =>
  position === undefined
    ? { kind: 'diagnostic', severity: 'error', code, message }
    : { kind: 'diagnostic', severity: 'error', code, message, position }

// What csv-parse made of a frame: its fields, or the code of its error.
type Outcome = { readonly fields: readonly string[] } | { readonly error: string }

const errorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'CSV_UNKNOWN_ERROR'

// Parses texts with csv-parse and gives each outcome in order: records and the records it skipped.
const parseTexts = (text: string, delimiter: string, maximumRecordSize: number): Outcome[] => {
  const outcomes: Outcome[] = []
  parse(text, {
    delimiter,
    record_delimiter: '\n',
    relax_column_count: true,
    skip_records_with_error: true,
    max_record_size: maximumRecordSize,
    // Records go into the outcomes in order with the skipped ones; csv-parse leaves out a record that this gives
    // nothing for.
    on_record: (record: string[]) => {
      outcomes.push({ fields: record })
    },
    on_skip: error => {
      outcomes.push({ error: errorCode(error) })
    }
  })
  return outcomes
}

// The outcome of each frame. The frames are parsed together; when malformed quotes make csv-parse see other record
// boundaries than the frames, each frame is parsed alone, so that every outcome keeps its frame's lines.
const parseFrames = (texts: readonly string[], delimiter: string, maximumRecordSize: number): Outcome[][] => {
  const together = parseTexts(texts.join('\n'), delimiter, maximumRecordSize)
  return together.length === texts.length
    ? together.map(outcome => [outcome])
    : texts.map(text => parseTexts(text, delimiter, maximumRecordSize))
}

const csvErrorMessages: Readonly<Record<string, string>> = {
  CSV_QUOTE_NOT_CLOSED: 'a quote that is not closed',
  CSV_INVALID_CLOSING_QUOTE: 'text right after a closing quote',
  INVALID_OPENING_QUOTE: 'a quote inside a field that is not quoted',
  CSV_MAX_RECORD_SIZE: 'a record over the size limit'
}

const blankPattern = /^[\t ]*$/

// The header's problem: an empty or a repeated column name.
const headerProblem = (names: readonly string[]): string | undefined => {
  const seen = new Set<string>()
  for (const [index, name] of names.entries()) {
    if (name === '') {
      return `column ${String(index + 1)} has no name`
    }
    if (seen.has(name)) {
      return `the column ${name} appears twice`
    }
    seen.add(name)
  }
  return undefined
}

// The state of one CSV source: its header once read, or the reason it has none.
interface HeaderState {
  names?: readonly string[]
  problem?: string
}

// The event of a parsed row: the source's first row is its header, which gives an event only when it cannot be used.
const rowEvent = (fields: readonly string[], header: HeaderState, position: LinePosition): ParseEvent | undefined => {
  if (header.names === undefined) {
    const problem = headerProblem(fields) ?? (fields.length === 0 ? 'the header names no columns' : undefined)
    header.names = problem === undefined ? fields : []
    if (problem === undefined) {
      return undefined
    }
    header.problem = problem
    return errorDiagnostic('csv-header', `the header cannot be used: ${problem}`, position)
  }
  if (header.problem !== undefined) {
    return errorDiagnostic('csv-header', `skipped a row, since the header cannot be used: ${header.problem}`, position)
  }
  const names = header.names
  if (fields.length !== names.length) {
    return errorDiagnostic('csv-row-width', `skipped a row of ${String(fields.length)} fields; the header has ${String(names.length)}`, position)
  }
  const value: JsonObject = asJsonObject(Object.fromEntries(names.map((name, index) => [name, fields[index] ?? ''])))
  return { kind: 'entry', value, position }
}

// The events of complete frames: records, and diagnostics for oversized frames, rows that csv-parse skipped, the
// header and rows of another width.
const frameEvents = (frames: readonly CsvFrame[], header: HeaderState, delimiter: string, maximumRecordSize: number): ParseEvent[] => {
  const events: ParseEvent[] = []
  const records: { readonly text: string, readonly position: LinePosition }[] = []
  const flush = (): void => {
    const outcomes = parseFrames(records.map(record => record.text), delimiter, maximumRecordSize)
    for (const [index, frameOutcomes] of outcomes.entries()) {
      const position = records[index]?.position
      if (position === undefined) {
        continue
      }
      for (const outcome of frameOutcomes) {
        if ('error' in outcome) {
          const reason = csvErrorMessages[outcome.error] ?? outcome.error
          events.push(errorDiagnostic('csv-syntax', `skipped a record that is no CSV: ${reason}`, position))
          continue
        }
        const event = rowEvent(outcome.fields, header, position)
        if (event !== undefined) {
          events.push(event)
        }
      }
    }
    records.length = 0
  }
  for (const frame of frames) {
    if (frame.kind === 'oversized') {
      flush()
      events.push(errorDiagnostic('record-too-large',
        `skipped a record of ${String(frame.byteLength)} bytes, more than the limit of ${sizeText(maximumRecordSize)}`, frame.position))
      continue
    }
    const text = frame.bytes.toString('utf8')
    if (!blankPattern.test(text)) {
      records.push({ text, position: frame.position })
    }
  }
  flush()
  return events
}

const readCsv = (delimiter: string) => async function * (input: AsyncIterable<Uint8Array>, context: FormatContext): AsyncGenerator<ParseEvent> {
  const maximumRecordSize = context.maximumRecordSize
  const framer = new CsvFramer(maximumRecordSize, delimiter)
  const header: HeaderState = {}
  for await (const chunk of input) {
    yield * frameEvents(framer.push(chunk), header, delimiter, maximumRecordSize)
  }
  yield * frameEvents(framer.end(), header, delimiter, maximumRecordSize)
}

const csvProfile: FieldProfile = {
  timestamp: [['timestamp'], ['time']],
  level: [['level']],
  message: [['message'], ['msg']],
  hasNumericLevels: false,
  timestampUnit: 'milliseconds'
}

// The sample's first line as a header, which must parse, and the complete lines after it, parsed without those that
// csv-parse cannot read.
const sampleRows = (sample: FormatSample, delimiter: string): { readonly names?: readonly string[], readonly data: readonly string[][] } => {
  const { text } = sample
  const headerEnd = text.indexOf('\n')
  const header = (headerEnd === -1 ? text : text.slice(0, headerEnd)).replace(/\r$/, '')
  const rest = headerEnd === -1 ? '' : text.slice(headerEnd + 1, Math.max(text.lastIndexOf('\n'), headerEnd + 1))
  let names: readonly string[] | undefined
  try {
    names = parse(header, { delimiter, relax_column_count: true })[0]
  } catch {
    return { data: [] }
  }
  const data = parse(rest, { delimiter, relax_column_count: true, skip_empty_lines: true, skip_records_with_error: true })
  return names === undefined ? { data } : { names, data }
}

// A valid header with a message column, and the share of the following rows that have its width. The extension .csv
// adds to the score.
const probeCsv = (sample: FormatSample, context: FormatContext, delimiter: string): number => {
  const { names, data } = sampleRows(sample, delimiter)
  if (names === undefined || headerProblem(names) !== undefined) {
    return 0
  }
  const mapped = context.mapping.message
  const messageColumns = mapped === undefined ? ['message', 'msg'] : (mapped.length === 1 ? [String(mapped[0])] : [])
  if (names.every(name => !messageColumns.includes(name))) {
    return 0
  }
  const share = data.length === 0 ? 1 : data.filter(row => row.length === names.length).length / data.length
  return Math.round(share * 70) + (sample.extension === '.csv' ? 15 : 0)
}

// One ASCII character, printable or a tab, other than a quote.
const isCsvDelimiter = (text: string): boolean => /^[\t\u{20}-\u{7E}]$/u.test(text) && text !== '"'

// A CSV format with its delimiter; the built-in csv format uses a comma.
const createCsvFormat = (options: CsvOptions = {}): LogFormat => {
  const delimiter = options.delimiter ?? ','
  if (!isCsvDelimiter(delimiter)) {
    throw new RangeError(`The CSV delimiter must be one ASCII character other than a quote or a line break, not ${JSON.stringify(delimiter)}.`)
  }
  return {
    identifier: 'csv',
    probe: (sample, context) => probeCsv(sample, context, delimiter),
    read: readCsv(delimiter),
    normalize: (value, context) => normalizeFields(value, csvProfile, context)
  }
}

const csvFormat: LogFormat = createCsvFormat()

export { CsvFramer, createCsvFormat, csvFormat, csvProfile, isCsvDelimiter }
export type { CsvFrame, CsvOptions }
