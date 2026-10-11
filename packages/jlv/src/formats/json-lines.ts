// JSON lines (plan sections 5 and 6.2): one JSON object per line, framed by input/lines.ts. Lines that are no JSON,
// JSON values other than objects, numbers beyond the range of doubles and nesting beyond 64 levels are diagnostics,
// not records. The JSON profiles (generic, pino, bunyan, Winston) share this reader and differ in their probe and
// their field profile.
import type { FormatContext, FormatSample, LogFormat, ParseDiagnostic, ParseEvent } from '../api.js'
import { LineSplitter, type LineEvent } from '../input/lines.js'
import { asJsonObject, genericProfile, isPlainObject, jsonProblem, normalizeFields, type FieldProfile, type JsonProblem } from '../record.js'
import { encodedEntry } from './metadata.js'
import { sampleObjects } from './sample.js'

// JSON's white space: a line of only these characters is empty, not malformed.
const blankPattern = /^[\t\n\r ]*$/

const mebibyte = 1024 * 1024

// A size for messages: whole mebibytes as such, anything else in bytes.
const sizeText = (bytes: number): string => bytes % mebibyte === 0 ? `${String(bytes / mebibyte)} MiB` : `${String(bytes)} bytes`

const lineError = (code: string, message: string, lineNumber: number): ParseDiagnostic =>
  ({ kind: 'diagnostic', severity: 'error', code, message, position: { firstLine: lineNumber, lastLine: lineNumber } })

const problemMessages: Readonly<Record<JsonProblem, string>> = {
  'number-out-of-range': 'skipped a record with a number beyond the range of doubles',
  'too-deep': 'skipped a record nested deeper than 64 levels',
  // JSON.parse gives JSON values only; this is here for completeness.
  'not-json': 'skipped a record with a value that is no JSON'
}

// The event of one framed line: a record with its JSON text, a diagnostic, or nothing for an empty line.
const jsonLineEvent = (line: LineEvent, maximumBytes: number): ParseEvent | undefined => {
  if (line.kind === 'oversized') {
    return lineError('record-too-large', `skipped a line of ${String(line.byteLength)} bytes, more than the limit of ${sizeText(maximumBytes)}`, line.lineNumber)
  }
  const text = line.bytes.toString('utf8')
  if (blankPattern.test(text)) {
    return undefined
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return lineError('invalid-json', 'skipped a line that is no JSON', line.lineNumber)
  }
  if (!isPlainObject(value)) {
    return lineError('not-an-object', 'skipped a JSON value that is no object', line.lineNumber)
  }
  const problem = jsonProblem(value)
  return problem === undefined
    ? encodedEntry(asJsonObject(value), { firstLine: line.lineNumber, lastLine: line.lineNumber }, line.bytes)
    : lineError(problem, problemMessages[problem], line.lineNumber)
}

// Reads JSON lines up to the context's record size; the last line needs no line feed.
async function * readJsonLines (input: AsyncIterable<Uint8Array>, context: FormatContext): AsyncGenerator<ParseEvent> {
  const maximumBytes = context.maximumRecordSize
  const splitter = new LineSplitter({ maximumLineBytes: maximumBytes })
  for await (const chunk of input) {
    for (const line of splitter.push(chunk)) {
      const event = jsonLineEvent(line, maximumBytes)
      if (event !== undefined) {
        yield event
      }
    }
  }
  for (const line of splitter.end()) {
    const event = jsonLineEvent(line, maximumBytes)
    if (event !== undefined) {
      yield event
    }
  }
}

interface JsonProfileOptions {
  readonly identifier: string
  readonly profile: FieldProfile
  readonly probe: (sample: FormatSample, context: FormatContext) => number
}

// A format of JSON lines with its own field profile and probe.
const jsonProfileFormat = (options: JsonProfileOptions): LogFormat => ({
  identifier: options.identifier,
  probe: options.probe,
  read: readJsonLines,
  normalize: (value, context) => normalizeFields(value, options.profile, context)
})

// Generic JSON lines: timestamp, level and message at the top level, unless a mapping names other fields. It is the
// fallback for lines of JSON objects, so its probe stays below every format with a signature of its own.
const jsonLinesFormat: LogFormat = jsonProfileFormat({
  identifier: 'jsonl',
  profile: genericProfile,
  probe: sample => sampleObjects(sample).length > 0 ? 10 : 0
})

export { jsonLineEvent, jsonLinesFormat, jsonProfileFormat, readJsonLines, sizeText }
export type { JsonProfileOptions }
