// Configuration (plan section 6.3). This module reads the legacy [transform] mapping of upstream's ~/.json-log-viewer:
// the keys timestamp, level, message and correlationId map the normalized parts, and every other key is an extra
// field of the viewer's details, as upstream showed it: $ for the whole record, any other value for a path in lodash's
// grammar. Paths are split into segments once; a key that contains a dot needs brackets, such as ["log.level"].
import fs from 'node:fs'
import path from 'node:path'
import ini from 'ini'
import type { FieldMapping, FieldPath } from './api.js'
import { parsePath } from './field-path.js'
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

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

// The legacy mapping of ~/.json-log-viewer, read once per run. A file that exists but cannot be read is an error.
const readHomeMapping = (home: string): LegacyMapping | undefined => {
  const file = path.join(home, '.json-log-viewer')
  if (!fs.existsSync(file)) {
    return undefined
  }
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new ConfigurationError(`cannot read the mapping file ${file}: ${errorMessage(error)}`, { cause: error })
  }
  return readLegacyMapping(text, file)
}

export { ConfigurationError, legacyPath, readHomeMapping, readLegacyMapping }
export type { LegacyMapping }
