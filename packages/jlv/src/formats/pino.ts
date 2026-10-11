// pino (plan section 6.2): JSON lines with a numeric level on pino's scale, epoch milliseconds in time and the
// message in msg. The level is normalized from the parsed value, never by replacing text, so a level inside a message,
// in a nested object or split across chunks stays as it is, and so do numbers such as 100 that are no pino level.
// Renamed keys and custom levels come from the user's mapping and levels; pino itself is not needed.
import type { JsonObject, LogFormat } from '../api.js'
import type { FieldProfile } from '../record.js'
import { jsonProfileFormat } from './json-lines.js'
import { sampleObjects, shareScore } from './sample.js'

const pinoProfile: FieldProfile = {
  timestamp: [['time']],
  level: [['level']],
  message: [['msg']],
  hasNumericLevels: true,
  timestampUnit: 'milliseconds'
}

// pino's signature: a numeric level with an epoch time or a message. pino can rename and drop keys, which a mapping
// with --format pino covers.
const isPinoRecord = (value: JsonObject): boolean =>
  typeof value['level'] === 'number' && (typeof value['time'] === 'number' || typeof value['msg'] === 'string')

const pinoFormat: LogFormat = jsonProfileFormat({
  identifier: 'pino',
  profile: pinoProfile,
  probe: sample => {
    const objects = sampleObjects(sample)
    return shareScore(objects.filter(value => isPinoRecord(value)).length, objects.length, 90)
  }
})

export { isPinoRecord, pinoFormat, pinoProfile }
