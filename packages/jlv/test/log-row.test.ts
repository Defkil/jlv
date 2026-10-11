// The compatibility view of src/tui/log-row.ts (plan section 8, phase 6): the rows that the ported widgets and the
// plain output read, made from final records without losing their fields, source or identity.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LogRecord } from '../src/api.js'
import { rowOf } from '../src/tui/log-row.js'
import { readRecords, rowsOf } from './support/records.js'

const source = { identifier: '2', label: 'plugin.log', order: 1 }

// A record as a plugin's format may give it: no paths of its normalized parts.
const pluginRecord = (overrides: Partial<LogRecord> = {}): LogRecord => ({
  identifier: '2:5',
  source,
  position: { recordNumber: 5, firstLine: 9, lastLine: 11 },
  level: 'unknown',
  message: 'from a plugin',
  fields: { severity: 'loud', text: 'from a plugin' },
  ...overrides
})

describe('rows of records', () => {
  it('show valid times in UTC with milliseconds, other timestamps as their text, and nothing without one', async () => {
    const { records } = await readRecords([
      '{"timestamp":"2026-10-11T12:00:00.123456+02:00"}',
      '{"timestamp":0}',
      '{"timestamp":"2017-12-06 09:23:42.253060"}',
      '{"timestamp":"yesterday"}',
      '{"other":1}'
    ].join('\n'))
    assert.deepEqual(rowsOf(records).map(row => row.timestamp), [
      '2026-10-11T10:00:00.123Z', '1970-01-01T00:00:00.000Z', '2017-12-06 09:23:42.253060', 'yesterday', undefined
    ])
  })

  it('show normalized levels and the raw value of an unknown level', async () => {
    const { records } = await readRecords([
      '{"level":"TRACE"}', '{"level":"Fatal"}', '{"level":"warning"}', '{"level":"notice"}', '{"level":35}',
      '{"level":{"name":"x"}}', '{"level":null}', '{}'
    ].join('\n'))
    assert.deepEqual(rowsOf(records).map(row => [row.level, row.record.level]), [
      ['trace', 'trace'], ['fatal', 'fatal'], ['warn', 'warn'], ['notice', 'unknown'], ['35', 'unknown'],
      ['{"name":"x"}', 'unknown'], [undefined, 'unknown'], [undefined, 'unknown']
    ])
  })

  it('give the details every field but the top-level keys that the columns show', async () => {
    const { records } = await readRecords('{"timestamp":"2026-10-11T10:00:00Z","level":"info","message":"m","user":{"id":7},"requestId":"r"}\n')
    const [row] = rowsOf(records)
    assert.ok(row)
    assert.deepEqual(row.data, { user: { id: 7 }, requestId: 'r' })
    assert.deepEqual(row.record.fields, { timestamp: '2026-10-11T10:00:00Z', level: 'info', message: 'm', user: { id: 7 }, requestId: 'r' })
    assert.equal(row.record.identifier, '1:1')
    assert.deepEqual(row.record.source, { identifier: '1', label: 'test.log', order: 0 })
  })

  it('keep the top-level key of a nested mapped field in the details', async () => {
    const mapping = { timestamp: ['datetime', 'date'], message: ['text'] }
    const { records } = await readRecords('{"datetime":{"date":"2026-10-11T10:00:00Z"},"text":"t","level":"debug"}\n', { mapping })
    assert.deepEqual(rowsOf(records)[0]?.data, { datetime: { date: '2026-10-11T10:00:00Z' } })
  })

  it('show only the extra keys of a legacy mapping, with $ as the record itself', async () => {
    const { records } = await readRecords('{"msg":"m","a":{"b":1},"x.y":"dotted"}\n', { mapping: { message: ['msg'] } })
    const extras = new Map([
      ['all', { kind: 'record' }],
      ['nested', { kind: 'path', path: 'a.b' }],
      ['dotted', { kind: 'path', path: 'x.y' }],
      ['list', { kind: 'path', path: ['a', 'b'] }],
      ['section', { kind: 'none' }]
    ] as const)
    const [row] = rowsOf(records, { legacyExtras: extras })
    assert.ok(row)
    assert.deepEqual(Object.keys(row.data), ['all', 'nested', 'dotted', 'list', 'section'])
    assert.equal(row.data['all'], row.record.fields)
    assert.deepEqual(row.data, { all: { msg: 'm', a: { b: 1 }, 'x.y': 'dotted' }, nested: 1, dotted: 'dotted', list: 1, section: undefined })
    assert.equal(row.message, 'm')
  })

  it('show all fields of a plugin\'s record and no raw level, since its paths are unknown', () => {
    const row = rowOf({ record: pluginRecord(), paths: {} })
    assert.deepEqual(row, {
      message: 'from a plugin',
      data: { severity: 'loud', text: 'from a plugin' },
      record: pluginRecord()
    })
    assert.equal(rowOf({ record: pluginRecord({ level: 'error', timestamp: 1500 }), paths: {} }).level, 'error')
    assert.equal(rowOf({ record: pluginRecord({ timestamp: 1500 }), paths: {} }).timestamp, '1970-01-01T00:00:01.500Z')
  })
})
