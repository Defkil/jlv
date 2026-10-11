// Upstream test/log.test.js, moved to node:test with unchanged assertions.
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { readUpstreamFixture, valueAt } from './support/fixtures.js'
import { loadLegacyLog, type LegacyEntry } from './support/legacy.js'

const { readLog, transform } = loadLegacyLog()

describe('readLog', () => {
  let entries: LegacyEntry[] = []

  describe('normal log', () => {
    before(() => {
      const contents = readUpstreamFixture('workflow-engine.log.2017-09-25')
      entries = readLog('', { readFileSync: () => contents })
    })

    it('sets timestamp', () => {
      assert.equal(entries[0]?.timestamp, '2017-09-25T22:48:38.035Z')
    })

    it('sets level', () => {
      assert.equal(entries[0]?.level, 'debug')
    })

    it('sets message', () => {
      assert.equal(entries[0]?.message, 'Updated instance \'hemo\' with attributes')
    })

    it('sets data', () => {
      assert.equal(valueAt(entries[0]?.data, ['to', 'type']), 'workflow-instance')
    })
  })

  describe('log with invalid entries', () => {
    before(() => {
      const contents = readUpstreamFixture('broken.log')
      entries = readLog('', { readFileSync: () => contents })
    })

    it('skips invalid entries', () => {
      assert.equal(entries.length, 3)
    })
  })
})

describe('transform', () => {
  let hasConfig = false
  let contents: string | null = null

  const fileSystem = {
    existsSync: () => hasConfig,
    readFileSync: () => contents
  }

  describe('when config doesn\'t exist', () => {
    it('returns the unmodified line', () => {
      assert.equal(transform('something', fileSystem), 'something')
    })
  })

  describe('when config exists', () => {
    it('transforms the line', () => {
      hasConfig = true
      contents = readUpstreamFixture('transform1.ini')
      const logEntry: unknown = JSON.parse(readUpstreamFixture('monolog.log.json'))
      const entry = transform(logEntry, fileSystem)
      assert.equal(valueAt(entry, ['timestamp']), '2017-12-06 09:23:42.253060')
      assert.equal(valueAt(entry, ['level']), 'INFO')
    })
  })
})
