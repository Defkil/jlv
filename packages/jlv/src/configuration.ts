// Configuration (plan section 6.3): one file per run, read and validated once, and passed on explicitly. Nothing is
// written to the home directory, and no configuration is code: JSON and INI are data only.
//
// Precedence: command line options > the file of --config (which must exist) > the first file that discovery finds >
// defaults. Discovery looks for jlv.config.json and then the legacy .json-log-viewer, first in the working directory
// and then in the home directory, and takes the first that exists; it never merges a home file under a project file.
// --no-config turns discovery off.
//
// jlv.config.json, version 1, holds the format, the mapping of the normalized parts as lists of path segments, the
// unit of numeric timestamps, custom level names, the CSV delimiter, the store's limits and named filter profiles.
// Unknown keys are errors, with the nearest known key as a hint. The legacy INI file maps the normalized parts in its
// [transform] section (timestamp, level, message and correlationId) and shows every other key in the viewer's details,
// as upstream did: $ for the whole record, any other value for a path in lodash's grammar. INI paths are split into
// segments once, so a key that contains a dot needs brackets there, such as ["log.level"].
import fs from 'node:fs'
import path from 'node:path'
import ini from 'ini'
import type { FieldMapping, FieldPath, FilterClause, FilterGroup, JsonValue, LogLevel, TimestampUnit } from './api.js'
import { parsePath } from './field-path.js'
import { isCsvDelimiter } from './formats/csv.js'
import { asJsonObject, isLogLevel, isPlainObject, jsonProblem, logLevels, timestampUnits } from './record.js'
import type { LegacyExtra } from './tui/log-row.js'

// A configuration that cannot be used; the command line reports it with exit code 2 before it opens a screen.
class ConfigurationError extends Error {
  constructor (message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConfigurationError'
  }
}

// A legacy mapping: the paths of the normalized parts and the extra fields of the details in their order.
interface LegacyMapping {
  readonly mapping: FieldMapping
  readonly extras: ReadonlyMap<string, LegacyExtra>
}

// What a run takes from its configuration file; everything is optional, and a run without a file has none of it.
interface Configuration {
  // The file that was read, and whether it is JSON or legacy INI.
  readonly file?: string
  readonly kind?: 'json' | 'ini'
  readonly format?: string
  readonly mapping: FieldMapping
  // The extra keys of a legacy mapping, which the viewer's details show instead of the record's other fields.
  readonly legacyExtras?: ReadonlyMap<string, LegacyExtra>
  readonly timestampUnit?: TimestampUnit
  readonly levels: Readonly<Record<string, LogLevel>>
  readonly csvDelimiter?: string
  readonly maximumRecords?: number
  readonly maximumBytes?: number
  readonly profiles: Readonly<Record<string, FilterGroup>>
}

interface ConfigurationOptions {
  readonly workingDirectory: string
  readonly home: string
  // The file of --config, as given.
  readonly file?: string | undefined
  // --no-config: no discovery.
  readonly isDiscoveryDisabled?: boolean
}

const noConfiguration: Configuration = { mapping: {}, levels: {}, profiles: {} }

const jsonFileName = 'jlv.config.json'
const legacyFileName = '.json-log-viewer'

type Section = Readonly<Record<string, unknown>>

// An INI section: ini 6 returns sections as objects without a prototype, and other values as text, booleans, null
// or lists.
const isSection = (value: unknown): value is Section => typeof value === 'object' && value !== null && !Array.isArray(value)

// The keys of a [transform] section that map normalized parts, and the parts they map.
const legacyParts: Readonly<Record<string, keyof FieldMapping>> = {
  timestamp: 'timestamp',
  level: 'level',
  message: 'message',
  correlationId: 'correlationIdentifier'
}

// Text without a dot or a bracket pair is one key, as lodash.get read it; anything else is a path.
const deepPathPattern = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/
const plainKeyPattern = /^\w*$/

// The segments of a legacy path: INI text in lodash's grammar, true, false and null by their text, or a key[]= list
// element by element.
const legacyPath = (value: unknown): FieldPath => {
  if (Array.isArray(value)) {
    return value.map(String)
  }
  const text = String(value)
  return plainKeyPattern.test(text) || !deepPathPattern.test(text) ? [text] : parsePath(text)
}

// Reads the [transform] section of a legacy configuration; without one there is no mapping.
const readLegacyMapping = (text: string, label: string): LegacyMapping | undefined => {
  const parsed: unknown = ini.parse(text)
  // Only a [transform] section maps fields; a top-level transform key is no mapping.
  const section = isSection(parsed) ? parsed['transform'] : undefined
  if (!isSection(section)) {
    return undefined
  }
  const mapping: Record<string, FieldPath> = {}
  const extras = new Map<string, LegacyExtra>()
  for (const [key, value] of Object.entries(section)) {
    const part = Object.hasOwn(legacyParts, key) ? legacyParts[key] : undefined
    if (part !== undefined) {
      if (value === '$' || isSection(value)) {
        throw new ConfigurationError(`${label}: [transform] ${key} needs the path of a field; only additional keys take $ or a section`)
      }
      mapping[part] = legacyPath(value)
      continue
    }
    if (value === '$') {
      extras.set(key, { kind: 'record' })
    } else if (isSection(value)) {
      // A nested section such as [transform.extra] names no field.
      extras.set(key, { kind: 'none' })
    } else {
      extras.set(key, { kind: 'path', path: Array.isArray(value) ? value.map(String) : String(value) })
    }
  }
  return { mapping, extras }
}

// The number of single-character edits from one text to another, for hints.
const editDistance = (left: string, right: string): number => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1]
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitution = left.charAt(leftIndex) === right.charAt(rightIndex) ? 0 : 1
      current.push(Math.min((previous[rightIndex + 1] ?? 0) + 1, (current[rightIndex] ?? 0) + 1, (previous[rightIndex] ?? 0) + substitution))
    }
    previous = current
  }
  return previous[right.length] ?? 0
}

// Validates the parsed JSON of a configuration file; every problem names the file and the place.
class JsonReader {
  readonly #label: string

  constructor (label: string) {
    this.#label = label
  }

  fail (place: string, message: string): never {
    throw new ConfigurationError(`${this.#label}: ${place} ${message}`)
  }

  object (value: unknown, place: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
    if (!isPlainObject(value)) {
      return this.fail(place, 'must be an object')
    }
    for (const key of Object.keys(value)) {
      if (keys.includes(key)) {
        continue
      }
      const nearest = keys.toSorted((left, right) => editDistance(key, left) - editDistance(key, right))[0]
      const hint = nearest !== undefined && editDistance(key, nearest) <= 2 ? ` (did you mean ${nearest}?)` : ''
      this.fail(place, `has the unknown key ${JSON.stringify(key)}${hint}. Known keys: ${keys.join(', ')}`)
    }
    return asJsonObject(value)
  }

  // An object whose keys are names chosen by the user.
  record (value: unknown, place: string): Readonly<Record<string, unknown>> {
    return isPlainObject(value) ? asJsonObject(value) : this.fail(place, 'must be an object')
  }

  text (value: unknown, place: string): string {
    return typeof value === 'string' ? value : this.fail(place, 'must be text')
  }

  limit (value: unknown, place: string): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 0xFF_FF_FF_FF
      ? value
      : this.fail(place, 'must be a whole number from 1 to 4294967295')
  }

  path (value: unknown, place: string): FieldPath {
    if (typeof value === 'string') {
      const segments = JSON.stringify(value.split('.'))
      return this.fail(place, `must be a list of keys and indexes, such as ${segments} for ${JSON.stringify(value)}`)
    }
    if (!Array.isArray(value) || value.length === 0) {
      return this.fail(place, 'must be a list of keys and indexes, such as ["datetime", "date"]')
    }
    const segments: (string | number)[] = []
    for (const [index, segment] of value.entries()) {
      if (typeof segment === 'string' || (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0)) {
        segments.push(segment)
      } else {
        this.fail(`${place}[${String(index)}]`, 'must be a key or an index, which is a whole number from 0')
      }
    }
    return segments
  }

  oneOf<T extends string> (value: unknown, place: string, choices: readonly T[]): T {
    const choice = choices.find(candidate => candidate === value)
    return choice ?? this.fail(place, `must be one of ${choices.join(', ')}`)
  }

  clause (value: unknown, place: string): FilterClause {
    const clause = this.object(value, place, ['field', 'operator', 'value'])
    const field = this.path(clause['field'], `${place}.field`)
    const operator = this.oneOf(clause['operator'], `${place}.operator`, ['equals', 'contains'] as const)
    const operand = clause['value']
    if (operator === 'contains') {
      return { field, operator, value: this.text(operand, `${place}.value`) }
    }
    return operand === undefined || jsonProblem({ value: operand }) !== undefined
      ? this.fail(`${place}.value`, 'must be a JSON value')
      : { field, operator, value: operand as JsonValue }
  }

  profile (value: unknown, place: string): FilterGroup {
    const profile = this.object(value, place, ['mode', 'clauses'])
    const mode = this.oneOf(profile['mode'], `${place}.mode`, ['all', 'any'] as const)
    const clauses = profile['clauses']
    return Array.isArray(clauses)
      ? { mode, clauses: clauses.map((clause: unknown, index) => this.clause(clause, `${place}.clauses[${String(index)}]`)) }
      : this.fail(`${place}.clauses`, 'must be a list of clauses')
  }
}

const configurationKeys = ['$schema', 'version', 'format', 'mapping', 'timestampUnit', 'levels', 'csv', 'maxRecords', 'maxBytes', 'profiles']
const mappingKeys = ['timestamp', 'level', 'message', 'correlationIdentifier'] as const

// Reads a jlv.config.json of version 1.
const readJsonConfiguration = (text: string, label: string): Configuration => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ConfigurationError(`${label} is no valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const reader = new JsonReader(label)
  const root = reader.object(parsed, 'the configuration', configurationKeys)
  if (root['version'] !== 1) {
    reader.fail('version', 'must be 1')
  }
  const mutable: {
    -readonly [Key in keyof Configuration]: Configuration[Key]
  } = { file: label, kind: 'json', mapping: {}, levels: {}, profiles: {} }
  if (root['$schema'] !== undefined) {
    reader.text(root['$schema'], '$schema')
  }
  if (root['format'] !== undefined) {
    mutable.format = reader.text(root['format'], 'format')
  }
  if (root['mapping'] !== undefined) {
    const mapping = reader.object(root['mapping'], 'mapping', mappingKeys)
    const paths: { -readonly [Key in keyof FieldMapping]: FieldPath } = {}
    for (const key of mappingKeys) {
      if (mapping[key] !== undefined) {
        paths[key] = reader.path(mapping[key], `mapping.${key}`)
      }
    }
    mutable.mapping = paths
  }
  if (root['timestampUnit'] !== undefined) {
    mutable.timestampUnit = reader.oneOf(root['timestampUnit'], 'timestampUnit', timestampUnits)
  }
  // Object.fromEntries defines own properties, so a name such as __proto__ is a key like any other.
  if (root['levels'] !== undefined) {
    const entries = Object.entries(reader.record(root['levels'], 'levels'))
    mutable.levels = Object.fromEntries(entries.map(([raw, level]): [string, LogLevel] =>
      [raw.toLowerCase(), isLogLevel(level) ? level : reader.fail(`levels.${raw}`, `must be one of ${logLevels.join(', ')}`)]))
  }
  if (root['csv'] !== undefined) {
    const csv = reader.object(root['csv'], 'csv', ['delimiter'])
    if (csv['delimiter'] !== undefined) {
      const delimiter = reader.text(csv['delimiter'], 'csv.delimiter')
      mutable.csvDelimiter = isCsvDelimiter(delimiter) ? delimiter : reader.fail('csv.delimiter', 'must be one ASCII character other than a quote')
    }
  }
  if (root['maxRecords'] !== undefined) {
    mutable.maximumRecords = reader.limit(root['maxRecords'], 'maxRecords')
  }
  if (root['maxBytes'] !== undefined) {
    mutable.maximumBytes = reader.limit(root['maxBytes'], 'maxBytes')
  }
  if (root['profiles'] !== undefined) {
    const entries = Object.entries(reader.record(root['profiles'], 'profiles'))
    mutable.profiles = Object.fromEntries(entries.map(([name, profile]) => [name, reader.profile(profile, `profiles.${name}`)]))
  }
  return mutable
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

// A configuration file is JSON by its extension, or by text that starts with {; anything else is legacy INI.
const isJsonText = (file: string, text: string): boolean =>
  path.extname(file).toLowerCase() === '.json' || text.replace(/^\u{FEFF}/u, '').trimStart().startsWith('{')

const readConfigurationFile = (file: string, label: string): Configuration => {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new ConfigurationError(`cannot read the configuration file ${label}: ${errorMessage(error)}`, { cause: error })
  }
  if (isJsonText(file, text)) {
    return readJsonConfiguration(text, label)
  }
  const legacy = readLegacyMapping(text, label)
  return legacy === undefined
    ? { ...noConfiguration, file: label, kind: 'ini' }
    : { ...noConfiguration, file: label, kind: 'ini', mapping: legacy.mapping, legacyExtras: legacy.extras }
}

// The configuration files that discovery looks for, in their order.
const discoveryCandidates = (options: ConfigurationOptions): readonly string[] => [
  path.join(options.workingDirectory, jsonFileName),
  path.join(options.workingDirectory, legacyFileName),
  path.join(options.home, jsonFileName),
  path.join(options.home, legacyFileName)
]

// How the status line names a file: relative to the working directory when it is inside it.
const fileLabel = (file: string, workingDirectory: string): string => {
  const relative = path.relative(workingDirectory, file)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file
}

// Reads the run's configuration: the file of --config, or the first file that discovery finds, or none.
const loadConfiguration = (options: ConfigurationOptions): Configuration => {
  if (options.file !== undefined) {
    if (options.isDiscoveryDisabled === true) {
      throw new ConfigurationError('--config and --no-config exclude each other')
    }
    const file = path.resolve(options.workingDirectory, options.file)
    if (!fs.existsSync(file)) {
      throw new ConfigurationError(`the configuration file ${options.file} does not exist`)
    }
    return readConfigurationFile(file, options.file)
  }
  if (options.isDiscoveryDisabled === true) {
    return noConfiguration
  }
  const found = discoveryCandidates(options).find(candidate => fs.existsSync(candidate))
  return found === undefined ? noConfiguration : readConfigurationFile(found, fileLabel(found, options.workingDirectory))
}

export {
  ConfigurationError, discoveryCandidates, legacyPath, loadConfiguration, noConfiguration, readJsonConfiguration,
  readLegacyMapping
}
export type { Configuration, ConfigurationOptions, LegacyMapping }
