// Characterization of the command line (src/cli.ts, upstream src/index.js) as a spawned process with pipes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  readonly directory?: string
}

// Starts the CLI, sends the keys after its first screen output, and collects both outputs until it exits.
const run = async (parameters: readonly string[], options: RunOptions = {}): Promise<Result> => {
  const preload = options.isSized === false ? [] : ['--import', terminalSize]
  const child = spawn(process.execPath, [...preload, cli, ...parameters], {
    cwd: options.directory ?? path.dirname(characterization),
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
    // The border label shows the file name and the cursor position again (plan section 0.10).
    assert.match(compact(result.output), /\[characterization\.log\]\[1\/32\]/u)
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

  it('accepts a sort field that starts with a dash in the = form', async () => {
    const result = await run(['--sort=-level', 'characterization.log'], { keys: 'q' })
    assert.equal(result.code, 0)
    assert.match(result.output, /NORMAL {2}1\/32 \| 20 \| sort: -level/u)
  })

  // minimist read --sort -timestamp as a --sort flag without a value, and upstream crashed on it while loading the
  // file with exit code 1; the README's own example failed that way. parseArgs reports it as a usage error.
  it('rejects --sort without a field name or with a dash-prefixed value as a usage error with exit code 2', async () => {
    const missing = await run(['characterization.log', '--sort'])
    assert.equal(missing.code, 2)
    assert.equal(missing.output, '')
    assert.match(missing.errors, /^jv: Option '-s, --sort <value>' argument missing\n/u)
    assert.match(missing.errors, /\nusage: jv \[-l <level>\] \[-s <field>\] \[--log <file>\] <log-file>\n$/u)
    const ambiguous = await run(['characterization.log', '--sort', '-timestamp'])
    assert.equal(ambiguous.code, 2)
    assert.match(ambiguous.errors, /^jv: Option '--sort' argument is ambiguous\./u)
  })

  // Upstream crashed inside blessed and its exception handler with exit code 7.
  it('rejects --log without a file name as a usage error with exit code 2', async () => {
    const result = await run(['characterization.log', '--log'])
    assert.equal(result.code, 2)
    assert.match(result.errors, /^jv: Option '--log <value>' argument missing\n/u)
  })

  // minimist accepted any option, and minimist 1.2.0 wrote --__proto__.x into Object.prototype (CVE-2020-7598).
  it('rejects unknown options, including prototype keys, as usage errors with exit code 2', async () => {
    const unknown = await run(['--transformer', 'pino', 'characterization.log'])
    assert.equal(unknown.code, 2)
    assert.match(unknown.errors, /^jv: Unknown option '--transformer'\./u)
    const prototypeKey = await run(['--__proto__.polluted=yes', 'characterization.log'])
    assert.equal(prototypeKey.code, 2)
    assert.match(prototypeKey.errors, /^jv: Unknown option '--__proto__\.polluted'\./u)
  })

  // minimist turned numeric arguments into numbers: jv 5 read file descriptor 5, and jv 0 reported a missing file.
  it('reads a numeric argument as a file name', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'jlv-numeric-name-'))
    try {
      copyFileSync(characterization, path.join(directory, '5'))
      copyFileSync(characterization, path.join(directory, '0'))
      for (const name of ['5', '0']) {
        const result = await run([name], { keys: 'q', directory })
        assert.equal(result.code, 0)
        assert.match(result.output, /NORMAL {2}1\/32 \| 20 \| sort: -timestamp/u)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
