// Characterization of the ~/.json-log-viewer [transform] mapping. This test file sets up its own home directory
// before the first read.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { readUpstreamFixture } from './support/fixtures.js'
import { readLog } from '../src/log.js'
import { openFileViewer, screenText, topBorder } from './support/terminal.js'

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
    const [entry] = readLog(logFile)
    assert.deepEqual(entry, {
      timestamp: '2017-12-06 09:23:42.253060',
      level: 'INFO',
      message: String.raw`Matched route "**_heartbeat_check" (parameters: "_controller": "**\Controller\**Controller::heartbeatCheckAction", "_route": "**_heartbeat_check")`,
      data: { extra: monolog }
    })
  })

  it('leaves a missing mapped path undefined', () => {
    const [, entry] = readLog(logFile)
    assert.deepEqual(entry, { timestamp: undefined, level: 'DEBUG', message: 'no datetime', data: { extra: withoutDate } })
  })

  // Upstream kept the first mapping it found for the rest of the process and looked for the file again for every
  // record until then. The mapping is read once for each read of the log now.
  it('reads the mapping file once for each read of the log', () => {
    writeFileSync(configFile, '[transform]\nmessage=channel\n')
    try {
      const [, entry] = readLog(logFile)
      assert.deepEqual(entry, { message: 'app', data: {} })
    } finally {
      writeFileSync(configFile, readUpstreamFixture('transform1.ini'))
    }
  })

  // Neither record has a time that the viewer can sort by: Monolog's date has no zone, and the second record has
  // none at all. Both sort last, so they keep their order; upstream showed the undefined timestamp first and as text.
  it('shows mapped records in their order and a missing timestamp as empty', t => {
    const viewer = openFileViewer(t, logFile)
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], topBorder('monolog.log', '1/2'))
    assert.equal(rows[1], '│ 2017-12-06 09:23:42.253060  INFO  *  Matched route "**_heartbeat_check" (p   │')
    assert.equal(rows[2], '│                             DEBUG  *  no datetime                            │')
  })
})
