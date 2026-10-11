// Characterization of the ~/.json-log-viewer [transform] mapping. This test file sets up its own home directory
// before the first read.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { loadConfiguration } from '../src/configuration.js'
import type { LogRow } from '../src/tui/log-row.js'
import { readUpstreamFixture } from './support/fixtures.js'
import { readRecords, rowsOf } from './support/records.js'
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

// The rows of the log file with the mapping of the home directory, as a run reads them.
const mappedRows = async (): Promise<LogRow[]> => {
  const configuration = loadConfiguration({ workingDirectory: home, home, isDiscoveryDisabled: false })
  const { records } = await readRecords(readFileSync(logFile), { mapping: configuration.mapping })
  return rowsOf(records, { legacyExtras: configuration.legacyExtras })
}

// The parts of a row that the widgets show.
const shown = (row: LogRow | undefined): object => ({ timestamp: row?.timestamp, level: row?.level, message: row?.message, data: row?.data })

describe('transform configuration', () => {
  // The level is normalized now; the raw INFO stays in the record's fields.
  it('maps fields through dotted paths and copies the whole record to extra with $', async () => {
    const [row] = await mappedRows()
    assert.deepEqual(shown(row), {
      timestamp: '2017-12-06 09:23:42.253060',
      level: 'info',
      message: String.raw`Matched route "**_heartbeat_check" (parameters: "_controller": "**\Controller\**Controller::heartbeatCheckAction", "_route": "**_heartbeat_check")`,
      data: { extra: monolog }
    })
  })

  it('leaves a missing mapped path empty', async () => {
    const [, row] = await mappedRows()
    assert.deepEqual(shown(row), { timestamp: undefined, level: 'debug', message: 'no datetime', data: { extra: withoutDate } })
  })

  // Upstream kept the first mapping it found for the rest of the process and looked for the file again for every
  // record until then. The mapping is read once per run now.
  it('reads the mapping file again for each run', async () => {
    writeFileSync(configFile, '[transform]\nmessage=channel\n')
    try {
      const [, row] = await mappedRows()
      assert.deepEqual(shown(row), { timestamp: undefined, level: undefined, message: 'app', data: {} })
    } finally {
      writeFileSync(configFile, readUpstreamFixture('transform1.ini'))
    }
  })

  // Neither record has a time that the viewer can sort by: Monolog's date has no zone, and the second record has
  // none at all. Both sort last, so they keep their order; upstream showed the undefined timestamp first and as text.
  // The levels are normalized and colored now; upstream showed Monolog's INFO and DEBUG as they were.
  it('shows mapped records in their order and a missing timestamp as empty', t => {
    const viewer = openFileViewer(t, logFile)
    const rows = screenText(viewer.screen)
    assert.equal(rows[0], topBorder('monolog.log', '1/2'))
    assert.equal(rows[1], '│ 2017-12-06 09:23:42.253060  info   *  Matched route "**_heartbeat_check" (…  │')
    assert.equal(rows[2], '│                             debug  *  no datetime                            │')
    assert.match(rows[23] ?? '', /\| 2 warnings$/u)
  })
})
