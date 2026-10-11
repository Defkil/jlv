// Successor of upstream src/log.js: turns JSON lines into the legacy rows of the viewer and applies the [transform]
// mapping from ~/.json-log-viewer. The final record model replaces these rows in a later phase.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ini from 'ini'
import { valueAtField } from './field-path.js'
import { LineSplitter } from './input/lines.js'

// A row of the viewer: the three known fields when the record has them, every other field below data.
type LogEntry = {
  readonly timestamp?: unknown
  readonly level?: unknown
  readonly message?: unknown
  readonly data: Readonly<Record<string, unknown>>
}

interface LogReader {
  readonly readFileSync: (file: string) => string | Buffer
}

interface ConfigFileSystem {
  readonly existsSync: (file: string) => boolean
  readonly readFileSync: (file: string, encoding: 'utf8') => string
}

type Mapping = Readonly<Record<string, unknown>>

// What a line holds: a record of the viewer, nothing (an empty line), or a line that the viewer skips because it is
// no JSON or a JSON value that upstream dropped (null, false, 0 or empty text).
type ParsedLine =
  | { readonly kind: 'record', readonly value: unknown }
  | { readonly kind: 'blank' }
  | { readonly kind: 'skipped', readonly reason: 'invalid-json' | 'empty-value' }

// The mapping file exists but cannot be read; the command line reports it before it opens a screen.
class MappingFileError extends Error {
  constructor (message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MappingFileError'
  }
}

const entryFields = ['timestamp', 'level', 'message'] as const

const mappingFileName = '.json-log-viewer'

// An INI section: ini 6 returns sections as objects without a prototype, and other values as text, booleans, null
// or lists.
const isSection = (value: unknown): value is Mapping => typeof value === 'object' && value !== null && !Array.isArray(value)

// Reads the [transform] section of ~/.json-log-viewer once per invocation. Without the file or the section there is
// no mapping. Upstream looked the file up again for every record until it found a section, and dropped every line
// while the file could not be read; a file that cannot be read is now a configuration error.
const readMapping = (fileSystem: ConfigFileSystem = fs, home = os.homedir()): Mapping | undefined => {
  const mappingFile = path.join(home, mappingFileName)
  if (!fileSystem.existsSync(mappingFile)) {
    return undefined
  }
  let text: string
  try {
    text = fileSystem.readFileSync(mappingFile, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MappingFileError(`cannot read the mapping file ${mappingFile}: ${reason}`, { cause: error })
  }
  const parsed: unknown = ini.parse(text)
  // Only a [transform] section maps fields; a top-level transform key is no mapping.
  const mapping = isSection(parsed) ? parsed['transform'] : undefined
  return isSection(mapping) ? mapping : undefined
}

// The path of a mapping value as lodash.get resolved it: INI text, true, false and null by their text form, key[]=
// lists element by element. A nested section such as [transform.extra] names no field.
const mappingPath = (value: unknown): string | readonly string[] | undefined => {
  if (Array.isArray(value)) {
    return value.map(String)
  }
  return isSection(value) ? undefined : String(value)
}

const transform = (entry: unknown, mapping: Mapping | undefined): unknown => {
  if (!mapping) {
    return entry
  }

  // $ copies the whole record; any other value is a path into it. structuredClone copies parsed JSON the way
  // upstream's lodash.cloneDeep did.
  return Object.fromEntries(Object.entries(mapping).map(([key, value]) => {
    const fieldPath = mappingPath(value)
    return [key, value === '$' ? structuredClone(entry) : (fieldPath === undefined ? undefined : valueAtField(entry, fieldPath))]
  }))
}

// JSON's whitespace: a line of only these characters is empty, not malformed.
const blankPattern = /^[\t\n\r ]*$/

// Parses one line as upstream did: JSON.parse, then the mapping, and a falsy result is no record.
const parseLine = (text: string, mapping: Mapping | undefined): ParsedLine => {
  if (blankPattern.test(text)) {
    return { kind: 'blank' }
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: 'skipped', reason: 'invalid-json' }
  }
  const record = transform(value, mapping)
  return record ? { kind: 'record', value: record } : { kind: 'skipped', reason: 'empty-value' }
}

const entryFieldNames: readonly string[] = entryFields
const isEntryField = (key: string): boolean => entryFieldNames.includes(key)

// The known fields in their fixed order, and every other own field below data. A value other than an object is read
// through its object wrapper, so text gives one field per character, as with upstream's lodash.pick and lodash.omit.
const toEntry = (line: unknown): LogEntry => {
  const wrapper = new Object(line)
  const fields: Record<string, unknown> = {}
  for (const key of entryFields) {
    if (Object.hasOwn(wrapper, key)) {
      fields[key] = Object.getOwnPropertyDescriptor(wrapper, key)?.value
    }
  }
  const data = Object.fromEntries(Object.entries(wrapper).filter(([key]) => !isEntryField(key)))
  return { ...fields, data }
}

// The row of a stored record's text. The store keeps only lines that parsed as records, so the same text and mapping
// give the same row again.
const parseEntry = (text: string, mapping: Mapping | undefined): LogEntry => {
  const parsed = parseLine(text, mapping)
  return toEntry(parsed.kind === 'record' ? parsed.value : {})
}

// An RFC 3339 date and time with a zone; a space may separate date and time.
const timestampPattern = /^\d{4}-\d{2}-\d{2}[ Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/

// The time key by which the viewer sorts a record, in epoch milliseconds: the timestamp field of the row as a finite
// number, or as RFC 3339 text with a zone. Anything else is NaN and sorts last: a missing timestamp, a naive or
// unparseable text, or a value of another type. The final model of plan section 5 replaces this transition rule.
const timeKey = (record: unknown): number => {
  const timestamp: unknown = record === undefined || record === null
    ? undefined
    : Object.getOwnPropertyDescriptor(new Object(record), 'timestamp')?.value
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : NaN
  }
  return typeof timestamp === 'string' && timestampPattern.test(timestamp)
    ? Date.parse(`${timestamp.slice(0, 10)}T${timestamp.slice(11).toUpperCase()}`)
    : NaN
}

// The rows of a whole file, framed and parsed like a stream that ends with the file.
const readLog = (file: string, reader: LogReader = fs, mapping: Mapping | undefined = readMapping()): LogEntry[] => {
  const contents = reader.readFileSync(file)
  const splitter = new LineSplitter()
  const events = [...splitter.push(typeof contents === 'string' ? Buffer.from(contents, 'utf8') : contents), ...splitter.end()]
  const entries: LogEntry[] = []
  for (const event of events) {
    const parsed = event.kind === 'line' ? parseLine(event.bytes.toString('utf8'), mapping) : undefined
    if (parsed?.kind === 'record') {
      entries.push(toEntry(parsed.value))
    }
  }
  return entries
}

export { MappingFileError, parseEntry, parseLine, readLog, readMapping, timeKey, toEntry, transform }
export type { ConfigFileSystem, LogEntry, LogReader, Mapping, ParsedLine }
