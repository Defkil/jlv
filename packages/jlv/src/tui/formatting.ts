// Successor of upstream src/utils.js: the column layout of the main panel and its blessed markup. Cells whose value
// is not text keep upstream's behavior: they fail inside padEnd, and formatRows then shows the raw value.

// A blessed tag such as {bold} or {/red-fg}. The pattern is global, so test() continues where the previous match
// ended: like upstream, the result of hasColors depends on the calls made before it.
const colorTagPattern = /{\/?[\w\-,;!#]+}/g

type Row = Readonly<Record<string, unknown>>

interface Column {
  readonly key: string
  // A fixed width; otherwise the widest value of the column decides.
  readonly length?: number
  // Turns the raw value into display text, whose width then counts without blessed tags.
  readonly format?: (value: unknown) => string
}

// Trusted blessed markup: the literal parts may contain tags such as {bold}. Interpolated values are inserted as
// they are, exactly as in an untagged template literal.
const markup = (literals: TemplateStringsArray, ...values: readonly string[]): string =>
  String.raw({ raw: literals }, ...values)

const hasColors = (text: unknown): boolean => colorTagPattern.test(String(text))

// Upstream evaluated (text || '').replace(...): empty values give '', and values other than text have no replace.
const stripColors = (text: unknown): string => {
  if (!text) {
    return ''
  }
  if (typeof text !== 'string') {
    throw new TypeError('Only text can contain blessed tags.')
  }
  return text.replaceAll(colorTagPattern, '').replaceAll('{/}', '')
}

// Reads value.length the way upstream's property access did: text and arrays have a length, an object may carry
// one as a field, and numbers or booleans have none.
const lengthProperty = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.length
  }
  return typeof value === 'function' || (typeof value === 'object' && value !== null)
    ? Reflect.get(value, 'length')
    : undefined
}

// The display length of text without its blessed tags, or with them when they are to be ignored. A value without a
// numeric length gives NaN, which makes padEnd fail as upstream did.
const textLength = (text: unknown, shouldIgnoreColors = false): number => {
  if (!text) {
    return 0
  }
  return shouldIgnoreColors ? Number(lengthProperty(text)) : stripColors(text).length
}

// Upstream joined an array of count + 1 empty slots, so a fractional count, NaN or a count below -1 throws.
const spaces = (count: number): string => {
  if (!Number.isSafeInteger(count) || count < -1) {
    throw new RangeError('Invalid array length')
  }
  return ' '.repeat(Math.max(count, 0))
}

const trunc = (text: unknown, length: number, shouldIgnoreColors = false): string => {
  if (!text) {
    return ''
  }
  if (shouldIgnoreColors || !hasColors(text)) {
    if (typeof text !== 'string') {
      throw new TypeError('Only text can be truncated.')
    }
    // A negative width gives an empty cell, as upstream's substring did.
    return text.slice(0, Math.max(length, 0))
  }
  if (typeof text !== 'string') {
    throw new TypeError('Only text can contain blessed tags.')
  }
  if (textLength(text, shouldIgnoreColors) <= length) {
    return text
  }

  let visibleLength = 0
  let isTag = false
  let output = ''
  let index = 0
  while (visibleLength < length) {
    const character = text.charAt(index)
    output += character
    if (character === '{') {
      isTag = true
    }
    if (!isTag) {
      visibleLength += 1
    }
    if (character === '}') {
      isTag = false
    }
    index += 1
  }

  return `${output}{/}`
}

const padEnd = (text: unknown, length: number, shouldIgnoreColors = false): string => {
  const spaceCount = length - textLength(text, shouldIgnoreColors)
  return spaceCount < 0 ? trunc(text, length, shouldIgnoreColors) : `${String(text)}${spaces(spaceCount)}`
}

// The width of every column but the last from its widest value; the last column gets the rest of maxWidth.
const maxLengths = (columns: readonly Column[], rows: readonly Row[], spacing: number, maxWidth: number): Record<string, number> => {
  const lengths: Record<string, number> = {}
  const measuredColumns = columns.slice(0, -1)
  for (const row of rows) {
    for (const column of measuredColumns) {
      const value: unknown = row[column.key] || ''
      lengths[column.key] = column.length || Math.max(lengths[column.key] || 0, textLength(String(value)))
    }
  }
  const lastColumn = columns.at(-1)
  if (lastColumn === undefined) {
    // Upstream read the key of the missing last column.
    throw new TypeError('The rows need at least one column.')
  }
  let width = spacing * Object.keys(lengths).length
  for (const length of Object.values(lengths)) {
    width += length
  }
  // The last column is empty, not negative, when the other columns use up the width; NaN stays NaN.
  lengths[lastColumn.key] = Math.max(maxWidth - width, 0)
  return lengths
}

const formatRows = (rows: readonly Row[], columns: readonly Column[], spacing: number, maxWidth: number): string[] => {
  const lengths = maxLengths(columns, rows, spacing, maxWidth)
  return rows.map(row => columns.map(column => {
    const { format, key } = column
    const rawValue = row[key]
    try {
      const value = format === undefined ? rawValue : format(rawValue)
      // A column without a width behaves like upstream's undefined one: the arithmetic gives NaN.
      return padEnd(value, lengths[key] ?? NaN, !format)
    } catch {
      return rawValue
    }
  }).join(spaces(spacing)))
}

const levelColors: Readonly<Record<string, (text: string) => string>> = {
  debug: text => markup`{cyan-fg}${text}{/cyan-fg}`,
  info: text => markup`{#ffff94-fg}{bold}${text}{/bold}{/#ffff94-fg}`,
  warn: text => markup`{#ffa500-fg}${text}{/#ffa500-fg}`,
  error: text => markup`{red-fg}${text}{/red-fg}`
}

export { formatRows, maxLengths, hasColors, stripColors, spaces, padEnd, textLength, trunc, levelColors, markup }
