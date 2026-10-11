// Characterization of the upstream command line (src/index.js) as a spawned process with pipes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'

const cli = fileURLToPath(new URL('../src/index.js', import.meta.url))
const characterization = fixturePath(legacyViewerFixtures.characterization)
// blessed sizes the screen from stdout; a pipe has no size, so the size is given before the CLI starts.
const terminalSize = 'data:text/javascript,process.stdout.columns=80;process.stdout.rows=24'

interface Result {
  readonly code: number | null
  readonly output: string
}

// blessed moves the cursor over blank cells instead of writing spaces, so row text is compared without spaces.
const compact = (text: string): string => text.replaceAll(' ', '')

interface RunOptions {
  readonly keys?: string
  readonly isSized?: boolean
}

// Starts the CLI, sends the keys after its first screen output, and collects output until it exits.
const run = async (parameters: readonly string[], options: RunOptions = {}): Promise<Result> => {
  const preload = options.isSized === false ? [] : ['--import', terminalSize]
  const child = spawn(process.execPath, [...preload, cli, ...parameters], {
    cwd: path.dirname(characterization),
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let output = ''
  let hasSentKeys = false
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
  return { code, output: stripVTControlCharacters(output) }
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
    // The constructor renders once before the file is loaded.
    assert.match(result.output, /\[ undefined \]\[ 1\/0 \]/u)
    assert.match(result.output, /\[ characterization\.log \] \[ 1\/32 \]/u)
    assert.match(compact(result.output), /foxtrot29/u)
    assert.match(result.output, /sort: -timestamp/u)
  })

  it('exits with 0 on Ctrl-C', async () => {
    const result = await run(['characterization.log'], { keys: '\u{3}' })
    assert.equal(result.code, 0)
  })

  it('applies -l and --sort from the command line', async () => {
    const level = await run(['-l', 'error', 'characterization.log'], { keys: 'q' })
    assert.match(level.output, /\[ characterization\.log \] \[ 1\/7 \]/u)
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
})
