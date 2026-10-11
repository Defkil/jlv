// Docker's json-file envelopes (plan section 6.2): one JSON object per line with the container's output in log, the
// stream stdout or stderr, and the time at which Docker received it. The output of `docker logs` itself has no envelope
// and goes to the format of its lines.
//
// The text of log, without the line ending that Docker adds, is parsed when it is a single JSON object, and that record
// is normalized as bunyan, pino or generic JSON by its own structure; its time wins over Docker's. Any other text is
// the message, and Docker's time is the timestamp. The record's fields are the inner record's fields with the envelope
// below the key docker, or below _docker, __docker and so on when the inner record has a field of that name. Plain
// text keeps its text in the envelope's log.
import type { FieldPath, FormatContext, JsonObject, JsonValue, LogFormat } from '../api.js'
import { asJsonObject, genericProfile, isPlainObject, jsonProblem, normalizeFields, type FieldProfile } from '../record.js'
import { isBunyanRecord, bunyanProfile } from './bunyan.js'
import { readJsonLines } from './json-lines.js'
import type { AnnotatedNormalization } from './metadata.js'
import { isPinoRecord, pinoProfile } from './pino.js'
import { sampleObjects, shareScore } from './sample.js'

const isEnvelope = (value: JsonObject): boolean =>
  typeof value['log'] === 'string' && (value['stream'] === 'stdout' || value['stream'] === 'stderr') && typeof value['time'] === 'string'

// The output without the line ending that Docker appends.
const outputText = (log: string): string => log.replace(/\r?\n$/, '')

// The inner record, when the output is exactly one JSON object.
const innerRecord = (text: string): JsonObject | undefined => {
  if (!text.trimStart().startsWith('{')) {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(text)
    return isPlainObject(value) && jsonProblem(value) === undefined ? asJsonObject(value) : undefined
  } catch {
    return undefined
  }
}

// The first of docker, _docker, __docker and so on that the inner record does not use.
const envelopeKey = (inner: JsonObject | undefined): string => {
  let key = 'docker'
  if (inner === undefined) {
    return key
  }
  while (Object.hasOwn(inner, key)) {
    key = `_${key}`
  }
  return key
}

// The envelope's fields without log, or with the output's text for plain text.
const envelopeFields = (envelope: JsonObject, text: string | undefined): JsonObject => {
  const fields: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(envelope)) {
    if (key !== 'log') {
      fields[key] = value
    }
  }
  return text === undefined ? fields : { log: text, ...fields }
}

const innerProfile = (inner: JsonObject): FieldProfile => {
  if (isBunyanRecord(inner)) {
    return bunyanProfile
  }
  return isPinoRecord(inner) ? pinoProfile : genericProfile
}

// The inner profile with Docker's time after its own timestamp paths.
const withEnvelopeTime = (profile: FieldProfile, key: string): FieldProfile =>
  ({ ...profile, timestamp: [...profile.timestamp, [key, 'time']] })

const plainProfile = (key: string): FieldProfile => {
  const time: FieldPath = [key, 'time']
  const log: FieldPath = [key, 'log']
  return { ...genericProfile, timestamp: [time], level: [], message: [log] }
}

const normalizeDocker = (value: JsonObject, context: FormatContext): AnnotatedNormalization => {
  const log = value['log']
  if (typeof log !== 'string' || !isEnvelope(value)) {
    return normalizeFields(value, genericProfile, context)
  }
  const text = outputText(log)
  const inner = innerRecord(text)
  const key = envelopeKey(inner)
  if (inner === undefined) {
    return normalizeFields(asJsonObject({ [key]: envelopeFields(value, text) }), plainProfile(key), context)
  }
  const fields = asJsonObject(Object.fromEntries([...Object.entries(inner), [key, envelopeFields(value, undefined)]]))
  return normalizeFields(fields, withEnvelopeTime(innerProfile(inner), key), context)
}

const dockerFormat: LogFormat = {
  identifier: 'docker',
  probe: sample => {
    const objects = sampleObjects(sample)
    return shareScore(objects.filter(value => isEnvelope(value)).length, objects.length, 98)
  },
  read: readJsonLines,
  normalize: normalizeDocker
}

export { dockerFormat, isEnvelope }
