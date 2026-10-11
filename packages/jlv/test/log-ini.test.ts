// Reading the ~/.json-log-viewer mapping with ini 6.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readLog, readMapping, transform } from '../src/log.js'

// ini 1.3.5 wrote the [__proto__] section into Object.prototype (CVE-2020-7788). It also read the line of spaces as
// a key '' and the header with a trailing space as a key '[transform]', so for it this file had no [transform]
// section at all.
const mappingFile = [
  '[__proto__]',
  'polluted=yes',
  '[transform] ',
  ' '.repeat(3),
  'message=msg',
  'level=constructor',
  'timestamp=time',
  '__proto__=time',
  'extra=$',
  '[transform.nested]',
  'x=y',
  ''
].join('\n')

describe('mapping configuration read with ini 6', () => {
  it('maps own fields, drops prototype keys, names no field for a nested section and leaves Object.prototype alone', () => {
    const record = { msg: 'm', time: '2026-10-11T10:00:00.000Z', lvl: 'info' }
    const mapping = readMapping({ existsSync: () => true, readFileSync: () => mappingFile })
    const mapped = transform(record, mapping)
    assert.deepEqual(mapped, { message: 'm', level: undefined, timestamp: '2026-10-11T10:00:00.000Z', extra: record, nested: undefined })
    assert.equal(Object.getPrototypeOf(mapped), Object.prototype)
    assert.equal(Reflect.get({}, 'polluted'), undefined)
    assert.deepEqual(readLog('', { readFileSync: () => `${JSON.stringify(record)}\n` }, mapping), [
      { timestamp: '2026-10-11T10:00:00.000Z', level: undefined, message: 'm', data: { extra: record, nested: undefined } }
    ])
  })
})
