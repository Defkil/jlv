// Characterization of how upstream src/log.js turns lines into rows and applies a [transform] mapping. The
// expectations were recorded from the upstream module, except where a test names the change.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { MappingFileError, parseEntry, parseLine, readLog, readMapping, timeKey, transform } from '../src/log.js'
import { valueAt } from './support/fixtures.js'

const textReader = (text: string): { readonly readFileSync: () => string } => ({ readFileSync: () => text })

// Runs the check with HOME and USERPROFILE pointing at another directory and restores both afterwards.
const withHome = (home: string, check: () => void): void => {
  const names = ['HOME', 'USERPROFILE'] as const
  const previous = names.map(name => process.env[name])
  for (const name of names) {
    process.env[name] = home
  }
  try {
    check()
  } finally {
    for (const [index, name] of names.entries()) {
      const value = previous[index]
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name)
      } else {
        process.env[name] = value
      }
    }
  }
}

describe('readLog lines', () => {
  it('keeps text, arrays and true as rows and drops false, 0, empty text and blank lines', () => {
    assert.deepEqual(readLog('', textReader('"abc"\n[1,2]\ntrue\nfalse\n0\n""\n7\n{}\n  \n')), [
      { data: { 0: 'a', 1: 'b', 2: 'c' } },
      { data: { 0: 1, 1: 2 } },
      { data: {} },
      { data: {} },
      { data: {} }
    ])
  })

  // Upstream split the text at line feeds only and dropped the first line when it started with a byte order mark,
  // which JSON.parse rejects; the line framing of plan section 6.1 removes the mark.
  it('accepts CRLF line ends and a byte order mark at the start', () => {
    assert.deepEqual(readLog('', textReader('\u{FEFF}{"message":"bom"}\r\n{"message":"crlf","level":"info"}\r\n')), [
      { message: 'bom', data: {} },
      { level: 'info', message: 'crlf', data: {} }
    ])
  })

  it('keeps null and false in the known fields and orders them before data', () => {
    const [entry] = readLog('', textReader('{"z":1,"message":"m","level":false,"timestamp":null,"a":2}\n'))
    assert.deepEqual(entry, { timestamp: null, level: false, message: 'm', data: { z: 1, a: 2 } })
    assert.deepEqual(Object.keys(entry), ['timestamp', 'level', 'message', 'data'])
  })

  it('decodes a buffer as UTF-8', () => {
    assert.deepEqual(readLog('', { readFileSync: () => Buffer.from('{"message":"b\u{E9}"}\n') }), [{ message: 'b\u{E9}', data: {} }])
  })

  // Upstream looked for the mapping file again for every record and dropped every line while it could not be read.
  it('reports a mapping file that cannot be read as a configuration error', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'jlv-unreadable-home-'))
    try {
      mkdirSync(path.join(home, '.json-log-viewer'))
      withHome(home, () => {
        assert.throws(() => readMapping(), MappingFileError)
        assert.throws(() => readLog('', textReader('{"message":"m"}\n')), /^MappingFileError: cannot read the mapping file /u)
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
    assert.equal(readLog('', textReader('{"message":"m"}\n')).length, 1)
  })

  // Upstream mapped through the characters of the text: every record became { 0: undefined }.
  it('ignores a transform key outside a [transform] section', () => {
    const record = { message: 'm' }
    assert.equal(readMapping({ existsSync: () => true, readFileSync: () => 'transform=x\n' }), undefined)
    assert.equal(transform(record, undefined), record)
  })
})

describe('parseLine', () => {
  it('tells records, empty lines and skipped lines apart', () => {
    assert.deepEqual(parseLine('{"a":1}', undefined), { kind: 'record', value: { a: 1 } })
    assert.deepEqual(parseLine('7', undefined), { kind: 'record', value: 7 })
    assert.deepEqual(parseLine('', undefined), { kind: 'blank' })
    assert.deepEqual(parseLine(' \t\r', undefined), { kind: 'blank' })
    assert.deepEqual(parseLine('{"a":', undefined), { kind: 'skipped', reason: 'invalid-json' })
    for (const empty of ['null', 'false', '0', '""']) {
      assert.deepEqual(parseLine(empty, undefined), { kind: 'skipped', reason: 'empty-value' })
    }
  })

  // As upstream, the mapping applies before the falsy test, so a null line becomes a record of undefined fields.
  it('maps a line before it drops falsy values', () => {
    assert.deepEqual(parseLine('null', { message: 'msg' }), { kind: 'record', value: { message: undefined } })
  })
})

describe('transform mapping', () => {
  // Upstream's lodash.get also read inherited members: c=constructor gave the Object function.
  it('resolves lodash paths to own fields, prefers an exact dotted key and copies the record for $', () => {
    const record = { a: { b: [{ c: 'deep' }] }, 'x.y': 'dotted', top: 'v' }
    const fileSystem = {
      existsSync: () => true,
      readFileSync: () => '[transform]\nm=a.b[0].c\nd=x.y\nt=top\nmissing=nope.nothing\nall=$\nempty=\nc=constructor\np=a.__proto__\n'
    }
    const mapped = transform(record, readMapping(fileSystem))
    assert.deepEqual(mapped, { m: 'deep', d: 'dotted', t: 'v', missing: undefined, all: record, empty: undefined, c: undefined, p: undefined })
    assert.notEqual(valueAt(mapped, ['all']), record)
  })
})

describe('parseEntry', () => {
  it('gives the row of a stored record again', () => {
    assert.deepEqual(parseEntry('{"message":"m","a":1}', undefined), { message: 'm', data: { a: 1 } })
    assert.deepEqual(parseEntry('{"msg":"m"}', { message: 'msg' }), { message: 'm', data: {} })
  })
})

describe('timeKey', () => {
  it('reads finite numbers as epoch milliseconds and RFC 3339 text with a zone', () => {
    assert.equal(timeKey({ timestamp: 0 }), 0)
    assert.equal(timeKey({ timestamp: -1500 }), -1500)
    assert.equal(timeKey({ timestamp: '2026-10-11T10:00:00.000Z' }), Date.UTC(2026, 9, 11, 10))
    assert.equal(timeKey({ timestamp: '2026-10-11 10:00:00z' }), Date.UTC(2026, 9, 11, 10))
    assert.equal(timeKey({ timestamp: '2026-10-11t12:00:00+02:00' }), Date.UTC(2026, 9, 11, 10))
    assert.equal(timeKey({ timestamp: '2017-12-06T09:23:42.253060Z' }), Date.UTC(2017, 11, 6, 9, 23, 42, 253))
  })

  it('gives NaN for a missing, naive, unparseable or non-finite time and for other types', () => {
    for (const record of [
      {}, { timestamp: null }, { timestamp: '2017-12-06 09:23:42.253060' }, { timestamp: 'yesterday' }, { timestamp: '1700000000000' },
      { timestamp: Infinity }, { timestamp: true }, { timestamp: { date: '2026-10-11T10:00:00Z' } }, 'text', 42, [1]
    ]) {
      assert.ok(Number.isNaN(timeKey(record)), JSON.stringify(record))
    }
  })
})
