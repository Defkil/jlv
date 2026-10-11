// Configuration of src/configuration.ts (plan section 6.3): the legacy [transform] mapping of ~/.json-log-viewer with
// ini 6, its paths and extra fields, jlv.config.json and its validation, and the precedence of the files, which are
// read and never written or run.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { ConfigurationError, loadConfiguration, readFilterClause, readJsonConfiguration, readLegacyMapping } from '../src/configuration.js'
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
    assert.throws(() => loadConfiguration({ workingDirectory: home, home }), /^ConfigurationError: cannot read the configuration file /u)
    const readable = path.join(directory, 'readable-home')
    mkdirSync(readable)
    assert.equal(loadConfiguration({ workingDirectory: directory, home: readable }).file, undefined)
    writeFileSync(path.join(readable, '.json-log-viewer'), '[transform]\nmessage=msg\n')
    const configuration = loadConfiguration({ workingDirectory: directory, home: readable })
    assert.deepEqual([configuration.kind, configuration.mapping], ['ini', { message: ['msg'] }])
  })
})

const json = (value: object): string => JSON.stringify(value)

// The message of the configuration error that the text gives.
const jsonError = (text: string): string => {
  try {
    readJsonConfiguration(text, 'jlv.config.json')
  } catch (error) {
    assert.ok(error instanceof ConfigurationError)
    return error.message
  }
  return assert.fail('no configuration error')
}

describe('jlv.config.json', () => {
  it('reads a UTF-8 byte order mark written by Windows editors', () => {
    const file = path.join(directory, 'bom.config')
    writeFileSync(file, '\u{FEFF}{"version":1,"format":"pino"}')
    const configuration = loadConfiguration({ workingDirectory: directory, home: directory, file })
    assert.equal(configuration.kind, 'json')
    assert.equal(configuration.format, 'pino')
    assert.equal(readJsonConfiguration('\u{FEFF}{"version":1}', 'jlv.config.json').kind, 'json')
  })

  it('reads every setting of version 1', () => {
    const configuration = readJsonConfiguration(json({
      $schema: 'https://example.invalid/jlv.schema.json',
      version: 1,
      format: 'pino',
      mapping: { timestamp: ['datetime', 'date'], level: ['log.level'], message: ['msg'], correlationIdentifier: ['ids', 0] },
      timestampUnit: 'seconds',
      levels: { 35: 'info', NOTICE: 'warn' },
      csv: { delimiter: ';' },
      maxRecords: 1000,
      maxBytes: 1_048_576,
      profiles: {
        errors: { mode: 'any', clauses: [{ field: ['level'], operator: 'equals', value: 50 }, { field: ['fields', 'msg'], operator: 'contains', value: 'fail' }] }
      }
    }), 'jlv.config.json')
    assert.deepEqual(configuration, {
      file: 'jlv.config.json',
      kind: 'json',
      format: 'pino',
      mapping: { timestamp: ['datetime', 'date'], level: ['log.level'], message: ['msg'], correlationIdentifier: ['ids', 0] },
      timestampUnit: 'seconds',
      levels: { 35: 'info', notice: 'warn' },
      csvDelimiter: ';',
      maximumRecords: 1000,
      maximumBytes: 1_048_576,
      profiles: {
        errors: { mode: 'any', clauses: [{ field: ['level'], operator: 'equals', value: 50 }, { field: ['fields', 'msg'], operator: 'contains', value: 'fail' }] }
      }
    })
  })

  // Level names and profile names were assigned key by key, so __proto__ set the prototype of the table instead of
  // naming a level or a profile.
  it('keeps level and profile names such as __proto__ as own keys', () => {
    const profile = '{"mode":"all","clauses":[{"field":["message"],"operator":"contains","value":"x"}]}'
    const configuration = readJsonConfiguration(
      `{"version":1,"levels":{"__proto__":"info","Constructor":"warn"},"profiles":{"__proto__":${profile}}}`, 'jlv.config.json')
    assert.deepEqual(Object.keys(configuration.levels), ['__proto__', 'constructor'])
    assert.equal(Object.getPrototypeOf(configuration.levels), Object.prototype)
    assert.deepEqual(Object.keys(configuration.profiles), ['__proto__'])
    assert.equal(Object.getPrototypeOf(configuration.profiles), Object.prototype)
  })

  it('refuses misspelled keys with a hint, other versions and invalid JSON', () => {
    assert.equal(jsonError(json({ version: 1, maping: {} })),
      'jlv.config.json: the configuration has the unknown key "maping" (did you mean mapping?). Known keys: $schema, version, format, ' +
      'mapping, timestampUnit, levels, csv, maxRecords, maxBytes, profiles')
    assert.equal(jsonError(json({ version: 1, mapping: { msg: ['m'] } })),
      'jlv.config.json: mapping has the unknown key "msg". Known keys: timestamp, level, message, correlationIdentifier')
    assert.equal(jsonError(json({ version: 2 })), 'jlv.config.json: version must be 1')
    assert.equal(jsonError(json({})), 'jlv.config.json: version must be 1')
    assert.match(jsonError('{"version": 1,'), /^jlv\.config\.json is no valid JSON: /u)
    assert.equal(jsonError('[1]'), 'jlv.config.json: the configuration must be an object')
  })

  it('takes paths only as lists of segments, so that a dotted text is never split silently', () => {
    assert.equal(jsonError(json({ version: 1, mapping: { timestamp: 'datetime.date' } })),
      'jlv.config.json: mapping.timestamp must be a list of keys and indexes, such as ["datetime","date"] for "datetime.date"')
    assert.equal(jsonError(json({ version: 1, mapping: { level: [] } })),
      'jlv.config.json: mapping.level must be a list of keys and indexes, such as ["datetime", "date"]')
    assert.equal(jsonError(json({ version: 1, mapping: { level: ['a', -1] } })),
      'jlv.config.json: mapping.level[1] must be a key or an index, which is a whole number from 0')
  })

  it('checks units, levels, the delimiter, the limits and the profiles', () => {
    assert.equal(jsonError(json({ version: 1, timestampUnit: 'hours' })),
      'jlv.config.json: timestampUnit must be one of seconds, milliseconds, microseconds, nanoseconds')
    assert.equal(jsonError(json({ version: 1, levels: { 35: 'notice' } })),
      'jlv.config.json: levels.35 must be one of trace, debug, info, warn, error, fatal, unknown')
    assert.equal(jsonError(json({ version: 1, csv: { delimiter: ';;' } })), 'jlv.config.json: csv.delimiter must be one ASCII character other than a quote')
    assert.equal(jsonError(json({ version: 1, maxRecords: 0 })), 'jlv.config.json: maxRecords must be a whole number from 1 to 4294967295')
    assert.equal(jsonError(json({ version: 1, profiles: { p: { mode: 'some', clauses: [] } } })), 'jlv.config.json: profiles.p.mode must be one of all, any')
    assert.equal(jsonError(json({ version: 1, profiles: { p: { mode: 'all', clauses: [{ field: ['message'], operator: 'contains', value: 1 }] } } })),
      'jlv.config.json: profiles.p.clauses[0].value must be text')
    assert.equal(jsonError(json({ version: 1, profiles: { p: { mode: 'all', clauses: [{ field: ['message'], operator: 'matches', value: 'x' }] } } })),
      'jlv.config.json: profiles.p.clauses[0].operator must be one of equals, contains')
    assert.equal(jsonError(json({ version: 1, profiles: { p: { mode: 'any', clauses: [] } } })),
      'jlv.config.json: profiles.p.clauses must be a list of at least one clause')
  })

  // A field that names no part of the record would never match; the usual mistake is an original field without
  // "fields" in front.
  it('takes clause fields that start with a part of the record', () => {
    assert.equal(jsonError(json({ version: 1, profiles: { p: { mode: 'all', clauses: [{ field: ['route'], operator: 'equals', value: '/' }] } } })),
      'jlv.config.json: profiles.p.clauses[0].field must start with a part of the record, identifier, source, position, ' +
      'timestamp, timestampText, level, message, correlationIdentifier, fields; an original field is ["fields","route"]')
  })
})

describe('clauses of --where', () => {
  it('read the JSON of a profile\'s clause and name --where in their errors', () => {
    assert.deepEqual(readFilterClause('{"field":["fields","status"],"operator":"equals","value":0}', '--where'),
      { field: ['fields', 'status'], operator: 'equals', value: 0 })
    assert.deepEqual(readFilterClause('{"field":["message"],"operator":"contains","value":"slow"}', '--where'),
      { field: ['message'], operator: 'contains', value: 'slow' })
    const failure = (text: string): string => {
      try {
        readFilterClause(text, '--where')
      } catch (error) {
        assert.ok(error instanceof ConfigurationError)
        return error.message
      }
      return assert.fail('no error')
    }
    assert.match(failure('message~slow'), /^--where takes a clause in JSON, such as \{"field":\["message"\],"operator":"contains","value":"timeout"\}: /u)
    assert.equal(failure('{"field":["message"],"operator":"contains"}'), '--where: the clause.value must be text')
    assert.equal(failure('{"field":"message","operator":"equals","value":1}'),
      '--where: the clause.field must be a list of keys and indexes, such as ["message"] for "message"')
    assert.equal(failure('[1]'), '--where: the clause must be an object')
  })
})

// The names, sizes and modification times of a directory's entries, to see that nothing wrote into it.
const snapshot = (folder: string): string[] => readdirSync(folder, { recursive: true }).map(name => {
  const status = statSync(path.join(folder, String(name)))
  return `${String(name)} ${String(status.size)} ${String(status.mtimeMs)}`
}).toSorted((left, right) => left.localeCompare(right))

describe('configuration precedence', () => {
  const project = path.join(directory, 'project')
  const home = path.join(directory, 'home')
  mkdirSync(project, { recursive: true })
  mkdirSync(home, { recursive: true })
  const write = (folder: string, name: string, text: string): string => {
    const file = path.join(folder, name)
    writeFileSync(file, text)
    return file
  }

  it('discovers the first of the project\'s and then the home\'s files, never merges them, and writes nothing', () => {
    write(home, '.json-log-viewer', '[transform]\nmessage=home_ini\n')
    const homeBefore = snapshot(home)
    assert.deepEqual(loadConfiguration({ workingDirectory: project, home }).mapping, { message: ['home_ini'] })
    write(home, 'jlv.config.json', json({ version: 1, mapping: { message: ['home_json'] } }))
    assert.deepEqual(loadConfiguration({ workingDirectory: project, home }).mapping, { message: ['home_json'] })
    write(project, '.json-log-viewer', '[transform]\nlevel=project_ini\n')
    const projectIni = loadConfiguration({ workingDirectory: project, home })
    assert.deepEqual([projectIni.file, projectIni.mapping], ['.json-log-viewer', { level: ['project_ini'] }])
    write(project, 'jlv.config.json', json({ version: 1, timestampUnit: 'seconds' }))
    const projectJson = loadConfiguration({ workingDirectory: project, home })
    assert.deepEqual([projectJson.file, projectJson.mapping, projectJson.timestampUnit], ['jlv.config.json', {}, 'seconds'])
    const added = snapshot(home).filter(entry => entry.startsWith('jlv.config.json'))
    assert.deepEqual(snapshot(home), [...homeBefore, ...added].toSorted((left, right) => left.localeCompare(right)))
  })

  it('reads only the file of --config, which must exist, and nothing with --no-config', () => {
    const explicit = write(directory, 'custom.cfg', '{"version": 1, "format": "logfmt"}')
    const configuration = loadConfiguration({ workingDirectory: project, home, file: explicit })
    assert.deepEqual([configuration.kind, configuration.format, configuration.mapping], ['json', 'logfmt', {}])
    const ini = write(directory, 'legacy.ini', '[transform]\nmessage=text\n')
    assert.deepEqual(loadConfiguration({ workingDirectory: project, home, file: ini }).mapping, { message: ['text'] })
    assert.throws(() => loadConfiguration({ workingDirectory: project, home, file: 'missing.json' }),
      { name: 'ConfigurationError', message: 'the configuration file missing.json does not exist' })
    assert.equal(loadConfiguration({ workingDirectory: project, home, isDiscoveryDisabled: true }).file, undefined)
    assert.throws(() => loadConfiguration({ workingDirectory: project, home, file: explicit, isDiscoveryDisabled: true }),
      { message: '--config and --no-config exclude each other' })
  })

  it('runs no configuration code, such as a jlv.config.js next to the inputs', () => {
    const scripted = path.join(directory, 'scripted')
    mkdirSync(scripted)
    const marker = path.join(scripted, 'ran.txt')
    write(scripted, 'jlv.config.js', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)
    write(scripted, 'jlv.config.mjs', `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'ran')`)
    assert.equal(loadConfiguration({ workingDirectory: scripted, home: scripted }).file, undefined)
    assert.deepEqual(readdirSync(scripted).toSorted((left, right) => left.localeCompare(right)), ['jlv.config.js', 'jlv.config.mjs'])
  })
})
