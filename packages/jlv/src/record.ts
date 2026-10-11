// Normalization of parsed records into the record model (plan section 5): levels, timestamps, messages and
// correlation identifiers, and the checks of parsed JSON. The built-in formats share normalizeFields and differ in
// their field profile; nothing here changes a field of the record or keeps state between records.
import type {
  FieldMapping, FieldPath, FormatContext, JsonObject, JsonValue, LogDraft, LogLevel, ParseDiagnostic, TimestampUnit
} from './api.js'
import { formatPath, valueAtPath } from './field-path.js'
import { normalizedPaths, type AnnotatedNormalization, type NormalizedPaths } from './formats/metadata.js'

// The levels in their order of severity; unknown sorts after all others.
const logLevels: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'unknown']

const levelCodes: ReadonlyMap<string, number> = new Map(logLevels.map((level, code) => [level, code]))

// The severity of a level as a small number for the store: trace 0 to fatal 5, unknown 6.
const levelCode = (level: LogLevel): number => levelCodes.get(level) ?? logLevels.length - 1

const levelOfCode = (code: number): LogLevel => logLevels[code] ?? 'unknown'

const isLogLevel = (value: unknown): value is LogLevel => typeof value === 'string' && levelCodes.has(value)

// Level names that every format knows, compared in lower case.
const commonLevelNames: Readonly<Record<string, LogLevel>> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal'
}

// The numeric levels of pino and bunyan. Other producers' numbers mean something else, so only their profiles use it.
const pinoLevelNumbers: ReadonlyMap<number, LogLevel> = new Map([
  [10, 'trace'], [20, 'debug'], [30, 'info'], [40, 'warn'], [50, 'error'], [60, 'fatal']
])

// How a format reads its records: the default paths of each normalized part, tried in order, and the format's own
// levels and timestamp unit.
interface FieldProfile {
  readonly timestamp: readonly FieldPath[]
  readonly level: readonly FieldPath[]
  readonly message: readonly FieldPath[]
  // Reads the numbers 10 to 60 as pino's and bunyan's levels.
  readonly hasNumericLevels: boolean
  // Level names of the format beyond the common ones, in lower case.
  readonly levelNames?: Readonly<Record<string, LogLevel>>
  // The unit of numeric timestamps unless the user gives one.
  readonly timestampUnit: TimestampUnit
}

// Objects that hold the fields of a record and their own text, which the plain output and the viewer show.
const genericProfile: FieldProfile = {
  timestamp: [['timestamp']],
  level: [['level']],
  message: [['message']],
  hasNumericLevels: false,
  timestampUnit: 'milliseconds'
}

// The paths of correlation identifiers when no mapping names one, in this order (plan section 5).
const correlationPaths: readonly FieldPath[] = [
  ['correlationId'], ['correlation_id'], ['requestId'], ['req', 'id'], ['trace_id'], ['traceId']
]

interface LevelOptions {
  readonly hasNumericLevels: boolean
  readonly levelNames?: Readonly<Record<string, LogLevel>> | undefined
  readonly customLevels: Readonly<Record<string, LogLevel>>
}

// A raw level as the key of the user's custom levels: numbers as decimal text, text in lower case.
const customLevelKey = (value: string | number): string => typeof value === 'number' ? String(value) : value.toLowerCase()

// The level that a table names for a key, read from the table's own keys: a raw level such as constructor, toString
// or __proto__ never reaches the members of Object.prototype.
const levelIn = (table: Readonly<Record<string, LogLevel>> | undefined, key: string): LogLevel | undefined =>
  table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined

// The level of a common level name or alias, ignoring case.
const commonLevel = (name: string): LogLevel | undefined => levelIn(commonLevelNames, name.toLowerCase())

// Normalizes a raw level: the user's custom levels first, then the format's names or numbers, then the common names,
// ignoring case. Anything else is unknown and keeps its value in the fields.
const normalizeLevel = (value: JsonValue | undefined, options: LevelOptions): LogLevel => {
  if (typeof value === 'string') {
    const key = value.toLowerCase()
    return levelIn(options.customLevels, key) ?? levelIn(options.levelNames, key) ?? levelIn(commonLevelNames, key) ?? 'unknown'
  }
  if (typeof value === 'number') {
    return levelIn(options.customLevels, customLevelKey(value)) ??
      (options.hasNumericLevels ? pinoLevelNumbers.get(value) : undefined) ??
      'unknown'
  }
  return 'unknown'
}

// The largest distance from the epoch that a JavaScript date holds, in milliseconds.
const maximumEpochMilliseconds = 8.64e15

// The power of ten from a unit to milliseconds.
const unitExponents: Readonly<Record<TimestampUnit, number>> = { seconds: 3, milliseconds: 0, microseconds: -3, nanoseconds: -6 }

const timestampUnits: readonly TimestampUnit[] = ['seconds', 'milliseconds', 'microseconds', 'nanoseconds']

// Why a timestamp is no valid time: a date without a zone, text in no known form, numeric text without an explicit
// unit, or a time beyond the range of dates.
type TimestampProblem = 'naive' | 'invalid' | 'unit' | 'range'

interface TimestampResult {
  readonly timestamp?: number
  readonly timestampText?: string
  readonly problem?: TimestampProblem
}

// RFC 3339 date and time with a zone: Z, or an offset with or without its colon or minutes; T, t or a space between
// date and time, and any number of fraction digits.
const zonedPattern = /^(\d{4})-(\d{2})-(\d{2})[ Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2})(?::?(\d{2}))?)$/
// The same without a zone, or a date alone: legacy logs such as Monolog's, whose zone is unknown.
const naivePattern = /^\d{4}-\d{2}-\d{2}(?:[ Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/
const numericTextPattern = /^([-+]?)(\d+)(?:\.(\d+))?$/

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

// Epoch milliseconds of a UTC date and time. Date.UTC reads the years 0 to 99 as 1900 to 1999, so those take a date
// object.
const utcMilliseconds = (year: number, month: number, day: number, hour: number, minute: number, second: number): number => {
  if (year >= 100) {
    return Date.UTC(year, month - 1, day, hour, minute, second)
  }
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  return date.getTime()
}

// A decimal fraction as a number in [0, 1).
const fractionOf = (digits: string | undefined): number => digits === undefined ? 0 : Number(`0.${digits}`)

const isWithinRange = (milliseconds: number): boolean => Number.isFinite(milliseconds) && Math.abs(milliseconds) <= maximumEpochMilliseconds

// The usual form 2026-10-11T10:00:00.000Z, which JSON loggers write, character by character; 0 stands for a digit.
const canonicalForm = '0000-00-00T00:00:00.000Z'
const zeroCode = 48
const nineCode = 57

// The decimal number of the digits at a position, which the caller has checked.
const digitsAt = (text: string, index: number, count: number): number => {
  let value = 0
  for (let offset = index; offset < index + count; offset += 1) {
    value = value * 10 + (text.codePointAt(offset) ?? zeroCode) - zeroCode
  }
  return value
}

// Whether text has the usual form, checked without a regular expression.
const hasCanonicalForm = (text: string): boolean => {
  if (text.length !== canonicalForm.length) {
    return false
  }
  for (let index = 0; index < canonicalForm.length; index += 1) {
    const expected = canonicalForm.codePointAt(index)
    const actual = text.codePointAt(index) ?? 0
    if (expected === zeroCode ? actual < zeroCode || actual > nineCode : actual !== expected) {
      return false
    }
  }
  return true
}

// Reads the usual form: epoch milliseconds, NaN for a date or time that does not exist, or undefined for text of
// another form.
const parseCanonicalTime = (text: string): number | undefined => {
  if (!hasCanonicalForm(text)) {
    return undefined
  }
  const year = digitsAt(text, 0, 4)
  const month = digitsAt(text, 5, 2)
  const day = digitsAt(text, 8, 2)
  const hour = digitsAt(text, 11, 2)
  const minute = digitsAt(text, 14, 2)
  const second = digitsAt(text, 17, 2)
  const isInvalid = month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 60
  return isInvalid ? NaN : utcMilliseconds(year, month, day, hour, minute, second) + digitsAt(text, 20, 3)
}

// Parses RFC 3339 text with a zone into epoch milliseconds with the full fraction; a calendar date that does not
// exist, such as 30 February or 24:00, gives undefined.
const parseZonedTime = (text: string): number | undefined => {
  const canonical = parseCanonicalTime(text)
  if (canonical !== undefined) {
    return Number.isNaN(canonical) ? undefined : canonical
  }
  const match = zonedPattern.exec(text)
  if (match === null) {
    return undefined
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, sign, offsetHourText = '0', offsetMinuteText = '0'] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  // 60 is a leap second, which RFC 3339 allows; it counts as the first second of the next minute.
  const second = Number(secondText)
  const offsetHours = Number(offsetHourText)
  const offsetMinutes = Number(offsetMinuteText)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 60 ||
    offsetHours > 23 || offsetMinutes > 59) {
    return undefined
  }
  const offset = (sign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000
  return utcMilliseconds(year, month, day, hour, minute, second) + fractionOf(fraction) * 1000 - offset
}

// Converts decimal text in a unit to milliseconds. The whole part goes through BigInt, so that nanosecond text keeps
// its precision until it is reduced to milliseconds.
const parseNumericText = (match: RegExpExecArray, unit: TimestampUnit): number => {
  const [, sign, whole = '0', fraction] = match
  const exponent = unitExponents[unit]
  let milliseconds: number
  if (exponent >= 0) {
    const scale = 10 ** exponent
    milliseconds = Number(BigInt(whole) * BigInt(scale)) + fractionOf(fraction) * scale
  } else {
    const divisor = 10n ** BigInt(-exponent)
    const value = BigInt(whole)
    milliseconds = Number(value / divisor) + (Number(value % divisor) + fractionOf(fraction)) / Number(divisor)
  }
  return sign === '-' ? -milliseconds : milliseconds
}

interface TimestampOptions {
  // The unit of numbers, the user's or the format's.
  readonly unit: TimestampUnit
  // Whether the user gave the unit, which numeric text needs.
  readonly isUnitExplicit: boolean
}

// The longest text that a structured message or timestamp becomes; the fields keep the whole value.
const maximumValueText = 4096

// JSON text of a value, cut after the limit with an ellipsis.
const boundedJson = (value: JsonValue): string => {
  const text = JSON.stringify(value)
  return text.length > maximumValueText ? `${text.slice(0, maximumValueText)}…` : text
}

// Text for a value that is no time, bounded like a message.
const valueText = (value: JsonValue): string => typeof value === 'string' ? value : boundedJson(value)

// Normalizes a raw timestamp (plan section 5): numbers in the unit, RFC 3339 text with a zone, and numeric text only
// with an explicit unit. A naive or unparseable value keeps its text, for display, and its problem, for one aggregated
// warning; units are never guessed from the number of digits, and naive text never gets a zone.
const normalizeTimestamp = (value: JsonValue | undefined, options: TimestampOptions): TimestampResult => {
  if (value === undefined || value === null) {
    return {}
  }
  if (typeof value === 'number') {
    const milliseconds = value * 10 ** unitExponents[options.unit]
    return isWithinRange(milliseconds) ? { timestamp: milliseconds } : { timestampText: String(value), problem: 'range' }
  }
  if (typeof value !== 'string') {
    return { timestampText: valueText(value), problem: 'invalid' }
  }
  const zoned = parseZonedTime(value)
  if (zoned !== undefined) {
    return isWithinRange(zoned) ? { timestamp: zoned } : { timestampText: value, problem: 'range' }
  }
  const numeric = numericTextPattern.exec(value)
  if (numeric !== null) {
    if (!options.isUnitExplicit) {
      return { timestampText: value, problem: 'unit' }
    }
    const milliseconds = parseNumericText(numeric, options.unit)
    return isWithinRange(milliseconds) ? { timestamp: milliseconds } : { timestampText: value, problem: 'range' }
  }
  return { timestampText: value, problem: naivePattern.test(value) ? 'naive' : 'invalid' }
}

// A message is text: text as it is, numbers and booleans as their text, objects and arrays as bounded JSON, and
// nothing or null as empty text.
const messageOf = (value: JsonValue | undefined): string => {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  return typeof value === 'object' ? boundedJson(value) : String(value)
}

// A correlation identifier is non-empty text or a number, which becomes text so that 0 stays an identifier.
const correlationOf = (value: JsonValue | undefined): string | undefined => {
  if (typeof value === 'string') {
    return value === '' ? undefined : value
  }
  return typeof value === 'number' ? String(value) : undefined
}

const timestampProblemMessages: Readonly<Record<TimestampProblem, (text: string) => string>> = {
  naive: text => `the timestamp ${text} has no zone; it is shown as text and sorts last`,
  invalid: text => `the timestamp ${text} is no time that jlv reads; it is shown as text and sorts last`,
  unit: text => `the timestamp ${text} is numeric text; --timestamp-unit tells jlv its unit`,
  range: text => `the timestamp ${text} is outside the range of dates; it is shown as text and sorts last`
}

const warning = (code: string, message: string): ParseDiagnostic => ({ kind: 'diagnostic', severity: 'warning', code, message })

type Part = 'timestamp' | 'level' | 'message' | 'correlationIdentifier'

const partNames: Readonly<Record<Part, string>> = {
  timestamp: 'timestamp',
  level: 'level',
  message: 'message',
  correlationIdentifier: 'correlation identifier'
}

// The value at a path of a record. One segment, the usual case, needs no loop.
const fieldAt = (value: JsonObject, path: FieldPath): JsonValue | undefined => {
  if (path.length !== 1) {
    return valueAtPath(value, path)
  }
  const [segment] = path
  const key = typeof segment === 'string' ? segment : String(segment)
  return Object.hasOwn(value, key) ? value[key] : undefined
}

// The first path of the candidates that a record has, and its value.
interface Lookup {
  path: FieldPath | undefined
  value: JsonValue | undefined
}

const lookUp = (value: JsonObject, candidates: readonly FieldPath[], lookup: Lookup): void => {
  lookup.path = undefined
  lookup.value = undefined
  for (const path of candidates) {
    const found = fieldAt(value, path)
    if (found !== undefined) {
      lookup.path = path
      lookup.value = found
      return
    }
  }
}

type MutableDraft = { -readonly [Key in keyof LogDraft]: LogDraft[Key] }

type MutablePaths = { -readonly [Key in keyof NormalizedPaths]: NormalizedPaths[Key] }

// Normalizes a record by its profile and the user's mapping. An explicit mapping wins over the profile's defaults
// and warns when the record lacks the field; missing optional parts are simply absent. The result names the paths that
// the timestamp, the level and the message came from.
const normalizeFields = (value: JsonObject, profile: FieldProfile, context: FormatContext): AnnotatedNormalization => {
  let diagnostics: ParseDiagnostic[] | undefined
  const paths: MutablePaths = {}
  const { mapping } = context
  const lookup: Lookup = { path: undefined, value: undefined }
  // Looks up a part by its explicit path or its default paths, and gives its value.
  const part = (name: Part, defaults: readonly FieldPath[]): JsonValue | undefined => {
    const explicit = mapping[name]
    lookUp(value, explicit === undefined ? defaults : [explicit], lookup)
    if (name !== 'correlationIdentifier' && lookup.path !== undefined) {
      paths[name] = lookup.path
    } else if (explicit !== undefined && lookup.path === undefined) {
      diagnostics ??= []
      diagnostics.push(warning('mapping-missing', `no field at ${formatPath(explicit)} for the ${partNames[name]}`))
    }
    return lookup.value
  }
  const rawTimestamp = part('timestamp', profile.timestamp)
  const rawLevel = part('level', profile.level)
  const rawMessage = part('message', profile.message)
  const rawCorrelation = part('correlationIdentifier', correlationPaths)
  const unit = context.timestampUnit ?? profile.timestampUnit
  const time = normalizeTimestamp(rawTimestamp, { unit, isUnitExplicit: context.timestampUnit !== undefined })
  const draft: MutableDraft = {
    level: normalizeLevel(rawLevel, {
      hasNumericLevels: profile.hasNumericLevels,
      levelNames: profile.levelNames,
      customLevels: context.levels
    }),
    message: messageOf(rawMessage),
    fields: value
  }
  if (time.timestamp !== undefined) {
    draft.timestamp = time.timestamp
  }
  if (time.timestampText !== undefined) {
    draft.timestampText = time.timestampText
  }
  if (time.problem !== undefined) {
    const message = timestampProblemMessages[time.problem](JSON.stringify(time.timestampText))
    diagnostics ??= []
    diagnostics.push(warning(`timestamp-${time.problem}`, message))
  }
  const correlationIdentifier = correlationOf(rawCorrelation)
  if (correlationIdentifier !== undefined) {
    draft.correlationIdentifier = correlationIdentifier
  }
  return { record: draft, diagnostics: diagnostics ?? [], [normalizedPaths]: paths }
}

// Why parsed JSON is no record value: a number beyond the range of doubles, such as 1e400, or more nesting than
// allowed.
type JsonProblem = 'number-out-of-range' | 'too-deep' | 'not-json'

// The nesting of objects and arrays that a record may have, the record itself included (plan section 5).
const maximumJsonDepth = 64

// Checks a value as JSON: every number finite, at most `depth` levels of objects and arrays, and nothing but text,
// numbers, booleans, null, arrays and objects. JSON.parse gives only the last kind of values; plugins may give others.
const jsonProblem = (value: unknown, depth: number = maximumJsonDepth): JsonProblem | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : 'number-out-of-range'
  }
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
    return undefined
  }
  if (typeof value !== 'object') {
    return 'not-json'
  }
  if (depth <= 0) {
    return 'too-deep'
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const problem = jsonProblem(child, depth - 1)
      if (problem !== undefined) {
        return problem
      }
    }
    return undefined
  }
  // JSON.parse gives objects with own enumerable properties only, which for...in visits without a copy.
  for (const key in value) {
    const problem = jsonProblem(Reflect.get(value, key), depth - 1)
    if (problem !== undefined) {
      return problem
    }
  }
  return undefined
}

// An object of parsed JSON: neither an array nor null.
const isPlainObject = (value: unknown): value is object => typeof value === 'object' && value !== null && !Array.isArray(value)

// The value as a JSON object once isPlainObject and jsonProblem accepted it; JSON.parse gives only JSON values.
const asJsonObject = (value: object): JsonObject => value as JsonObject

const emptyMapping: FieldMapping = {}

export {
  asJsonObject, boundedJson, commonLevel, commonLevelNames, correlationOf, correlationPaths, emptyMapping, genericProfile,
  isLogLevel, isPlainObject, jsonProblem, levelCode, levelOfCode, logLevels, maximumJsonDepth, messageOf,
  normalizeFields, normalizeLevel, normalizeTimestamp, timestampUnits
}
export type { FieldProfile, JsonProblem, TimestampProblem, TimestampResult }
