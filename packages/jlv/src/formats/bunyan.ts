// bunyan (plan section 6.2): JSON lines with bunyan's core fields, v 0, name, hostname, pid, a numeric level on the
// scale that pino shares, an ISO time and msg. The signature needs all of them, so JSON that only looks similar stays
// with another format. bunyan itself is not needed.
import type { JsonObject, LogFormat } from '../api.js'
import type { FieldProfile } from '../record.js'
import { jsonProfileFormat } from './json-lines.js'
import { sampleObjects, shareScore } from './sample.js'

const bunyanProfile: FieldProfile = {
  timestamp: [['time']],
  level: [['level']],
  message: [['msg']],
  hasNumericLevels: true,
  timestampUnit: 'milliseconds'
}

const isBunyanRecord = (value: JsonObject): boolean =>
  value['v'] === 0 &&
  typeof value['level'] === 'number' &&
  typeof value['name'] === 'string' &&
  typeof value['hostname'] === 'string' &&
  typeof value['pid'] === 'number' &&
  typeof value['time'] === 'string' &&
  typeof value['msg'] === 'string'

// bunyan's signature is stronger than pino's, which its records also fit.
const bunyanFormat: LogFormat = jsonProfileFormat({
  identifier: 'bunyan',
  profile: bunyanProfile,
  probe: sample => {
    const objects = sampleObjects(sample)
    return shareScore(objects.filter(value => isBunyanRecord(value)).length, objects.length, 95)
  }
})

export { bunyanFormat, bunyanProfile, isBunyanRecord }
