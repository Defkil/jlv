// logfmt (plan section 6.2): one record per line of key=value pairs, read by a small scanner instead of the old logfmt
// package. The grammar:
//
//   line   = pairs separated by spaces or tabs, with any spaces or tabs around them
//   pair   = key | key "=" | key "=" value
//   key    = one or more characters other than space, tab, "=" and '"'
//   value  = bare | quoted
//   bare   = characters other than space, tab and '"'; "=" is allowed, as in url=/a?b=c
//   quoted = '"' characters and escapes '"', where \" \\ \n \r \t and \uXXXX are escapes and any other backslash
//            stays as it is
//
// Values stay text, so count=5 is "5"; a key without "=" is a flag, true; key= and key="" are empty text. A key that
// appears twice keeps its last value, with a warning. A quote inside a key or a bare value, text right after a closing
// quote, a quote that is not closed and "=" without a key make the line a diagnostic. The usual names time and
// timestamp, msg and message, and level give the normalized parts.
import type { FormatContext, JsonObject, JsonValue, LogFormat, ParseDiagnostic, ParseEvent } from '../api.js'
import { LineSplitter, type LineEvent } from '../input/lines.js'
import { asJsonObject, normalizeFields, type FieldProfile } from '../record.js'
import { sizeText } from './json-lines.js'
import { sampleLines, shareScore } from './sample.js'

type ScanResult =
  | { readonly value: JsonObject, readonly duplicates: readonly string[] }
  | { readonly error: string }

const isSeparator = (character: string | undefined): boolean => character === ' ' || character === '\t'

const escapes: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' }

const hexadecimalPattern = /^[\da-f]{4}$/i

interface Cursor {
  index: number
}

// Reads a quoted value from its opening quote on; undefined when the quote is not closed.
const readQuoted = (line: string, cursor: Cursor): string | undefined => {
  let text = ''
  let index = cursor.index + 1
  while (index < line.length) {
    const character = line.charAt(index)
    if (character === '"') {
      cursor.index = index + 1
      return text
    }
    if (character !== '\\') {
      text += character
      index += 1
      continue
    }
    const escaped = line.charAt(index + 1)
    const unicode = line.slice(index + 2, index + 6)
    if (escaped === 'u' && hexadecimalPattern.test(unicode)) {
      text += String.fromCodePoint(Number.parseInt(unicode, 16))
      index += 6
    } else if (escaped !== '' && escapes[escaped] !== undefined) {
      text += escapes[escaped]
      index += 2
    } else {
      // An unknown escape stays as it is; a backslash at the end leaves the quote open.
      text += character
      index += 1
    }
  }
  return undefined
}

// Scans one line into its fields in their order.
const scanLogfmt = (line: string): ScanResult => {
  const fields = new Map<string, JsonValue>()
  const duplicates: string[] = []
  const cursor: Cursor = { index: 0 }
  for (;;) {
    while (isSeparator(line.charAt(cursor.index))) {
      cursor.index += 1
    }
    if (cursor.index >= line.length) {
      break
    }
    const keyStart = cursor.index
    while (cursor.index < line.length && !isSeparator(line.charAt(cursor.index)) && !'="'.includes(line.charAt(cursor.index))) {
      cursor.index += 1
    }
    const key = line.slice(keyStart, cursor.index)
    const next = line.charAt(cursor.index)
    if (next === '"') {
      return { error: 'a quote inside a key' }
    }
    if (key === '') {
      return { error: '"=" without a key' }
    }
    let value: JsonValue = true
    if (next === '=') {
      cursor.index += 1
      if (line.charAt(cursor.index) === '"') {
        const quoted = readQuoted(line, cursor)
        if (quoted === undefined) {
          return { error: 'a quote that is not closed' }
        }
        if (cursor.index < line.length && !isSeparator(line.charAt(cursor.index))) {
          return { error: 'text right after a closing quote' }
        }
        value = quoted
      } else {
        const valueStart = cursor.index
        while (cursor.index < line.length && !isSeparator(line.charAt(cursor.index))) {
          if (line.charAt(cursor.index) === '"') {
            return { error: 'a quote inside a value' }
          }
          cursor.index += 1
        }
        value = line.slice(valueStart, cursor.index)
      }
    }
    if (fields.has(key)) {
      duplicates.push(key)
    }
    fields.set(key, value)
  }
  // fromEntries defines own properties, so a key such as __proto__ is a field like any other.
  return { value: asJsonObject(Object.fromEntries(fields)), duplicates }
}

const blankPattern = /^[\t ]*$/

const lineDiagnostic = (severity: 'warning' | 'error', code: string, message: string, lineNumber: number): ParseDiagnostic =>
  ({ kind: 'diagnostic', severity, code, message, position: { firstLine: lineNumber, lastLine: lineNumber } })

// The events of one framed line: diagnostics for duplicate keys, then the record; or a diagnostic for a line that
// cannot be read.
const logfmtEvents = (line: LineEvent, maximumBytes: number): ParseEvent[] => {
  if (line.kind === 'oversized') {
    return [lineDiagnostic('error', 'record-too-large', `skipped a line of ${String(line.byteLength)} bytes, more than the limit of ${sizeText(maximumBytes)}`, line.lineNumber)]
  }
  const text = line.bytes.toString('utf8')
  if (blankPattern.test(text)) {
    return []
  }
  const scanned = scanLogfmt(text)
  if ('error' in scanned) {
    return [lineDiagnostic('error', 'logfmt-syntax', `skipped a line that is no logfmt: ${scanned.error}`, line.lineNumber)]
  }
  const position = { firstLine: line.lineNumber, lastLine: line.lineNumber }
  return [
    ...[...new Set(scanned.duplicates)].map(key =>
      lineDiagnostic('warning', 'logfmt-duplicate-key', `the key ${key} appears more than once; its last value counts`, line.lineNumber)),
    { kind: 'entry', value: scanned.value, position }
  ]
}

async function * readLogfmt (input: AsyncIterable<Uint8Array>, context: FormatContext): AsyncGenerator<ParseEvent> {
  const maximumBytes = context.maximumRecordSize
  const splitter = new LineSplitter({ maximumLineBytes: maximumBytes })
  for await (const chunk of input) {
    for (const line of splitter.push(chunk)) {
      yield * logfmtEvents(line, maximumBytes)
    }
  }
  for (const line of splitter.end()) {
    yield * logfmtEvents(line, maximumBytes)
  }
}

const logfmtProfile: FieldProfile = {
  timestamp: [['time'], ['timestamp']],
  level: [['level']],
  message: [['msg'], ['message']],
  hasNumericLevels: false,
  timestampUnit: 'milliseconds'
}

const knownKeys: readonly string[] = ['time', 'timestamp', 'level', 'msg', 'message']

// A line that the scanner reads and that names at least one of the usual keys with a value. Plain text would be a line
// of flags, so it does not count.
const isLogfmtRecord = (line: string): boolean => {
  if (line.trimStart().startsWith('{')) {
    return false
  }
  const scanned = scanLogfmt(line)
  return !('error' in scanned) && knownKeys.some(key => typeof scanned.value[key] === 'string')
}

const logfmtFormat: LogFormat = {
  identifier: 'logfmt',
  probe: sample => {
    const lines = sampleLines(sample)
    return shareScore(lines.filter(line => isLogfmtRecord(line)).length, lines.length, 80)
  },
  read: readLogfmt,
  normalize: (value, context) => normalizeFields(value, logfmtProfile, context)
}

export { logfmtFormat, logfmtProfile, readLogfmt, scanLogfmt }
export type { ScanResult }
