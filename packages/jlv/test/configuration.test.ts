// Configuration of src/configuration.ts (plan section 6.3): the legacy [transform] mapping of ~/.json-log-viewer with
// ini 6, its paths and extra fields, and the errors it reports.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { ConfigurationError, readHomeMapping, readLegacyMapping } from '../src/configuration.js'
import { readUpstreamFixture } from './support/fixtures.js'
import { readRecords, rowsOf, shownRows } from './support/records.js'

const directory = mkdtempSync(path.join(tmpdir(), 'jlv-configuration-'))
after(() => {
  rmSync(directory, { recursive: true, force: true })
})

// ini 1.3.5 wrote the [__proto__] section into Object.prototype (CVE-2020-7788). It also read the line of spaces as
// a key '' and the header with a trailing space as a key '[transform]', so for it this file had no [transform]
// section at all.
const maliciousMapping = [
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

describe('legacy [transform] mapping', () => {
  it('maps own fields, drops prototype keys, names no field for a nested section and leaves Object.prototype alone', async () => {
    const legacy = readLegacyMapping(maliciousMapping, 'mapping')
    assert.ok(legacy)
    assert.deepEqual(legacy.mapping, { message: ['msg'], level: ['constructor'], timestamp: ['time'] })
    assert.deepEqual([...legacy.extras], [['extra', { kind: 'record' }], ['nested', { kind: 'none' }]])
    assert.equal(Reflect.get({}, 'polluted'), undefined)
    const record = { msg: 'm', time: '2026-10-11T10:00:00.000Z', lvl: 'info' }
    const { records, diagnostics } = await readRecords(`${JSON.stringify(record)}\n`, { mapping: legacy.mapping })
    const rows = shownRows(records, { legacyExtras: legacy.extras })
    assert.deepEqual(rows, [{ timestamp: '2026-10-11T10:00:00.000Z', message: 'm', data: { extra: record, nested: undefined } }])
    assert.deepEqual(diagnostics.map(diagnostic => diagnostic.message), ['no field at ["constructor"] for the level'])
  })

  // Upstream test/log.test.js: the transform1.ini mapping of a Monolog record. The level is normalized now; the raw
  // INFO stays in the fields, and the naive Monolog date stays visible as text.
  it('transforms a Monolog record through dotted paths and copies the whole record to extra with $', async () => {
    const legacy = readLegacyMapping(readUpstreamFixture('transform1.ini'), 'transform1.ini')
    assert.ok(legacy)
    const monolog: unknown = JSON.parse(readUpstreamFixture('monolog.log.json'))
    const { records } = await readRecords(`${JSON.stringify(monolog)}\n`, { mapping: legacy.mapping })
    const [row] = rowsOf(records, { legacyExtras: legacy.extras })
    assert.ok(row)
    assert.equal(row.timestamp, '2017-12-06 09:23:42.253060')
    assert.equal(row.level, 'info')
    assert.equal(row.record.fields['level_name'], 'INFO')
    assert.deepEqual(row.data, { extra: monolog })
    // The extra field is the record's own fields, not a copy.
    assert.equal(row.data['extra'], row.record.fields)
  })

  it('reads lodash paths for extra fields, with an exact dotted key first, and splits the paths of the normalized parts', async () => {
    const legacy = readLegacyMapping('[transform]\nm=a.b[0].c\nd=x.y\nt=top\nmissing=nope.nothing\nall=$\nempty=\nc=constructor\nmessage=a.b[0].c\ncorrelationId=ids[1]\n', 'mapping')
    assert.ok(legacy)
    assert.deepEqual(legacy.mapping, { message: ['a', 'b', '0', 'c'], correlationIdentifier: ['ids', '1'] })
    const record = { a: { b: [{ c: 'deep' }] }, 'x.y': 'dotted', top: 'v', ids: [0, 7] }
    const { records } = await readRecords(`${JSON.stringify(record)}\n`, { mapping: legacy.mapping })
    const [row] = shownRows(records, { legacyExtras: legacy.extras })
    assert.deepEqual(row, { message: 'deep', data: { m: 'deep', d: 'dotted', t: 'v', missing: undefined, all: record, empty: undefined, c: undefined } })
    assert.equal(records[0]?.record.correlationIdentifier, '7')
  })

  it('ignores a transform key outside a [transform] section', () => {
    assert.equal(readLegacyMapping('transform=x\n', 'mapping'), undefined)
    assert.equal(readLegacyMapping('[other]\nmessage=msg\n', 'mapping'), undefined)
  })

  it('refuses $ and sections for the normalized parts', () => {
    assert.throws(() => readLegacyMapping('[transform]\ntimestamp=$\n', 'home mapping'), {
      name: 'ConfigurationError',
      message: 'home mapping: [transform] timestamp needs the path of a field; only additional keys take $ or a section'
    })
    assert.throws(() => readLegacyMapping('[transform]\n[transform.level]\nx=y\n', 'home mapping'), ConfigurationError)
  })

  // Upstream looked for the mapping file again for every record and dropped every line while it could not be read.
  it('reports a mapping file that cannot be read as a configuration error', () => {
    const home = path.join(directory, 'unreadable-home')
    mkdirSync(path.join(home, '.json-log-viewer'), { recursive: true })
    assert.throws(() => readHomeMapping(home), /^ConfigurationError: cannot read the mapping file /u)
    const readable = path.join(directory, 'readable-home')
    mkdirSync(readable)
    assert.equal(readHomeMapping(readable), undefined)
    writeFileSync(path.join(readable, '.json-log-viewer'), '[transform]\nmessage=msg\n')
    assert.deepEqual(readHomeMapping(readable)?.mapping, { message: ['msg'] })
  })
})
