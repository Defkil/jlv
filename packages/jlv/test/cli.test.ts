// Characterization of the command line (src/cli.ts, upstream src/index.js) as a spawned process with pipes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const characterization = fixturePath(legacyViewerFixtures.characterization)
// blessed sizes the screen from stdout; a pipe has no size, so the size is given before the CLI starts.
const terminalSize = 'data:text/javascript,process.stdout.columns=80;process.stdout.rows=24'

interface Result {
  readonly code: number | null
  readonly output: string
  readonly errors: string
}

// blessed moves the cursor over blank cells instead of writing spaces, so row text is compared without spaces.
const compact = (text: string): string => text.replaceAll(' ', '')

interface RunOptions {
  readonly keys?: string
  readonly isSized?: boolean
}

// Starts the CLI, sends the keys after its first screen output, and collects both outputs until it exits.
const run = async (parameters: readonly string[], options: RunOptions = {}): Promise<Result> => {
  const preload = options.isSized === false ? [] : ['--import', terminalSize]
  const child = spawn(process.execPath, [...preload, cli, ...parameters], {
    cwd: path.dirname(characterization),
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let output = ''
  let errors = ''
  let hasSentKeys = false
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    errors += chunk
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
    if (hasSentKeys || options.keys === undefined) {
      return
    }
    hasSentKeys = true
    child.stdin.write(options.keys)
  })
  const timer = setTimeout(() => { child.kill() }, 10_000)
  const code = await new Promise<number | null>(resolve => {
    child.on('exit', exitCode => { resolve(exitCode) })
  })
  clearTimeout(timer)
  return { code, output: stripVTControlCharacters(output), errors }
}

describe('command line', () => {
  it('exits with 1 and a message without a log file', async () => {
    const result = await run([])
    assert.equal(result.code, 1)
    assert.equal(result.output, 'error: missing log file\n')
  })

  it('renders the file and exits with 0 on q', async () => {
    const result = await run(['characterization.log'], { keys: 'q' })
    assert.equal(result.code, 0)
    // Since upstream PR #13 the panel shows no file label; the status line carries the position.
    assert.doesNotMatch(result.output, /characterization\.log/u)
    assert.match(compact(result.output), /foxtrot29/u)
    assert.match(result.output, /NORMAL {2}1\/32 \| 20 \| sort: -timestamp/u)
  })

  it('exits with 0 on Ctrl-C', async () => {
    const result = await run(['characterization.log'], { keys: '\u{3}' })
    assert.equal(result.code, 0)
  })

  it('applies -l and --sort from the command line', async () => {
    const level = await run(['-l', 'error', 'characterization.log'], { keys: 'q' })
    assert.match(level.output, /NORMAL {2}1\/7 /u)
    assert.match(compact(level.output), /delta27/u)
    assert.doesNotMatch(compact(level.output), /foxtrot29/u)
    assert.match(level.output, /filters: level:error/u)
    const sort = await run(['--sort', 'level', 'characterization.log'], { keys: 'q' })
    assert.match(sort.output, /sort: level/u)
  })

  it('renders into a single cell when stdout is a pipe without a size', async () => {
    const result = await run(['characterization.log'], { keys: 'q', isSized: false })
    assert.equal(result.code, 0)
    assert.doesNotMatch(result.output, /characterization\.log/u)
  })

  it('filters numeric levels given with -l as numbers', async () => {
    const result = await run(['-l', '30', 'numeric-levels.log'], { keys: 'q' })
    assert.equal(result.code, 0)
    assert.match(result.output, /NORMAL {2}1\/2 \| 20 \| sort: -timestamp \| filters: level:30/u)
    assert.match(compact(result.output), /numericinfoagain/u)
    assert.doesNotMatch(compact(result.output), /numericwarn/u)
  })

  // minimist reads --sort -timestamp as a --sort flag without a value, so the README's example fails like upstream.
  it('fails with exit code 1 when --sort gets no field name', async () => {
    const result = await run(['characterization.log', '--sort', '-timestamp'])
    assert.equal(result.code, 1)
    assert.match(result.errors, /TypeError/u)
  })

  // Upstream crashed inside blessed and its exception handler with exit code 7.
  it('fails with exit code 1 when --log gets no file name', async () => {
    const result = await run(['characterization.log', '--log'])
    assert.equal(result.code, 1)
    assert.match(result.errors, /TypeError: The --log option needs a text value\./u)
  })
})
