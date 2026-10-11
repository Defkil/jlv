// Successor of upstream src/log.js: reads a whole JSON-lines file into the legacy rows of the viewer and applies the
// [transform] mapping from ~/.json-log-viewer. Streaming input and the final record model replace it in later phases.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ini from 'ini'
import lodash from 'lodash'

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

const entryFields = ['timestamp', 'level', 'message'] as const

interface TransformCache {
  // The [transform] section once found, undefined before.
  mapping: unknown
}

// Like upstream, a missing file or section is looked up again for the next record, and a found section stays for
// the rest of the process.
const transformCache: TransformCache = { mapping: undefined }

const loadTransform = (fileSystem: ConfigFileSystem): unknown => {
  if (transformCache.mapping === undefined) {
    const transformFile = path.join(os.homedir(), '.json-log-viewer')
    if (!fileSystem.existsSync(transformFile)) {
      return undefined
    }
    const contents = fileSystem.readFileSync(transformFile, 'utf8')
    const { transform: mapping }: { readonly transform?: unknown } = ini.parse(contents)
    if (!mapping) {
      return undefined
    }
    transformCache.mapping = mapping
  }
  return transformCache.mapping
}

// The path of a mapping value as lodash.get resolves it. INI values are text unless written as true, false, null or
// key[]= lists; lodash reads the other values and every list element by their text form.
const propertyPath = (value: unknown): string | string[] =>
  Array.isArray(value) ? value.map(String) : String(value)

const transform = (entry: unknown, fileSystem: ConfigFileSystem = fs): unknown => {
  const mapping = loadTransform(fileSystem)
  if (!mapping) {
    return entry
  }

  const mapped: Record<string, unknown> = {}
  const fields: [string, unknown][] = Object.entries(mapping)
  for (const [key, value] of fields) {
    // $ copies the whole record; any other value is a lodash path into it. structuredClone copies parsed JSON the
    // way upstream's lodash.cloneDeep did.
    mapped[key] = value === '$' ? structuredClone(entry) : lodash.get(entry, propertyPath(value))
  }
  return mapped
}

const parse = (line: string): unknown => {
  try {
    return transform(JSON.parse(line))
  } catch {
    // An invalid line, or a configuration that cannot be read, drops the line.
    return undefined
  }
}

const readLog = (file: string, reader: LogReader = fs): LogEntry[] => {
  const contents = reader.readFileSync(file).toString()
  const lines = lodash.compact(contents.split('\n').filter(Boolean).map(line => parse(line)))

  return lines.map(line => {
    const fields = lodash.pick(line, entryFields)
    // lodash reads a value other than an object through its wrapper: text gives one field per character.
    const data: Readonly<Record<string, unknown>> = lodash.omit(new Object(line), entryFields)
    return { ...fields, data }
  })
}

export { readLog, transform }
export type { ConfigFileSystem, LogEntry, LogReader }
