// Field lookup without evaluation (plan section 5). Paths of the record model are lists of segments, which
// valueAtPath follows through parsed JSON: object keys and array indexes, so ["log.level"] names a key with a dot.
//
// Text paths keep the grammar of lodash 4.17, which upstream used for the ~/.json-log-viewer mapping, the filters and
// the sort key: names separated by dots, [number] and ["text"] or ['text'] brackets with backslash escapes. Legacy
// mappings are parsed into segments with parsePath.
//
// All lookups read own properties only, so a path never reaches prototype members such as constructor or __proto__,
// and they never invoke accessors.
import type { FieldPath, JsonValue } from './api.js'

// One segment: a name, a bracketed number or quoted text, or an empty name before a dot or an empty bracket pair.
const segmentPattern = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g
const escapePattern = /\\(\\)?/g
// Text that contains a dot or a bracket pair is a path; anything else is a single key.
const deepPathPattern = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/
const plainKeyPattern = /^\w*$/

// The segments of a path in lodash's grammar. A leading dot starts with an empty name.
const parsePath = (text: string): string[] => {
  const segments = text.startsWith('.') ? [''] : []
  for (const [match, number, quote, quoted = ''] of text.matchAll(segmentPattern)) {
    segments.push(quote === undefined ? (number ?? match) : quoted.replaceAll(escapePattern, '$1'))
  }
  return segments
}

// The own property of any value but undefined and null; text has its characters and its length.
const ownValue = (value: unknown, key: string): unknown =>
  value === undefined || value === null ? undefined : Object.getOwnPropertyDescriptor(value, key)?.value

const hasOwnKey = (value: unknown, key: string): boolean =>
  value !== undefined && value !== null && Object.getOwnPropertyDescriptor(value, key) !== undefined

// Follows the segments from the value; an empty path or a missing step gives undefined.
const valueAt = (value: unknown, path: readonly string[]): unknown => {
  let current = value
  for (const key of path) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = ownValue(current, key)
  }
  return path.length === 0 ? undefined : current
}

// Reads the field at a path given as text, as lodash.get and lodash.property did: text without a dot or a bracket
// pair is one key, and an own key that equals the whole text wins over the path that the text describes. The path
// is parsed once for all values.
const fieldReader = (path: string): ((value: unknown) => unknown) => {
  const segments = plainKeyPattern.test(path) || !deepPathPattern.test(path) ? [path] : parsePath(path)
  return value => valueAt(value, hasOwnKey(value, path) ? [path] : segments)
}

// The value at a path given as text or as segments.
const valueAtField = (value: unknown, path: string | readonly string[]): unknown =>
  typeof path === 'string' ? fieldReader(path)(value) : valueAt(value, path)

// An array index in its canonical decimal form.
const indexPattern = /^(?:0|[1-9]\d*)$/

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value)

// The element or the own property of a JSON value; text, numbers, booleans and null have none.
const childOf = (value: JsonValue, segment: string | number): JsonValue | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  if (isJsonArray(value)) {
    const index = typeof segment === 'number' || !indexPattern.test(segment) ? segment : Number(segment)
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      return undefined
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? value[index] : undefined
  }
  const key = String(segment)
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? value[key] : undefined
}

// The value at a path of segments in parsed JSON; an empty path or a missing step gives undefined.
const valueAtPath = (value: JsonValue, path: FieldPath): JsonValue | undefined => {
  let current: JsonValue | undefined = value
  for (const segment of path) {
    if (current === undefined) {
      return undefined
    }
    current = childOf(current, segment)
  }
  return path.length === 0 ? undefined : current
}

// A path in diagnostics and messages, as the JSON list that a configuration file holds.
const formatPath = (path: FieldPath): string => JSON.stringify(path)

export { fieldReader, formatPath, parsePath, valueAt, valueAtField, valueAtPath }
