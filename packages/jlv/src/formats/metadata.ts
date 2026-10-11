// Facts that the built-in formats attach to their results under private symbols. Plugins cannot forge them; a value
// without them is handled the general way.
import type { FieldPath, JsonObject, LinePosition, NormalizationResult, ParsedEntry } from '../api.js'

// The JSON text of an entry as it was read, which the store keeps instead of serializing the value again.
const encodedJson: unique symbol = Symbol('jlv.encodedJson')

// The paths that normalization read the timestamp, the level and the message from. The viewer's details leave their
// top-level keys out, since its columns show them, and an unknown level shows its raw value.
const normalizedPaths: unique symbol = Symbol('jlv.normalizedPaths')

interface EncodedEntry extends ParsedEntry {
  readonly [encodedJson]: Uint8Array
}

interface NormalizedPaths {
  readonly timestamp?: FieldPath
  readonly level?: FieldPath
  readonly message?: FieldPath
}

interface AnnotatedNormalization extends NormalizationResult {
  readonly [normalizedPaths]: NormalizedPaths
}

const encodedEntry = (value: JsonObject, position: LinePosition, json: Uint8Array): EncodedEntry =>
  ({ kind: 'entry', value, position, [encodedJson]: json })

// The UTF-8 JSON text of an entry: the bytes a built-in reader parsed, or the value serialized.
const entryJson = (entry: ParsedEntry): Uint8Array => {
  const json: unknown = Reflect.get(entry, encodedJson)
  return json instanceof Uint8Array ? json : Buffer.from(JSON.stringify(entry.value), 'utf8')
}

const noPaths: NormalizedPaths = {}

// The paths of a built-in format's result, or none for a plugin's.
const normalizedPathsOf = (result: NormalizationResult): NormalizedPaths => {
  const paths: unknown = Reflect.get(result, normalizedPaths)
  return typeof paths === 'object' && paths !== null ? paths : noPaths
}

// The top-level keys of the paths: a path of one segment names a key that a column shows.
const consumedKeysOf = (paths: NormalizedPaths): string[] => {
  const keys: string[] = []
  for (const path of [paths.timestamp, paths.level, paths.message]) {
    const [key] = path ?? []
    if (key !== undefined && path?.length === 1) {
      keys.push(String(key))
    }
  }
  return keys
}

export { consumedKeysOf, encodedEntry, encodedJson, entryJson, normalizedPaths, normalizedPathsOf }
export type { AnnotatedNormalization, EncodedEntry, NormalizedPaths }
