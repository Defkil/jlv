import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fixtureUrl, legacyViewerFixtures, pinoFixtures } from '../src/catalog.js'

const lines = (url: URL): string[] => readFileSync(url, 'utf8').split('\n').filter(line => line !== '')

const parse = (line: string): unknown => JSON.parse(line)

const field = (record: unknown, key: string): unknown =>
  typeof record === 'object' && record !== null ? Object.getOwnPropertyDescriptor(record, key)?.value : undefined

describe('legacy viewer fixtures', () => {
  for (const [name, fixture] of Object.entries(legacyViewerFixtures)) {
    it(`${name} has one non-empty line per entry or skipped line`, () => {
      assert.equal(lines(fixtureUrl(fixture)).length, fixture.entries + fixture.skippedLines)
    })
  }
})

describe('pino fixtures from jlv-pino', () => {
  it('keep the mapping file of jlv-pino unchanged', () => {
    assert.deepEqual(lines(fixtureUrl(pinoFixtures.mapping)), ['[transform]', 'timestamp=time', 'message=msg', 'level=level', 'extra=$'])
  })

  // jlv-pino replaced "level":10 with "level":"trace" and so on up to 60 and fatal.
  it('hold one record per numeric pino level, in the order of the expected names', () => {
    const records = lines(fixtureUrl(pinoFixtures.levels)).map(line => parse(line))
    assert.deepEqual(records.map(record => field(record, 'level')), [10, 20, 30, 40, 50, 60])
    assert.deepEqual(records.map(record => field(record, 'msg')), pinoFixtures.levels.levels.map(level => `${level} message`))
  })
})
