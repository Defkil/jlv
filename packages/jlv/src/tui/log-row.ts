// The compatibility view between the record model (plan section 5) and the rows that the ported widgets show: the
// main panel's columns, its search and filters, the details dialog and the plain output read { timestamp, level,
// message, data } as upstream's rows had them. The row keeps the whole record, so nothing of it is lost on the way.
//
// - timestamp: the normalized time in UTC as RFC 3339 with milliseconds, else the original text of a timestamp that
//   is no time, else nothing.
// - level: the normalized level; an unknown level shows its raw value when the record has one.
// - message: always text.
// - data, which the details and the plain output show: the record's fields without the fields that the columns show,
//   also inside objects, such as the text of a Docker envelope that is the message. A legacy [transform] mapping
//   instead shows its extra keys, as upstream did: $ for the whole record, without a copy, and any other key for the
//   value at its path.
import type { FieldPath, JsonValue, LogRecord } from '../api.js'
import { valueAtField, valueAtPath } from '../field-path.js'
import { consumedPathsOf } from '../formats/metadata.js'
import type { NormalizedRecord } from '../ingestion.js'
import { boundedJson, isPlainObject } from '../record.js'

type LogRow = {
  readonly timestamp?: string
  readonly level?: string
  readonly message: string
  readonly data: Readonly<Record<string, unknown>>
  readonly record: LogRecord
}

// An extra key of a legacy mapping: the whole record, a path in lodash's grammar, or a nested section, which names no
// field.
type LegacyExtra =
  | { readonly kind: 'record' }
  | { readonly kind: 'path', readonly path: string | readonly string[] }
  | { readonly kind: 'none' }

interface RowOptions {
  // The extra keys of a legacy mapping in their order; undefined without a legacy mapping.
  readonly legacyExtras?: ReadonlyMap<string, LegacyExtra> | undefined
}

type MutableRow = { -readonly [Key in keyof LogRow]: LogRow[Key] }

const displayTimestamp = (record: LogRecord): string | undefined =>
  record.timestamp === undefined ? record.timestampText : new Date(record.timestamp).toISOString()

// The raw value of an unknown level: text as it is, anything else as bounded JSON.
const rawText = (value: JsonValue): string => typeof value === 'string' ? value : boundedJson(value)

const displayLevel = (stored: NormalizedRecord): string | undefined => {
  const { record, paths } = stored
  if (record.level !== 'unknown') {
    return record.level
  }
  const raw = paths.level === undefined ? undefined : valueAtPath(record.fields, paths.level)
  return raw === undefined || raw === null ? undefined : rawText(raw)
}

type Fields = Readonly<Record<string, unknown>>

// The object without the value at a path below it. The objects along the path are copied, never changed, and an object
// that loses its last key goes too. A path through an array leaves the array as it is, since removing an element would
// move the others.
const withoutPath = (object: Fields, path: FieldPath): Fields => {
  const [segment, ...rest] = path
  const key = String(segment)
  if (segment === undefined || !Object.hasOwn(object, key)) {
    return object
  }
  const child = object[key]
  const reduced = rest.length > 0 && isPlainObject(child) ? withoutPath(child as Fields, rest) : child
  if (reduced === child && rest.length > 0) {
    return object
  }
  const isGone = rest.length === 0 || (typeof reduced === 'object' && reduced !== null && Object.keys(reduced).length === 0)
  return Object.fromEntries(Object.entries(object).flatMap(([name, value]): [string, unknown][] => {
    if (name !== key) {
      return [[name, value]]
    }
    return isGone ? [] : [[name, reduced]]
  }))
}

// The fields without those that the columns show. Top-level keys, the usual case, go in one pass.
const withoutPaths = (fields: LogRecord['fields'], paths: readonly FieldPath[]): Fields => {
  const keys = new Set(paths.filter(path => path.length === 1).map(([key]) => String(key)))
  let data: Fields = keys.size === 0 ? { ...fields } : Object.fromEntries(Object.entries(fields).filter(([key]) => !keys.has(key)))
  for (const path of paths) {
    if (path.length > 1) {
      data = withoutPath(data, path)
    }
  }
  return data
}

const legacyData = (fields: LogRecord['fields'], extras: ReadonlyMap<string, LegacyExtra>): Record<string, unknown> =>
  Object.fromEntries([...extras].map(([key, extra]) => {
    if (extra.kind === 'record') {
      return [key, fields]
    }
    return [key, extra.kind === 'path' ? valueAtField(fields, extra.path) : undefined]
  }))

const rowOf = (stored: NormalizedRecord, options: RowOptions = {}): LogRow => {
  const { record, paths } = stored
  const row: MutableRow = {
    message: record.message,
    data: options.legacyExtras === undefined ? withoutPaths(record.fields, consumedPathsOf(paths)) : legacyData(record.fields, options.legacyExtras),
    record
  }
  const timestamp = displayTimestamp(record)
  if (timestamp !== undefined) {
    row.timestamp = timestamp
  }
  const level = displayLevel(stored)
  if (level !== undefined) {
    row.level = level
  }
  return row
}

export { displayTimestamp, rowOf }
export type { LegacyExtra, LogRow, RowOptions }
