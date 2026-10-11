// pino through its built-in format (plan section 6.2): recognized by its structure, levels normalized from the parsed
// value, renamed keys and custom levels through the user's mapping and levels, and no pino installation.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pinoFormat } from '../src/formats/pino.js'
import { readRecords, rowsOf } from './support/records.js'

const pinoLine = (fields: object): string => `${JSON.stringify({ pid: 1, hostname: 'h', ...fields })}\n`

// The format that the pipeline chooses for the text.
const formatOf = async (text: string): Promise<string | undefined> => {
  const { format } = await readRecords(text)
  return format
}

// pino's probe of a sample.
const sample = (text: string): number => pinoFormat.probe({ text }, {
  signal: new AbortController().signal,
  source: { identifier: '1', label: 'x', order: 0 },
  maximumRecordSize: 1024,
  mapping: {},
  levels: {}
})

describe('pino', () => {
  it('is recognized by a numeric level with an epoch time or a message, and generic JSON is not', async () => {
    assert.equal(await formatOf(pinoLine({ level: 30, time: 1, msg: 'm' })), 'pino')
    assert.equal(await formatOf(pinoLine({ level: 30, msg: 'no time' })), 'pino')
    assert.equal(await formatOf(pinoLine({ level: 30, time: 1 })), 'pino')
    assert.equal(await formatOf('{"level":"info","time":1,"msg":"text level"}\n'), 'jsonl')
    assert.equal(await formatOf('{"timestamp":"2026-10-11T10:00:00Z","level":30,"message":"generic"}\n'), 'jsonl')
  })

  it('takes the share of pino records among the JSON objects of the sample, after leading lines that are no records', () => {
    assert.equal(sample('garbage\nmore garbage\n{"level":30,"time":1}\n'), 90)
    assert.equal(sample('{"level":30,"time":1}\n{"a":1}\n'), 45)
    assert.equal(sample('plain text only\n'), 0)
  })

  it('reads the level from the parsed value, never from text, and keeps unknown numbers', async () => {
    const { records } = await readRecords([
      pinoLine({ level: 30, time: 0, msg: '{"level":60}' }),
      pinoLine({ level: 35, time: 0, msg: 'custom' }),
      pinoLine({ level: 'warn', time: 0, msg: 'text label from a level formatter' })
    ].join(''))
    assert.deepEqual(rowsOf(records).map(row => [row.record.level, row.level, row.message]), [
      ['info', 'info', '{"level":60}'], ['unknown', '35', 'custom'], ['warn', 'warn', 'text label from a level formatter']
    ])
  })

  it('names custom levels through the user\'s levels', async () => {
    const { records } = await readRecords(pinoLine({ level: 35, time: 0, msg: 'notice' }), { levels: { 35: 'info' } })
    assert.equal(records[0]?.record.level, 'info')
  })

  // pino's messageKey, timestamp functions and level formatters rename or change these fields.
  it('follows a mapping of renamed keys with --format pino, and an explicit unit for its time', async () => {
    const line = pinoLine({ severity: 40, ts: 1_791_712_800, message: 'renamed' })
    const { records, format } = await readRecords(line, {
      format: pinoFormat,
      mapping: { level: ['severity'], timestamp: ['ts'], message: ['message'] },
      timestampUnit: 'seconds'
    })
    assert.equal(format, 'pino')
    assert.deepEqual(rowsOf(records).map(row => [row.timestamp, row.level, row.message, row.data]), [
      ['2026-10-11T10:00:00.000Z', 'warn', 'renamed', { pid: 1, hostname: 'h' }]
    ])
  })

  it('reads ISO times of pino\'s isoTime function and keeps the complete record in the fields', async () => {
    const value = { level: 50, time: '2026-10-11T10:00:00.000Z', pid: 1, hostname: 'h', msg: 'iso', err: { message: 'x', stack: 'Error: x' } }
    const { records } = await readRecords(`${JSON.stringify(value)}\n`)
    const [row] = rowsOf(records)
    assert.ok(row)
    assert.equal(row.timestamp, '2026-10-11T10:00:00.000Z')
    assert.deepEqual(row.record.fields, value)
    assert.deepEqual(row.data, { pid: 1, hostname: 'h', err: { message: 'x', stack: 'Error: x' } })
  })
})
