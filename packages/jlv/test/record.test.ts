// The normalization of src/record.ts (plan section 5): case-normalized levels with trace, fatal and unknown (upstream
// issue #14), timestamps in explicit units, RFC 3339 and invalid or naive text (upstream issue #16), messages,
// correlation identifiers, mapping warnings and the checks of parsed JSON.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FormatContext, JsonObject } from '../src/api.js'
import { normalizedPathsOf } from '../src/formats/metadata.js'
import {
  correlationOf, genericProfile, jsonProblem, levelCode, levelOfCode, messageOf, normalizeFields, normalizeLevel,
  normalizeTimestamp, type FieldProfile
} from '../src/record.js'

const noLevels = { hasNumericLevels: false, customLevels: {} }
const pinoLevels = { hasNumericLevels: true, customLevels: {} }

const context = (overrides: Partial<FormatContext> = {}): FormatContext => ({
  signal: new AbortController().signal,
  source: { identifier: '1', label: 'test.log', order: 0 },
  maximumRecordSize: 1024 * 1024,
  mapping: {},
  levels: {},
  ...overrides
})

const milliseconds = { unit: 'milliseconds', isUnitExplicit: false } as const

describe('levels', () => {
  it('normalize the common names and their aliases, ignoring case', () => {
    const cases = [
      ['INFO', 'info'], ['Info', 'info'], ['trace', 'trace'], ['DEBUG', 'debug'], ['Warn', 'warn'], ['WARNING', 'warn'],
      ['error', 'error'], ['Err', 'error'], ['FATAL', 'fatal'], ['critical', 'fatal']
    ] as const
    for (const [raw, level] of cases) {
      assert.equal(normalizeLevel(raw, noLevels), level, raw)
    }
  })

  it('keep other text, numbers of other producers and other values unknown', () => {
    for (const raw of ['notice', 'information', ' info', '', 30, 40, true, null, { level: 'info' }, ['info'], undefined]) {
      assert.equal(normalizeLevel(raw, noLevels), 'unknown', JSON.stringify(raw))
    }
  })

  it('read pino and bunyan numbers only for their profiles, and no other number', () => {
    assert.deepEqual([10, 20, 30, 40, 50, 60].map(raw => normalizeLevel(raw, pinoLevels)), ['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    for (const raw of [100, 35, 0, -10, 30.5, '30']) {
      assert.equal(normalizeLevel(raw, pinoLevels), 'unknown', JSON.stringify(raw))
    }
    assert.equal(normalizeLevel('INFO', pinoLevels), 'info')
  })

  it('prefer the user\'s custom levels and the format\'s own names', () => {
    const customLevels = { 35: 'info', notice: 'warn', info: 'debug' } as const
    assert.equal(normalizeLevel(35, { hasNumericLevels: false, customLevels }), 'info')
    assert.equal(normalizeLevel('35', { hasNumericLevels: false, customLevels }), 'info')
    assert.equal(normalizeLevel('NOTICE', { hasNumericLevels: true, customLevels }), 'warn')
    assert.equal(normalizeLevel('info', { hasNumericLevels: false, customLevels }), 'debug')
    assert.equal(normalizeLevel('verbose', { hasNumericLevels: false, levelNames: { verbose: 'debug' }, customLevels: {} }), 'debug')
  })

  it('order by severity with unknown last', () => {
    assert.deepEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'unknown'].map(level => levelCode(normalizeLevel(level, noLevels))), [0, 1, 2, 3, 4, 5, 6])
    assert.equal(levelOfCode(4), 'error')
    assert.equal(levelOfCode(99), 'unknown')
  })
})

describe('numeric timestamps', () => {
  it('read numbers in the given unit, milliseconds by default', () => {
    assert.deepEqual(normalizeTimestamp(1_700_000_000_123, milliseconds), { timestamp: 1_700_000_000_123 })
    assert.deepEqual(normalizeTimestamp(1_700_000_000, { unit: 'seconds', isUnitExplicit: true }), { timestamp: 1_700_000_000_000 })
    assert.deepEqual(normalizeTimestamp(1_700_000_000.25, { unit: 'seconds', isUnitExplicit: true }), { timestamp: 1_700_000_000_250 })
    assert.deepEqual(normalizeTimestamp(1_700_000_000_123_456, { unit: 'microseconds', isUnitExplicit: true }), { timestamp: 1_700_000_000_123.456 })
    // A JSON number of nanoseconds is a double already, so it keeps about 16 digits.
    const nanoseconds = normalizeTimestamp(Number('1700000000123456789'), { unit: 'nanoseconds', isUnitExplicit: true }).timestamp
    assert.ok(nanoseconds !== undefined && Math.abs(nanoseconds - 1_700_000_000_123.4568) < 0.001)
  })

  it('accept the epoch and times before it', () => {
    assert.deepEqual(normalizeTimestamp(0, milliseconds), { timestamp: 0 })
    assert.deepEqual(normalizeTimestamp(-1500, milliseconds), { timestamp: -1500 })
    assert.deepEqual(normalizeTimestamp(-2, { unit: 'seconds', isUnitExplicit: true }), { timestamp: -2000 })
  })

  it('keep numbers beyond the range of dates as text', () => {
    assert.deepEqual(normalizeTimestamp(1e20, milliseconds), { timestampText: '100000000000000000000', problem: 'range' })
    assert.deepEqual(normalizeTimestamp(1e13, { unit: 'seconds', isUnitExplicit: true }), { timestampText: '10000000000000', problem: 'range' })
    assert.deepEqual(normalizeTimestamp(8.64e15, milliseconds), { timestamp: 8.64e15 })
  })

  it('read numeric text only with an explicit unit, through BigInt for nanoseconds', () => {
    assert.deepEqual(normalizeTimestamp('1700000000', milliseconds), { timestampText: '1700000000', problem: 'unit' })
    assert.deepEqual(normalizeTimestamp('1700000000', { unit: 'seconds', isUnitExplicit: true }), { timestamp: 1_700_000_000_000 })
    assert.deepEqual(normalizeTimestamp('-1.5', { unit: 'seconds', isUnitExplicit: true }), { timestamp: -1500 })
    assert.deepEqual(normalizeTimestamp('1700000000123456789', { unit: 'nanoseconds', isUnitExplicit: true }), { timestamp: 1_700_000_000_123 + 456_789 / 1e6 })
    assert.deepEqual(normalizeTimestamp('1700000000123456', { unit: 'microseconds', isUnitExplicit: true }), { timestamp: 1_700_000_000_123.456 })
    assert.deepEqual(normalizeTimestamp('99999999999999999999', { unit: 'milliseconds', isUnitExplicit: true }), { timestampText: '99999999999999999999', problem: 'range' })
  })
})

describe('timestamp text', () => {
  it('reads RFC 3339 with a zone, its full fraction and any offset form', () => {
    const base = Date.UTC(2026, 9, 11, 10)
    const cases = [
      ['2026-10-11T10:00:00Z', base], ['2026-10-11T10:00:00.000Z', base], ['2026-10-11t10:00:00z', base],
      ['2026-10-11 10:00:00Z', base], ['2026-10-11T12:00:00+02:00', base], ['2026-10-11T12:00:00+0200', base],
      ['2026-10-11T12:00:00+02', base], ['2026-10-11T04:30:00-05:30', base], ['2026-10-11T10:00:00-00:00', base],
      ['2017-12-06T09:23:42.253060Z', Date.UTC(2017, 11, 6, 9, 23, 42) + 253.06],
      ['2019-01-01T00:00:00.123456789Z', Date.UTC(2019, 0, 1) + 123_456_789 / 1e6]
    ] as const
    for (const [text, expected] of cases) {
      const { timestamp } = normalizeTimestamp(text, milliseconds)
      assert.ok(timestamp !== undefined && Math.abs(timestamp - expected) < 1e-6, `${text}: ${String(timestamp)}`)
    }
  })

  it('accepts leap days, leap seconds and years before 100', () => {
    assert.deepEqual(normalizeTimestamp('2024-02-29T00:00:00Z', milliseconds), { timestamp: Date.UTC(2024, 1, 29) })
    assert.deepEqual(normalizeTimestamp('2016-12-31T23:59:60Z', milliseconds), { timestamp: Date.UTC(2017, 0, 1) })
    const early = new Date(0)
    early.setUTCFullYear(50, 0, 1)
    assert.deepEqual(normalizeTimestamp('0050-01-01T00:00:00Z', milliseconds), { timestamp: early.getTime() })
  })

  // Date.parse accepts 30 February and 24:00 and moves them to later days.
  it('keeps dates and times that do not exist as invalid text', () => {
    for (const text of ['2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-11T24:00:00Z',
      '2026-13-01T00:00:00Z', '2026-10-11T10:60:00Z', '2026-10-11T10:00:61Z', '2026-10-11T10:00:00+25:00']) {
      assert.deepEqual(normalizeTimestamp(text, milliseconds), { timestampText: text, problem: 'invalid' }, text)
    }
  })

  it('keeps naive dates without a zone visible instead of assigning one', () => {
    for (const text of ['2017-12-06 09:23:42.253060', '2026-10-11T10:00:00', '2026-10-11T10:00', '2026-10-11']) {
      assert.deepEqual(normalizeTimestamp(text, milliseconds), { timestampText: text, problem: 'naive' }, text)
    }
  })

  it('keeps other text and values as invalid text and takes null as no timestamp', () => {
    assert.deepEqual(normalizeTimestamp('yesterday', milliseconds), { timestampText: 'yesterday', problem: 'invalid' })
    assert.deepEqual(normalizeTimestamp(true, milliseconds), { timestampText: 'true', problem: 'invalid' })
    assert.deepEqual(normalizeTimestamp({ date: '2026-10-11T10:00:00Z' }, milliseconds), {
      timestampText: '{"date":"2026-10-11T10:00:00Z"}', problem: 'invalid'
    })
    assert.deepEqual(normalizeTimestamp(null, milliseconds), {})
    assert.deepEqual(normalizeTimestamp(undefined, milliseconds), {})
  })
})

describe('messages and correlation identifiers', () => {
  it('make every message text, structured ones as bounded JSON and never [object Object]', () => {
    assert.equal(messageOf('text'), 'text')
    assert.equal(messageOf(''), '')
    assert.equal(messageOf(0), '0')
    assert.equal(messageOf(false), 'false')
    assert.equal(messageOf(null), '')
    assert.equal(messageOf(undefined), '')
    assert.equal(messageOf({ text: 'object', list: [1, null] }), '{"text":"object","list":[1,null]}')
    const long = messageOf({ text: 'x'.repeat(10_000) })
    assert.equal(long.length, 4097)
    assert.ok(long.endsWith('…'))
  })

  it('keep numeric identifiers including 0 and drop empty and non-scalar ones', () => {
    assert.equal(correlationOf('req-1'), 'req-1')
    assert.equal(correlationOf(0), '0')
    assert.equal(correlationOf(12.5), '12.5')
    for (const value of ['', true, null, undefined, { id: 1 }, [1]]) {
      assert.equal(correlationOf(value), undefined, JSON.stringify(value))
    }
  })
})

const correlation = (value: JsonObject): string | undefined => normalizeFields(value, genericProfile, context()).record.correlationIdentifier

describe('normalizeFields', () => {
  it('normalizes the generic fields and keeps the complete original record unchanged', () => {
    const value: JsonObject = Object.freeze({
      timestamp: '2026-10-11T10:00:00.000Z', level: 'INFO', message: 'started', requestId: 0, user: Object.freeze({ id: 7 })
    })
    const copy = structuredClone(value)
    const result = normalizeFields(value, genericProfile, context())
    assert.deepEqual(result.record, {
      timestamp: Date.UTC(2026, 9, 11, 10), level: 'info', message: 'started', correlationIdentifier: '0', fields: value
    })
    assert.equal(result.record.fields, value)
    assert.deepEqual(value, copy)
    assert.deepEqual(result.diagnostics, [])
    assert.deepEqual(normalizedPathsOf(result), { timestamp: ['timestamp'], level: ['level'], message: ['message'] })
  })

  it('leaves optional parts absent and the message empty without warnings', () => {
    const result = normalizeFields({ other: 1 }, genericProfile, context())
    assert.deepEqual(result.record, { level: 'unknown', message: '', fields: { other: 1 } })
    assert.deepEqual(result.diagnostics, [])
    assert.deepEqual(normalizedPathsOf(result), {})
  })

  it('follows explicit mappings and warns with the path when a record lacks the field', () => {
    const mapping = { timestamp: ['datetime', 'date'], level: ['level_name'], message: ['message'], correlationIdentifier: ['ids', 0] }
    const value = { datetime: { date: '2026-10-11T10:00:00Z' }, level_name: 'WARNING', message: 'm', ids: ['first', 'second'], requestId: 'ignored' }
    const mapped = normalizeFields(value, genericProfile, context({ mapping }))
    assert.deepEqual(mapped.record, {
      timestamp: Date.UTC(2026, 9, 11, 10), level: 'warn', message: 'm', correlationIdentifier: 'first', fields: value
    })
    assert.deepEqual(normalizedPathsOf(mapped), { timestamp: ['datetime', 'date'], level: ['level_name'], message: ['message'] })
    const missing = normalizeFields({ message: 'no date' }, genericProfile, context({ mapping }))
    assert.deepEqual(missing.diagnostics.map(diagnostic => [diagnostic.severity, diagnostic.code, diagnostic.message]), [
      ['warning', 'mapping-missing', 'no field at ["datetime","date"] for the timestamp'],
      ['warning', 'mapping-missing', 'no field at ["level_name"] for the level'],
      ['warning', 'mapping-missing', 'no field at ["ids",0] for the correlation identifier']
    ])
    assert.equal(missing.record.timestampText, undefined)
  })

  it('finds correlation identifiers at the known paths in their order', () => {
    assert.equal(correlation({ traceId: 't', requestId: 'r', correlation_id: 'c' }), 'c')
    assert.equal(correlation({ traceId: 't', trace_id: 'u' }), 'u')
    assert.equal(correlation({ req: { id: 0 }, traceId: 't' }), '0')
    assert.equal(correlation({ 'req.id': 'dotted' }), undefined)
  })

  it('warns once per record about a timestamp that is no time and shows its text', () => {
    const { record, diagnostics } = normalizeFields({ timestamp: '2017-12-06 09:23:42.253060' }, genericProfile, context())
    assert.equal(record.timestampText, '2017-12-06 09:23:42.253060')
    assert.equal(record.timestamp, undefined)
    assert.deepEqual(diagnostics.map(diagnostic => diagnostic.code), ['timestamp-naive'])
  })

  it('uses the user\'s unit over the profile\'s and the profile\'s level names', () => {
    const profile: FieldProfile = { ...genericProfile, levelNames: { verbose: 'debug' }, timestampUnit: 'seconds' }
    assert.equal(normalizeFields({ timestamp: 2 }, profile, context()).record.timestamp, 2000)
    assert.equal(normalizeFields({ timestamp: 2 }, profile, context({ timestampUnit: 'milliseconds' })).record.timestamp, 2)
    assert.equal(normalizeFields({ level: 'VERBOSE' }, profile, context()).record.level, 'debug')
    assert.equal(normalizeFields({ level: 'verbose' }, genericProfile, context()).record.level, 'unknown')
  })
})

// A record with the given number of arrays nested inside it.
const nested = (arrays: number): unknown => JSON.parse(`{"a":${'['.repeat(arrays)}${']'.repeat(arrays)}}`)

describe('parsed JSON', () => {
  it('rejects numbers beyond the range of doubles', () => {
    assert.equal(jsonProblem(JSON.parse('{"a":[1,{"b":1e400}]}')), 'number-out-of-range')
    assert.equal(jsonProblem(JSON.parse('{"a":-1e400}')), 'number-out-of-range')
    assert.equal(jsonProblem(JSON.parse('{"a":1e308,"b":null,"c":false,"d":""}')), undefined)
  })

  it('allows 64 levels of nesting, the record included, and no more', () => {
    assert.equal(jsonProblem(nested(63)), undefined)
    assert.equal(jsonProblem(nested(64)), 'too-deep')
  })
})
