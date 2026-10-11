import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fixtureUrl, legacyViewerFixtures } from '../src/catalog.js'

describe('legacy viewer fixtures', () => {
  for (const [name, fixture] of Object.entries(legacyViewerFixtures)) {
    it(`${name} has one non-empty line per entry or skipped line`, () => {
      const lines = readFileSync(fixtureUrl(fixture), 'utf8').split('\n').filter(line => line !== '')
      assert.equal(lines.length, fixture.entries + fixture.skippedLines)
    })
  }
})
