// Characterization of how upstream src/log.js turns lines into rows and applies a [transform] mapping. The
// expectations were recorded from the upstream module. The mapping stays loaded for the rest of the process once
// found, so the tests that read rows without a mapping come first.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import log from '../src/log.js'
import { valueAt } from './support/fixtures.js'

const { readLog, transform } = log

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

  it('accepts CRLF line ends but drops a first line that starts with a byte order mark', () => {
    assert.deepEqual(readLog('', textReader('\u{FEFF}{"message":"bom"}\r\n{"message":"crlf","level":"info"}\r\n')), [
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

  it('drops every line while the configuration file cannot be read', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'jlv-unreadable-home-'))
    try {
      mkdirSync(path.join(home, '.json-log-viewer'))
      withHome(home, () => {
        assert.deepEqual(readLog('', textReader('{"message":"m"}\n')), [])
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
    assert.equal(readLog('', textReader('{"message":"m"}\n')).length, 1)
  })
})

describe('transform mapping', () => {
  it('resolves lodash paths, prefers an exact dotted key and copies the record for $', () => {
    const record = { a: { b: [{ c: 'deep' }] }, 'x.y': 'dotted', top: 'v' }
    const fileSystem = {
      existsSync: () => true,
      readFileSync: () => '[transform]\nm=a.b[0].c\nd=x.y\nt=top\nmissing=nope.nothing\nall=$\nempty=\n'
    }
    const mapped = transform(record, fileSystem)
    assert.deepEqual(mapped, { m: 'deep', d: 'dotted', t: 'v', missing: undefined, all: record, empty: undefined })
    assert.notEqual(valueAt(mapped, ['all']), record)
  })
})
