// Characterization of the ~/.json-log-viewer [transform] mapping. Upstream loads the file once per
// process and keeps it, so this test file sets up its own home directory before the first read.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { readUpstreamFixture } from './support/fixtures.js'
import log from '../src/log.js'
import { openFileViewer, plainTopBorder, screenText } from './support/terminal.js'

const home = mkdtempSync(path.join(tmpdir(), 'jlv-config-home-'))
process.env['HOME'] = home
process.env['USERPROFILE'] = home
after(() => {
  process.chdir(tmpdir())
  rmSync(home, { recursive: true, force: true })
})

const configFile = path.join(home, '.json-log-viewer')
const logFile = path.join(home, 'monolog.log')
const monolog: unknown = JSON.parse(readUpstreamFixture('monolog.log.json'))
const withoutDate = { message: 'no datetime', level_name: 'DEBUG', channel: 'app' }
writeFileSync(configFile, readUpstreamFixture('transform1.ini'))
writeFileSync(logFile, `${JSON.stringify(monolog)}\n${JSON.stringify(withoutDate)}\n`)

describe('transform configuration', () => {
  it('maps fields through dotted paths and copies the whole record to extra with $', () => {
    const [entry] = log.readLog(logFile)
    assert.deepEqual(entry, {
      timestamp: '2017-12-06 09:23:42.253060',
      level: 'INFO',
      message: String.raw`Matched route "**_heartbeat_check" (parameters: "_controller": "**\Controller\**Controller::heartbeatCheckAction", "_route": "**_heartbeat_check")`,
      data: { extra: monolog }
    })
  })

  it('leaves a missing mapped path undefined', () => {
    const [, entry] = log.readLog(logFile)
    assert.deepEqual(entry, { timestamp: undefined, level: 'DEBUG', message: 'no datetime', data: { extra: withoutDate } })
  })

  it('keeps the first configuration for the rest of the process', () => {
    writeFileSync(configFile, '[transform]\nmessage=channel\n')
    const [, entry] = log.readLog(logFile)
    assert.equal(entry?.message, 'no datetime')
  })

  it('shows mapped records and an undefined timestamp in the viewer', t => {
    const viewer = openFileViewer(t, logFile)
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], plainTopBorder())
    assert.equal(rows[1], '│ undefined                            DEBUG  *  no datetime                   │')
    assert.equal(rows[2], '│                                                                              │')
    assert.equal(rows[3], '│ 2017-12-06 09:23:42.253060  INFO  *  Matched route "**_heartbeat_check" (p   │')
  })
})
