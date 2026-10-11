// Filters (plan sections 5 and 6.3, upstream issues #14 and #19): typed clauses on the parts of a record, a named
// profile of the configuration, the normalized level and the predicates of explicitly loaded plugins. Everything that
// is active applies together: the level, every clause, the profile and every predicate must keep a record. A
// profile's mode says whether all of its clauses or at least one must hold.
//
// A clause's field is a path into the record as --output jsonl writes it: ["message"], ["level"] or
// ["correlationIdentifier"] for a normalized part, ["fields", "route"] for an original field. equals compares JSON
// values by type and value with util.isDeepStrictEqual, so 0, false, null and "0" are four different values. contains
// looks for text, ignoring case: text as it is, the normalized timestamp as the UTC time that the viewer shows, and
// any other value as its JSON text. A record that lacks the field matches neither.
import { isDeepStrictEqual } from 'node:util'
import type { FieldPath, FilterClause, FilterGroup, JsonValue, LogLevel, LogRecord, RecordPredicate } from './api.js'
import { valueAtPath } from './field-path.js'

// The parts of a record that a clause's field starts with, in the order of --output jsonl.
const recordParts = [
  'identifier', 'source', 'position', 'timestamp', 'timestampText', 'level', 'message', 'correlationIdentifier', 'fields'
] as const

type RecordPart = typeof recordParts[number]

const recordPartNames: ReadonlySet<string> = new Set(recordParts)

const isRecordPart = (value: unknown): value is RecordPart => typeof value === 'string' && recordPartNames.has(value)

// Why a field names no part of a record, or undefined.
const fieldProblem = (field: FieldPath): string | undefined => isRecordPart(field[0])
  ? undefined
  : `must start with a part of the record, ${recordParts.join(', ')}; an original field is ${JSON.stringify(['fields', ...field])}`

// A part of a record as a JSON value.
const partValue = (record: LogRecord, part: RecordPart): JsonValue | undefined => {
  switch (part) {
    case 'identifier': {
      return record.identifier
    }
    case 'source': {
      const { identifier, label, order } = record.source
      return { identifier, label, order }
    }
    case 'position': {
      const { recordNumber, firstLine, lastLine } = record.position
      return { recordNumber, firstLine, lastLine }
    }
    case 'timestamp': {
      return record.timestamp
    }
    case 'timestampText': {
      return record.timestampText
    }
    case 'level': {
      return record.level
    }
    case 'message': {
      return record.message
    }
    case 'correlationIdentifier': {
      return record.correlationIdentifier
    }
    case 'fields': {
      return record.fields
    }
  }
}

// The value at a field of a record, or undefined when the record lacks it. Paths read own properties only.
const recordValue = (record: LogRecord, field: FieldPath): JsonValue | undefined => {
  const [part, ...rest] = field
  if (!isRecordPart(part)) {
    return undefined
  }
  const value = partValue(record, part)
  return value === undefined || rest.length === 0 ? value : valueAtPath(value, rest)
}

const isTimestampField = (field: FieldPath): boolean => field.length === 1 && field[0] === 'timestamp'

// The text that contains looks into.
const searchedText = (field: FieldPath, value: JsonValue): string => {
  if (typeof value === 'string') {
    return value
  }
  return typeof value === 'number' && isTimestampField(field) ? new Date(value).toISOString() : JSON.stringify(value)
}

type RecordTest = (record: LogRecord) => boolean

const clauseTest = (clause: FilterClause): RecordTest => {
  const { field } = clause
  if (clause.operator === 'equals') {
    const expected = clause.value
    return record => {
      const value = recordValue(record, field)
      return value !== undefined && isDeepStrictEqual(value, expected)
    }
  }
  const term = clause.value.toLowerCase()
  return record => {
    const value = recordValue(record, field)
    return value !== undefined && searchedText(field, value).toLowerCase().includes(term)
  }
}

// A group keeps a record when all of its clauses or at least one of them hold; an any group without clauses keeps none.
const groupTest = (group: FilterGroup): RecordTest => {
  const tests = group.clauses.map(clause => clauseTest(clause))
  return group.mode === 'all'
    ? record => tests.every(test => test(record))
    : record => tests.some(test => test(record))
}

// A predicate of a plugin under its name.
interface NamedPredicate {
  readonly name: string
  // The plugin's --plugin argument, for messages.
  readonly owner: string
  readonly test: RecordPredicate
}

// A profile of the configuration under its name.
interface ProfileSelection {
  readonly name: string
  readonly group: FilterGroup
}

// What keeps a record: the level, every clause, the profile and every predicate.
interface RecordFilter {
  readonly level?: LogLevel | undefined
  readonly clauses: readonly FilterClause[]
  readonly profile?: ProfileSelection | undefined
  readonly predicates: readonly NamedPredicate[]
}

const emptyFilter: RecordFilter = { clauses: [], predicates: [] }

const isFilterEmpty = (filter: RecordFilter): boolean =>
  filter.level === undefined && filter.clauses.length === 0 && filter.profile === undefined && filter.predicates.length === 0

// Called when a predicate throws; the record is left out.
type PredicateFailure = (predicate: NamedPredicate, error: unknown) => void

// The test of the clauses, the profile and the predicates, without the level, which callers can check from the store
// before they read a record; undefined when they keep every record.
const recordTest = (filter: RecordFilter, onFailure: PredicateFailure): RecordTest | undefined => {
  const tests: RecordTest[] = filter.clauses.map(clause => clauseTest(clause))
  if (filter.profile !== undefined) {
    tests.push(groupTest(filter.profile.group))
  }
  for (const predicate of filter.predicates) {
    tests.push(record => {
      try {
        return predicate.test(record)
      } catch (error) {
        onFailure(predicate, error)
        return false
      }
    })
  }
  return tests.length <= 1 ? tests[0] : record => tests.every(test => test(record))
}

// The test of the whole filter, the level included; undefined when it keeps every record.
const filterTest = (filter: RecordFilter, onFailure: PredicateFailure): RecordTest | undefined => {
  const test = recordTest(filter, onFailure)
  const { level } = filter
  if (level === undefined) {
    return test
  }
  return test === undefined ? record => record.level === level : record => record.level === level && test(record)
}

// Keys that a path shows after a dot; any other key shows in brackets as JSON text.
const plainKeyPattern = /^[$A-Z_a-z][\w$-]*$/u

// A field for people: ["fields", "user", "name"] as fields.user.name, ["fields", "log.level"] as fields["log.level"].
const describeField = (field: FieldPath): string => field.map((segment, index) => {
  if (typeof segment === 'number') {
    return `[${String(segment)}]`
  }
  if (!plainKeyPattern.test(segment)) {
    return `[${JSON.stringify(segment)}]`
  }
  return index === 0 ? segment : `.${segment}`
}).join('')

// Terms that show without quotes after ~.
const plainTermPattern = /^[^\s",]+$/u

// A clause for people: field=JSON value for equals, field~text for contains.
const describeClause = (clause: FilterClause): string => clause.operator === 'equals'
  ? `${describeField(clause.field)}=${JSON.stringify(clause.value)}`
  : `${describeField(clause.field)}~${plainTermPattern.test(clause.value) ? clause.value : JSON.stringify(clause.value)}`

// The parts of a filter for people, in the order in which they apply.
const describeFilter = (filter: RecordFilter): string[] => [
  ...filter.level === undefined ? [] : [`level=${filter.level}`],
  ...filter.clauses.map(clause => describeClause(clause)),
  ...filter.profile === undefined ? [] : [`profile ${filter.profile.name}`],
  ...filter.predicates.map(predicate => `predicate ${predicate.name}`)
]

export {
  describeClause, describeField, describeFilter, emptyFilter, fieldProblem, filterTest, isFilterEmpty, recordParts,
  recordTest, recordValue
}
export type { NamedPredicate, PredicateFailure, ProfileSelection, RecordFilter, RecordTest }
