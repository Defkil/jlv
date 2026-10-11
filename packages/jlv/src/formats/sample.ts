// What probes look at in a sample: its lines, and the lines that are JSON objects. Each sample is split and parsed
// once, however many formats probe it.
import type { FormatSample, JsonObject } from '../api.js'
import { asJsonObject, isPlainObject, jsonProblem } from '../record.js'

interface SampleLines {
  // The lines that hold more than white space, without their line endings.
  readonly lines: readonly string[]
  // The lines that are JSON objects, parsed; a sample of other lines has none.
  readonly objects: readonly JsonObject[]
}

const analyses = new WeakMap<FormatSample, SampleLines>()

const parseObject = (line: string): JsonObject | undefined => {
  if (!line.trimStart().startsWith('{')) {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(line)
    return isPlainObject(value) && jsonProblem(value) === undefined ? asJsonObject(value) : undefined
  } catch {
    return undefined
  }
}

const analyze = (sample: FormatSample): SampleLines => {
  const known = analyses.get(sample)
  if (known !== undefined) {
    return known
  }
  const lines = sample.text.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line).filter(line => line.trim() !== '')
  const objects: JsonObject[] = []
  for (const line of lines) {
    const object = parseObject(line)
    if (object !== undefined) {
      objects.push(object)
    }
  }
  const analysis = { lines, objects }
  analyses.set(sample, analysis)
  return analysis
}

const sampleLines = (sample: FormatSample): readonly string[] => analyze(sample).lines

const sampleObjects = (sample: FormatSample): readonly JsonObject[] => analyze(sample).objects

// A score from 0 to the maximum for the share of the sample's records that fit.
const shareScore = (matching: number, total: number, maximum: number): number =>
  total === 0 ? 0 : Math.round(maximum * matching / total)

export { sampleLines, sampleObjects, shareScore }
