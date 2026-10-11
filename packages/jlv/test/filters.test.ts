// The filters of src/filters.ts (plan sections 5 and 6.3, upstream issues #14, #15 and #19): typed equality and text
// search on the normalized parts and the original fields, all clauses at once, all or any of a profile, the level and
// the predicates of plugins, and the descriptions that the status line shows.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FilterClause, LogRecord } from '../src/api.js'
import {
  describeField, describeFilter, emptyFilter, fieldProblem, filterTest, isFilterEmpty, recordValue, type NamedPredicate,
  type RecordFilter
} from '../src/filters.js'
import { readRecords } from './support/records.js'

// Records with values that loose comparisons confuse: 0, false, null, "0", "", a missing value, nested objects and
// arrays, mixed-case levels and correlation identifiers.
const lines = [
  { timestamp: '2026-10-11T10:00:00.000Z', level: 'INFO', message: 'zero', status: 0, requestId: 0, user: { id: 7, roles: ['admin'] } },
  { timestamp: '2026-10-11T10:01:00.000Z', level: 'Warn', message: 'false', status: false, requestId: '0', user: { id: 7, roles: ['user'] } },
  { timestamp: '2026-10-11T10:02:00.000Z', level: 'error', message: 'null', status: null, requestId: 'req-2' },
  { timestamp: '2026-10-11T11:03:00.000Z', level: 'notice', message: 'text zero', status: '0', requestId: '' },
  { level: 'ERROR', message: 'Missing Status', tags: [] }
]

const records = async (): Promise<LogRecord[]> => {
  const { records: normalized } = await readRecords(lines.map(line => `${JSON.stringify(line)}\n`).join(''))
  return normalized.map(({ record }) => record)
}

const noFailure = (): void => { assert.fail('no predicate fails here') }

// The messages of the records that the filter keeps.
const kept = async (filter: Partial<RecordFilter>): Promise<string[]> => {
  const test = filterTest({ ...emptyFilter, ...filter }, noFailure)
  const all = await records()
  return all.filter(record => test?.(record) ?? true).map(record => record.message)
}

const equals = (field: readonly (string | number)[], value: FilterClause['value']): FilterClause =>
  ({ field, operator: 'equals', value })

const contains = (field: readonly (string | number)[], value: string): FilterClause => ({ field, operator: 'contains', value })

describe('equality', () => {
  it('tells 0, false, null, "0" and a missing value apart', async () => {
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'status'], 0)] }), ['zero'])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'status'], false)] }), ['false'])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'status'], null)] }), ['null'])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'status'], '0')] }), ['text zero'])
  })

  it('compares objects and arrays by their contents', async () => {
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'user'], { id: 7, roles: ['admin'] })] }), ['zero'])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'user', 'roles'], ['user'])] }), ['false'])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'tags'], [])] }), ['Missing Status'])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'user', 'roles', 0], 'admin')] }), ['zero'])
  })

  // Upstream issue #14: the level is normalized, whatever its case.
  it('compares the normalized level, not the raw one', async () => {
    assert.deepEqual(await kept({ clauses: [equals(['level'], 'error')] }), ['null', 'Missing Status'])
    assert.deepEqual(await kept({ clauses: [equals(['level'], 'unknown')] }), ['text zero'])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'level'], 'ERROR')] }), ['Missing Status'])
    assert.deepEqual(await kept({ level: 'warn' }), ['false'])
  })

  // Upstream issue #15: the identifier 0 is "0", for a numeric and a textual 0 alike, and empty text is none.
  it('compares correlation identifiers exactly, with 0 as an identifier', async () => {
    assert.deepEqual(await kept({ clauses: [equals(['correlationIdentifier'], '0')] }), ['zero', 'false'])
    assert.deepEqual(await kept({ clauses: [equals(['correlationIdentifier'], 'req-2')] }), ['null'])
    assert.deepEqual(await kept({ clauses: [equals(['correlationIdentifier'], 'req')] }), [])
    assert.deepEqual(await kept({ clauses: [equals(['correlationIdentifier'], '')] }), [])
    assert.deepEqual(await kept({ clauses: [equals(['fields', 'requestId'], 0)] }), ['zero'])
  })
})

describe('text search', () => {
  it('looks for text without regard to case, in the JSON text of other values', async () => {
    assert.deepEqual(await kept({ clauses: [contains(['message'], 'ZERO')] }), ['zero', 'text zero'])
    assert.deepEqual(await kept({ clauses: [contains(['fields', 'status'], 'al')] }), ['false'])
    assert.deepEqual(await kept({ clauses: [contains(['fields', 'user'], '"roles":["admin"]')] }), ['zero'])
    assert.deepEqual(await kept({ clauses: [contains(['fields'], 'missing')] }), ['Missing Status'])
  })

  it('reads the normalized timestamp as the UTC time that the viewer shows', async () => {
    assert.deepEqual(await kept({ clauses: [contains(['timestamp'], '2026-10-11T10:0')] }), ['zero', 'false', 'null'])
    assert.deepEqual(await kept({ clauses: [contains(['timestamp'], 'T11:')] }), ['text zero'])
  })

  it('matches no record that lacks the field, also with empty text', async () => {
    assert.deepEqual(await kept({ clauses: [contains(['fields', 'status'], '')] }), ['zero', 'false', 'null', 'text zero'])
    assert.deepEqual(await kept({ clauses: [contains(['timestampText'], '')] }), [])
  })
})

// Upstream issue #19: upstream reduced over the filters and kept only the last result.
describe('combinations', () => {
  it('keeps only the records that every clause keeps, whatever their order', async () => {
    const clauses = [contains(['message'], 'u'), equals(['level'], 'error'), contains(['fields', 'status'], 'u')]
    assert.deepEqual(await kept({ clauses }), ['null'])
    assert.deepEqual(await kept({ clauses: clauses.toReversed() }), ['null'])
    assert.deepEqual(await kept({ clauses: clauses.slice(0, 2) }), ['null', 'Missing Status'])
  })

  it('applies a profile with all or any of its clauses, next to the level and the other clauses', async () => {
    const group = { clauses: [equals(['fields', 'status'], 0), equals(['fields', 'status'], null)] }
    assert.deepEqual(await kept({ profile: { name: 'any', group: { mode: 'any', ...group } } }), ['zero', 'null'])
    assert.deepEqual(await kept({ profile: { name: 'all', group: { mode: 'all', ...group } } }), [])
    assert.deepEqual(await kept({ level: 'error', profile: { name: 'any', group: { mode: 'any', ...group } } }), ['null'])
    assert.deepEqual(await kept({ clauses: [contains(['message'], 'zero')], profile: { name: 'any', group: { mode: 'any', ...group } } }), ['zero'])
  })

  it('applies predicates of plugins after everything else and leaves out the records that they fail on', async () => {
    const longMessage: NamedPredicate = { name: 'isLong', owner: './plugin.mjs', test: record => record.message.length > 4 }
    const failing: NamedPredicate = {
      name: 'failing',
      owner: './plugin.mjs',
      test: record => {
        if (record.message === 'false') {
          throw new Error('cannot judge false')
        }
        return true
      }
    }
    const failures: string[] = []
    const test = filterTest({ ...emptyFilter, clauses: [contains(['message'], 'e')], predicates: [longMessage, failing] }, (predicate, error) => {
      failures.push(`${predicate.name}: ${error instanceof Error ? error.message : String(error)}`)
    })
    assert.ok(test)
    const all = await records()
    assert.deepEqual(all.filter(record => test(record)).map(record => record.message), ['text zero'])
    assert.deepEqual(failures, ['failing: cannot judge false'])
  })

  it('keeps every record without a filter', async () => {
    assert.equal(filterTest(emptyFilter, noFailure), undefined)
    assert.equal(isFilterEmpty(emptyFilter), true)
    assert.equal(isFilterEmpty({ ...emptyFilter, level: 'info' }), false)
    const everything = await kept({})
    assert.equal(everything.length, 5)
  })
})

describe('fields', () => {
  it('start with a part of the record and read own properties only', async () => {
    const [record] = await records()
    assert.ok(record)
    assert.equal(recordValue(record, ['identifier']), '1:1')
    assert.deepEqual(recordValue(record, ['source']), { identifier: '1', label: 'test.log', order: 0 })
    assert.equal(recordValue(record, ['position', 'firstLine']), 1)
    for (const field of [['constructor'], ['fields', 'constructor'], ['fields', '__proto__'], ['message', 'length'], ['toString'], []]) {
      assert.equal(recordValue(record, field), undefined, JSON.stringify(field))
    }
    assert.equal(fieldProblem(['message']), undefined)
    assert.equal(fieldProblem(['msg']), 'must start with a part of the record, identifier, source, position, timestamp, ' +
      'timestampText, level, message, correlationIdentifier, fields; an original field is ["fields","msg"]')
  })

  it('show as paths for people', () => {
    assert.equal(describeField(['fields', 'user', 'name']), 'fields.user.name')
    assert.equal(describeField(['fields', 'log.level', 0, 'a b']), 'fields["log.level"][0]["a b"]')
    assert.deepEqual(describeFilter({
      level: 'warn',
      clauses: [contains(['message'], 'slow'), contains(['message'], 'two words'), equals(['correlationIdentifier'], '0')],
      profile: { name: 'slow checkout', group: { mode: 'any', clauses: [] } },
      predicates: [{ name: 'isLoud', owner: './plugin.mjs', test: () => true }]
    }), ['level=warn', 'message~slow', 'message~"two words"', 'correlationIdentifier="0"', 'profile slow checkout', 'predicate isLoud'])
  })
})
