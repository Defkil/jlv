// The command line (src/cli.ts) as a spawned process: help, version and usage errors without a screen, plain and JSON
// lines when standard output is no terminal, live standard input, a reader that goes away, signals, the viewer on a
// pretended terminal, and the plain fallback of a process without a console (plan sections 6.1 and 8, phase 5).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { fixturePath, legacyViewerFixtures, pinoFixtures } from '../../format-fixtures/src/catalog.js'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const characterization = fixturePath(legacyViewerFixtures.characterization)
const fixtures = path.dirname(characterization)
const directory = mkdtempSync(path.join(tmpdir(), 'jlv-cli-'))
after(() => {
  rmSync(directory, { recursive: true, force: true })
})

// A pipe has no size and no terminal, so these preloads pretend one: the size for blessed, and isTTY for the choice of
// the output. With a pretended standard input, the viewer reads its keys from the pipe.
const sizedOutput = 'process.stdout.columns=80;process.stdout.rows=24;process.stdout.isTTY=true;'
const pretendedTerminal = `data:text/javascript,${sizedOutput}process.stdin.isTTY=true`
const pretendedOutput = `data:text/javascript,${sizedOutput}`

interface Result {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly output: string
  readonly errors: string
  readonly milliseconds: number
}

interface RunOptions {
  // Written to standard input, which then ends.
  readonly input?: string
  // Sent to standard input once the screen output is quiet, for the viewer on a pretended terminal.
  readonly keys?: string
  readonly preload?: string
  readonly directory?: string
  // A detached child has no console on Windows and no controlling terminal on POSIX systems.
  readonly isDetached?: boolean
  // Called with the child, for tests that drive its streams themselves.
  readonly drive?: (child: ReturnType<typeof spawn>) => void
}

// The screen output is quiet for this long before the keys go out.
const quietPeriod = 300

const run = async (parameters: readonly string[], options: RunOptions = {}): Promise<Result> => {
  const started = performance.now()
  const preload = options.preload === undefined ? [] : ['--import', options.preload]
  const child = spawn(process.execPath, [...preload, cli, ...parameters], {
    cwd: options.directory ?? fixtures,
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: options.isDetached === true,
    windowsHide: true
  })
  let output = ''
  let errors = ''
  let keyTimer: NodeJS.Timeout | undefined
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    errors += chunk
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
    const { keys } = options
    if (keys === undefined) {
      return
    }
    clearTimeout(keyTimer)
    keyTimer = setTimeout(() => { child.stdin.write(keys) }, quietPeriod)
  })
  child.stdin.on('error', () => {
    // A child that stops reading makes writes to its standard input fail; some tests end it that way.
  })
  if (options.input !== undefined) {
    child.stdin.end(options.input)
  }
  options.drive?.(child)
  const timer = setTimeout(() => { child.kill('SIGKILL') }, 15_000)
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => {
    child.on('close', (exitCode, exitSignal) => { resolve([exitCode, exitSignal]) })
  })
  clearTimeout(timer)
  clearTimeout(keyTimer)
  return { code, signal, output, errors, milliseconds: performance.now() - started }
}

// blessed moves the cursor over blank cells instead of writing spaces, so screen text is compared without spaces.
const compact = (text: string): string => stripVTControlCharacters(text).replaceAll(' ', '')

const record = (minute: number, message: string): string =>
  `${JSON.stringify({ timestamp: `2026-10-11T10:${String(minute).padStart(2, '0')}:00.000Z`, level: 'info', message })}\n`

describe('help, version and usage errors', () => {
  it('prints the help and the version without a screen', async () => {
    const help = await run(['--help', 'characterization.log'], { preload: pretendedTerminal })
    assert.equal(help.code, 0)
    assert.match(help.output, /^usage: jv \[options\] \[file \| 'glob' \| -\]\.\.\.\n/u)
    assert.match(help.output, /--output <mode> {8}auto, tui, plain or jsonl/u)
    assert.equal(help.output, stripVTControlCharacters(help.output))
    const version = await run(['--version'], { preload: pretendedTerminal })
    assert.equal(version.code, 0)
    assert.equal(version.output, '0.1.2\n')
  })

  it('reports usage errors with 2 on standard error and opens no screen', async () => {
    const cases: readonly [readonly string[], RegExp][] = [
      [['--transformer', 'jlv-pino'], /^jv: --transformer is gone in jlv 2: transformers are gone: pino is built in \(--format pino\), and other formats come from plugins \(--plugin <file>\)\n/u],
      [['-tjs', 'transform.js'], /^jv: -tjs is gone in jlv 2: transformers are gone: /u],
      [['--transformer-js=transform.js'], /^jv: --transformer-js is gone in jlv 2: /u],
      [['--param', '--sort=level'], /^jv: --param is gone in jlv 2: jlv 2 is the viewer itself and takes its options directly; see --help\n/u],
      [['-o'], /^jv: -o is gone in jlv 2: jlv 2 runs in the current terminal and opens no other shell\n/u],
      [['--reset'], /^jv: --reset is gone in jlv 2: jlv 2 never writes configuration into the home directory, so there is nothing to reset\n/u],
      [['-b', 'backup.ini'], /^jv: -b is gone in jlv 2: jlv 2 never writes configuration into the home directory, so there is nothing to back up\n/u],
      [['--unknown'], /^jv: Unknown option '--unknown'\./u],
      [['--timestamp-unit', 'hours'], /^jv: --timestamp-unit takes seconds, milliseconds, microseconds, nanoseconds, not 'hours'\n/u],
      [['--sort=user.name'], /^jv: --sort takes timestamp, level, message or arrival, with a leading - to sort descending, not 'user\.name'\n/u],
      [['-l', 'notice'], /^jv: --level takes trace, debug, info, warn, error, fatal, unknown, not 'notice'\n/u],
      [['--__proto__.polluted=yes'], /^jv: Unknown option '--__proto__\.polluted'\./u],
      [['--sort'], /^jv: Option '--sort <value>' argument missing/u],
      [['--sort', '-timestamp', 'a.log'], /^jv: Option '--sort' argument is ambiguous\./u],
      [['--output', 'html'], /^jv: --output takes auto, tui, plain or jsonl, not 'html'\n/u],
      [['--output=plain', '--sort=level'], /^jv: --output plain writes the records in arrival order; --sort level needs the viewer\n/u],
      [['--max-records', '0'], /^jv: --max-records needs a whole number from 1 to 4294967295, not '0'\n/u],
      [['--max-bytes=1e3'], /^jv: --max-bytes needs a whole number from 1 to 4294967295, not '1e3'\n/u],
      [['--overwrite', 'a.log'], /^jv: --overwrite needs --save\n/u]
    ]
    for (const [parameters, message] of cases) {
      const result = await run(parameters, { preload: pretendedTerminal })
      assert.equal(result.code, 2, parameters.join(' '))
      assert.match(result.errors, message)
      assert.match(result.errors, /\nusage: jv \[options\] \[file \| 'glob' \| -\]\.\.\.\nRun jv --help for the options\.\n$/u)
      assert.equal(result.output, '')
    }
  })

  it('reports a configuration file that is missing or excluded with 2', async () => {
    const missing = await run(['--config', 'missing.json', 'characterization.log'], { preload: pretendedTerminal })
    assert.equal(missing.code, 2)
    assert.equal(missing.errors, 'jv: the configuration file missing.json does not exist\n')
    assert.equal(missing.output, '')
    const both = await run(['-c', 'characterization.log', '--no-config', 'characterization.log'])
    assert.equal(both.code, 2)
    assert.equal(both.errors, 'jv: --config and --no-config exclude each other\n')
  })

  // Upstream printed "error: missing log file" to standard output and ended with 1.
  it('reports a missing input on a terminal with 2 and a missing file with 1', async () => {
    const none = await run([], { preload: pretendedTerminal })
    assert.equal(none.code, 2)
    assert.equal(none.errors, 'jv: no input: name a log file or pipe records into jv\n')
    assert.equal(none.output, '')
    const missing = await run(['missing.log'])
    assert.equal(missing.code, 1)
    assert.equal(missing.errors, 'jv: cannot read \'missing.log\': no such file\n')
  })
})

describe('output without a terminal', () => {
  it('writes plain text when standard output is a pipe', async () => {
    const result = await run(['--files', 'numeric-levels.log'])
    assert.equal(result.code, 0)
    assert.equal(result.errors, '')
    assert.equal(result.output.split('\n', 1)[0], '2026-10-11T10:00:00.000Z 30 numeric info')
  })

  it('writes the records of the level as JSON lines and reports skipped lines on standard error', async () => {
    const result = await run(['--output=jsonl', '-l', 'error', 'characterization.log'])
    assert.equal(result.code, 0)
    assert.equal(result.output.trimEnd().split('\n').length, 7)
    assert.match(result.output, /^\{"identifier":"1:2","source":\{"identifier":"1","label":"characterization\.log","order":0\},/u)
    assert.match(result.output, /^[^\n]*"position":\{"recordNumber":2,"firstLine":2,"lastLine":2\},"timestamp":1791713220000,"level":"error","message":"bravo 07"/u)
    assert.match(result.errors, /^jv: characterization\.log:5: skipped a line that is no JSON\n/u)
  })

  // minimist turned -l 30 into a number that matched pino's raw level 30. Levels are normalized now: -l takes a level
  // name in any case, which matches pino's numbers through pino's profile.
  it('filters normalized levels given in any case and refuses other levels', async () => {
    const pino = await run(['-l', 'INFO', fixturePath(pinoFixtures.levels)])
    assert.equal(pino.code, 0)
    assert.match(pino.output, /^2026-10-11T10:00:02\.000Z info info message \{"pid":4242,"hostname":"example-host"\}\n$/u)
    const unknown = await run(['--level=Unknown', 'numeric-levels.log'])
    assert.equal(unknown.output.trimEnd().split('\n').length, 3)
    const numeric = await run(['-l', '30', 'numeric-levels.log'])
    assert.equal(numeric.code, 2)
    assert.match(numeric.errors, /^jv: --level takes trace, debug, info, warn, error, fatal, unknown, not '30'\n/u)
  })

  // minimist turned numeric arguments into numbers: jv 5 read file descriptor 5, and jv 0 reported a missing file.
  it('reads a numeric argument as a file name', async () => {
    for (const name of ['5', '0']) {
      copyFileSync(characterization, path.join(directory, name))
      const result = await run([name], { directory })
      assert.equal(result.code, 0)
      assert.match(result.output, /^2026-10-11T10:00:00\.000Z debug alpha 00\n/u)
    }
  })

  it('shows records of standard input before it ends', async () => {
    let hasWrittenSecond = false
    const result = await run([], {
      drive: child => {
        child.stdin?.write(record(1, 'first'))
        child.stdout?.on('data', () => {
          if (hasWrittenSecond) {
            return
          }
          hasWrittenSecond = true
          child.stdin?.end(record(2, 'second'))
        })
      }
    })
    assert.equal(result.code, 0)
    assert.equal(result.output, '2026-10-11T10:01:00.000Z info first\n2026-10-11T10:02:00.000Z info second\n')
  })

  it('ends normally when the reader of its output goes away', async () => {
    const big = path.join(directory, 'big.log')
    writeFileSync(big, Array.from({ length: 50_000 }, (_, index) => record(index % 60, `record ${String(index)}`)).join(''))
    const result = await run([big], {
      drive: child => {
        child.stdout?.once('data', () => { child.stdout?.destroy() })
      }
    })
    assert.equal(result.code, 0)
    assert.equal(result.errors, '')
    assert.ok(result.milliseconds < 10_000)
  })

  it('ends with 130 on SIGINT while it reads a live input', { skip: process.platform === 'win32' }, async () => {
    const result = await run([], {
      drive: child => {
        child.stdin?.write(record(1, 'before the signal'))
        child.stdout?.once('data', () => { child.kill('SIGINT') })
      }
    })
    assert.equal(result.code, 130)
    assert.equal(result.output, '2026-10-11T10:01:00.000Z info before the signal\n')
  })
})

describe('viewer on a pretended terminal', () => {
  it('renders the file and exits with 0 on q', async () => {
    const result = await run(['characterization.log'], { keys: 'q', preload: pretendedTerminal })
    assert.equal(result.code, 0)
    // The screen first shows the empty store and then redraws only the cells that change, so the position arrives in
    // pieces; the rows arrive whole. The border label shows the file name (plan section 0.10).
    assert.match(compact(result.output), /\[characterization\.log\]\[1\/0\]/u)
    assert.match(compact(result.output), /foxtrot29/u)
    assert.match(stripVTControlCharacters(result.output), /NORMAL {2}1\/0 \| 20 \| sort: -timestamp \| loading/u)
  })

  // Upstream ended with 0 on Ctrl-C.
  it('exits with 130 on Ctrl-C', async () => {
    const result = await run(['characterization.log'], { keys: '\u{3}', preload: pretendedTerminal })
    assert.equal(result.code, 130)
  })

  it('applies -l and --sort from the command line', async () => {
    const level = await run(['-l', 'error', 'characterization.log'], { keys: 'q', preload: pretendedTerminal })
    assert.match(stripVTControlCharacters(level.output), /NORMAL {2}1\/0 \| 20 \| sort: -timestamp \| filters: level:error/u)
    assert.match(compact(level.output), /delta27/u)
    assert.doesNotMatch(compact(level.output), /foxtrot29/u)
    const sort = await run(['--sort=-level', 'characterization.log'], { keys: 'q', preload: pretendedTerminal })
    assert.match(stripVTControlCharacters(sort.output), /sort: -level/u)
    assert.match(compact(sort.output), /2026-10-11T10:14:00\.000Zwarn\*charlie14/u)
  })

  it('renders into a single cell when standard output pretends to be a terminal without a size', async () => {
    const result = await run(['characterization.log'], {
      keys: 'q',
      preload: 'data:text/javascript,process.stdout.isTTY=true;process.stdin.isTTY=true'
    })
    assert.equal(result.code, 0)
    assert.doesNotMatch(result.output, /characterization\.log/u)
  })
})

describe('saving records', () => {
  // -s meant sort in upstream's command line; plan section 6.1 gives it to --save.
  it('saves the records of the level with -s into a new file and refuses to replace it', async () => {
    const saved = path.join(directory, 'errors.jsonl')
    const result = await run(['-l', 'error', '-s', saved, '--output=plain', 'characterization.log'])
    assert.equal(result.code, 0)
    const lines = readFileSync(saved, 'utf8').trimEnd().split('\n')
    assert.equal(lines.length, 7)
    assert.equal(lines[0], '{"identifier":"1:2","source":{"identifier":"1","label":"characterization.log","order":0},' +
      '"position":{"recordNumber":2,"firstLine":2,"lastLine":2},"timestamp":1791713220000,"level":"error",' +
      '"message":"bravo 07","correlationIdentifier":"req-07","fields":{"timestamp":"2026-10-11T10:07:00.000Z",' +
      '"level":"error","message":"bravo 07","requestId":"req-07","user":{"id":7,"name":"user 07"}}}')
    const again = await run(['-s', saved, 'characterization.log'])
    assert.equal(again.code, 2)
    assert.equal(again.errors, `jv: cannot save to '${saved}': the file exists; --overwrite replaces it\n`)
    assert.equal(again.output, '')
    const replaced = await run(['--save', saved, '--overwrite', 'numeric-levels.log'])
    assert.equal(replaced.code, 0)
    assert.equal(readFileSync(saved, 'utf8').trimEnd().split('\n').length, 3)
  })

  it('refuses to save into an input', async () => {
    const result = await run(['--save=characterization.log', '--overwrite', 'characterization.log'])
    assert.equal(result.code, 2)
    assert.equal(result.errors, 'jv: cannot save to \'characterization.log\': it is one of the inputs\n')
  })
})

describe('following files', () => {
  // The follower polls every 500 ms; q must end the process at once, without waiting for the next poll.
  it('ends a followed viewer at once with q', async () => {
    const followed = path.join(directory, 'followed.log')
    writeFileSync(followed, record(1, 'followed record'))
    const result = await run(['--follow', followed], { keys: 'q', preload: pretendedTerminal })
    assert.equal(result.code, 0)
    assert.match(compact(result.output), /followedrecord/u)
    assert.match(stripVTControlCharacters(result.output), /sort: arrival \| live/u)
    assert.ok(result.milliseconds < 5000)
  })

  // Like tail -f, the process notices a reader that went away when it writes the next record.
  it('ends a followed plain output with 0 when the reader goes away and a record arrives', async () => {
    const followed = path.join(directory, 'piped.log')
    writeFileSync(followed, record(1, 'first'))
    const result = await run(['--follow', followed], {
      drive: child => {
        child.stdout?.once('data', () => {
          child.stdout?.destroy()
          appendFileSync(followed, record(2, 'second'))
        })
      }
    })
    assert.equal(result.code, 0)
    assert.equal(result.errors, '')
  })
})

describe('a process without a terminal', () => {
  // Detached, the child has no console on Windows and no controlling terminal on POSIX systems, so no keyboard can be
  // found for piped records even though standard output pretends to be a terminal.
  it('falls back to plain output for piped records instead of waiting for keys', async () => {
    const result = await run([], { input: record(1, 'piped'), preload: pretendedOutput, isDetached: true })
    assert.equal(result.code, 0)
    assert.equal(result.output, '2026-10-11T10:01:00.000Z info piped\n')
  })

  it('fails at once with 1 for --output tui', async () => {
    const result = await run(['--output', 'tui'], { input: record(1, 'piped'), preload: pretendedOutput, isDetached: true })
    assert.equal(result.code, 1)
    assert.match(result.errors, /^jv: the viewer needs a terminal: no terminal to read keys from: /u)
    assert.equal(result.output, '')
  })
})
