// Facts that the built-in formats attach to their results under private symbols. Plugins cannot forge them; a value
// without them is handled the general way.
import type { FieldPath, JsonObject, LinePosition, NormalizationResult, ParsedEntry } from '../api.js'

// The JSON text of an entry as it was read, which the store keeps instead of serializing the value again.
const encodedJson: unique symbol = Symbol('jlv.encodedJson')

// The paths that normalization read the timestamp, the level and the message from. The viewer's details leave these
// fields out, since its columns show them, and an unknown level shows its raw value.
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

// The paths of the fields that the columns show.
const consumedPathsOf = (paths: NormalizedPaths): FieldPath[] =>
  [paths.timestamp, paths.level, paths.message].filter((path): path is FieldPath => path !== undefined && path.length > 0)

export { consumedPathsOf, encodedEntry, encodedJson, entryJson, normalizedPaths, normalizedPathsOf }
export type { AnnotatedNormalization, EncodedEntry, NormalizedPaths }
