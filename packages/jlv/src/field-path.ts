// Field lookup for the legacy viewer rows. Paths keep the grammar of lodash 4.17, which upstream used for the
// ~/.json-log-viewer mapping, the filters and the sort key: names separated by dots, [number] and ["text"] or
// ['text'] brackets with backslash escapes. Lookups read own properties only, so a path never reaches prototype
// members such as constructor or __proto__, and they never invoke accessors.

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

export { fieldReader, parsePath, valueAt, valueAtField }
