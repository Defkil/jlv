// Successor of upstream src/log.js: reads a whole JSON-lines file into the legacy rows of the viewer and applies the
// [transform] mapping from ~/.json-log-viewer. Streaming input and the final record model replace it in later phases.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ini from 'ini'
import { valueAtField } from './field-path.js'

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

const entryFields = ['timestamp', 'level', 'message'] as const

interface TransformCache {
  // The [transform] section once found, undefined before.
  mapping: Mapping | undefined
}

// Like upstream, a missing file or section is looked up again for the next record, and a found section stays for
// the rest of the process.
const transformCache: TransformCache = { mapping: undefined }

// An INI section: ini 6 returns sections as objects without a prototype, and other values as text, booleans, null
// or lists.
const isSection = (value: unknown): value is Mapping => typeof value === 'object' && value !== null && !Array.isArray(value)

const loadTransform = (fileSystem: ConfigFileSystem): Mapping | undefined => {
  if (transformCache.mapping === undefined) {
    const transformFile = path.join(os.homedir(), '.json-log-viewer')
    if (!fileSystem.existsSync(transformFile)) {
      return undefined
    }
    const parsed: unknown = ini.parse(fileSystem.readFileSync(transformFile, 'utf8'))
    // Only a [transform] section maps fields; a top-level transform key is no mapping.
    const mapping = isSection(parsed) ? parsed['transform'] : undefined
    if (!isSection(mapping)) {
      return undefined
    }
    transformCache.mapping = mapping
  }
  return transformCache.mapping
}

// The path of a mapping value as lodash.get resolved it: INI text, true, false and null by their text form, key[]=
// lists element by element. A nested section such as [transform.extra] names no field.
const mappingPath = (value: unknown): string | readonly string[] | undefined => {
  if (Array.isArray(value)) {
    return value.map(String)
  }
  return isSection(value) ? undefined : String(value)
}

const transform = (entry: unknown, fileSystem: ConfigFileSystem = fs): unknown => {
  const mapping = loadTransform(fileSystem)
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

const parse = (line: string): unknown => {
  try {
    return transform(JSON.parse(line))
  } catch {
    // An invalid line, or a configuration that cannot be read, drops the line.
    return undefined
  }
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

const readLog = (file: string, reader: LogReader = fs): LogEntry[] => {
  const contents = reader.readFileSync(file).toString()
  return contents.split('\n').filter(Boolean).map(line => parse(line)).filter(Boolean).map(line => toEntry(line))
}

export { readLog, transform }
export type { ConfigFileSystem, LogEntry, LogReader }
