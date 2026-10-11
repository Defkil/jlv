// The application of src/application.ts with streams of the test instead of the process: live standard input in the
// viewer, keys from a separate keyboard, signals, the automatic plain fallback, machine output with backpressure,
// and errors that are reported before a screen opens (plan sections 6.1 and 8, phase 5).
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import {
  appendFileSync, chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { after, describe, it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'
import { fixturePath, legacyViewerFixtures } from '../../format-fixtures/src/catalog.js'
import { merge, runApplication, type ApplicationEnvironment, type ApplicationOptions } from '../src/application.js'
import { loadConfiguration } from '../src/configuration.js'
import { hasControls } from '../src/terminal-text.js'
import { TerminalOutput } from './support/terminal.js'

const characterization = fixturePath(legacyViewerFixtures.characterization)
const directory = mkdtempSync(path.join(tmpdir(), 'jlv-application-'))
const home = path.join(directory, 'home')
mkdirSync(home)
after(() => {
  rmSync(directory, { recursive: true, force: true })
})

const record = (minute: number, message: string, level = 'info'): string =>
  `${JSON.stringify({ timestamp: `2026-10-11T10:${String(minute).padStart(2, '0')}:00.000Z`, level, message })}\n`

class TextOutput extends Writable {
  text = ''

  override _write (chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString('utf8')
    callback()
  }
}

interface Harness {
  readonly stdin: PassThrough & { isTTY?: boolean }
  readonly stdout: Writable & { readonly isTTY?: boolean }
  readonly stderr: TextOutput
  readonly signals: EventEmitter
  readonly keyboard: PassThrough
  readonly state: { isKeyboardClosed: boolean }
  readonly environment: ApplicationEnvironment
}

interface HarnessOptions {
  readonly hasKeyboard?: boolean
  readonly stdout?: Writable & { readonly isTTY?: boolean }
  readonly home?: string
}

const harness = (options: HarnessOptions = {}): Harness => {
  const stdin = new PassThrough()
  const stdout = options.stdout ?? new TerminalOutput(80, 24, true)
  const stderr = new TextOutput()
  // eslint-disable-next-line unicorn/prefer-event-target -- the application listens to process, which is an EventEmitter
  const signals = new EventEmitter()
  const keyboard = new PassThrough()
  const state = { isKeyboardClosed: false }
  const environment: ApplicationEnvironment = {
    stdin,
    stdout,
    stderr,
    workingDirectory: path.dirname(characterization),
    home: options.home ?? home,
    platform: process.platform,
    signals,
    openKeyboard: () => options.hasKeyboard === false
      ? undefined
      : { stream: keyboard, path: 'test keyboard', close: () => { state.isKeyboardClosed = true } },
    screenOptions: { terminal: 'xterm-256color', forceUnicode: true, warnings: false }
  }
  return { stdin, stdout, stderr, signals, keyboard, state, environment }
}

const applicationOptions = (overrides: Partial<ApplicationOptions> = {}): ApplicationOptions => ({
  inputs: [],
  isFollowing: false,
  sort: undefined,
  level: undefined,
  where: [],
  profile: undefined,
  predicates: [],
  output: 'auto',
  format: undefined,
  timestampUnit: undefined,
  isStrict: false,
  configuration: undefined,
  isConfigurationDisabled: false,
  plugins: [],
  maximumRecords: undefined,
  maximumBytes: undefined,
  save: undefined,
  isOverwriting: false,
  debugLog: undefined,
  ...overrides
})

// What the terminal shows so far, without escape sequences.
const shown = (output: Writable): string => output instanceof TerminalOutput ? stripVTControlCharacters(output.written) : ''

// Whether the terminal has shown the text. blessed moves the cursor over blank cells instead of writing spaces, so
// the comparison leaves spaces out.
const hasShown = (output: Writable, text: string): boolean => shown(output).replaceAll(' ', '').includes(text.replaceAll(' ', ''))

const waitFor = async (isReady: () => boolean, what: string): Promise<void> => {
  const deadline = performance.now() + 5000
  while (!isReady()) {
    if (performance.now() > deadline) {
      assert.fail(`timed out waiting for ${what}`)
    }
    await delay(5)
  }
}

const signalListeners = (signals: EventEmitter): number =>
  ['SIGINT', 'SIGTERM', 'SIGHUP'].reduce((sum, signal) => sum + signals.listenerCount(signal), 0)

describe('merging sources', () => {
  it('cancels pending reads and returns every unfinished source when the consumer stops early', async () => {
    const closed: string[] = []
    const waiting = Promise.withResolvers<undefined>()
    async function * first (): AsyncGenerator<number> {
      try {
        await Promise.resolve()
        yield 1
        yield 2
      } finally {
        closed.push('first')
      }
    }
    async function * second (): AsyncGenerator<number> {
      try {
        await waiting.promise
        yield 3
      } finally {
        closed.push('second')
      }
    }
    const merged = merge([first(), second()], () => { waiting.resolve(undefined) })
    assert.deepEqual(await merged.next(), { value: 1, done: false })
    await merged.return(undefined)
    assert.equal(closed.includes('first'), true)
    assert.equal(closed.includes('second'), true)
    assert.equal(closed.length, 2)
  })
})

describe('viewer with live standard input', () => {
  it('shows records before standard input ends, reads keys from the keyboard and quits with q', async () => {
    const { stdin, stdout, keyboard, signals, state, environment } = harness()
    const running = runApplication(applicationOptions(), environment)
    stdin.write(record(1, 'first arrival'))
    await waitFor(() => hasShown(stdout, 'first arrival'), 'the first record')
    assert.ok(hasShown(stdout, '[ stdin ]'))
    assert.equal(signalListeners(signals), 3)
    stdin.write(record(2, 'second arrival'))
    await waitFor(() => hasShown(stdout, 'second arrival'), 'the second record')
    keyboard.write('q')
    assert.equal(await running, 0)
    // The pipe never ended; quitting stops reading it, closes the keyboard and stops listening for signals.
    assert.equal(stdin.destroyed, true)
    assert.equal(state.isKeyboardClosed, true)
    assert.equal(signalListeners(signals), 0)
  })

  it('stays open when standard input ends', async () => {
    const { stdin, stdout, keyboard, environment } = harness()
    let isDone = false
    const running = (async () => {
      try {
        return await runApplication(applicationOptions(), environment)
      } finally {
        isDone = true
      }
    })()
    stdin.end(record(1, 'only record'))
    await waitFor(() => hasShown(stdout, 'only record'), 'the record')
    await delay(150)
    assert.equal(isDone, false)
    keyboard.write('q')
    assert.equal(await running, 0)
  })
})

describe('several files', () => {
  // The record view's tests show the order by time across sources; the screen output holds only changed cells.
  it('names the first input and how many more and shows the records of both files', async () => {
    const first = path.join(directory, 'first.log')
    const second = path.join(directory, 'second.log')
    writeFileSync(first, record(1, 'first file at 1') + record(3, 'first file at 3'))
    writeFileSync(second, record(2, 'second file at 2') + record(4, 'second file at 4'))
    const { stdout, keyboard, environment } = harness()
    const running = runApplication(applicationOptions({ inputs: [first, second] }), environment)
    await waitFor(() => hasShown(stdout, 'second file at 4'), 'the records of the second file')
    keyboard.write('q')
    assert.equal(await running, 0)
    assert.match(shown(stdout).replaceAll(' ', ''), /\[\S*first\.logand1more\]/u)
    assert.ok(hasShown(stdout, 'first file at 1') && hasShown(stdout, 'second file at 2'))
  })
})

describe('ending the viewer', () => {
  const cases = [
    { name: 'Ctrl-C', exitCode: 130, stop: (subject: Harness) => { subject.keyboard.write('\u{3}') } },
    { name: 'SIGINT', exitCode: 130, stop: (subject: Harness) => { subject.signals.emit('SIGINT') } },
    { name: 'SIGTERM', exitCode: 143, stop: (subject: Harness) => { subject.signals.emit('SIGTERM') } },
    { name: 'SIGHUP', exitCode: 129, stop: (subject: Harness) => { subject.signals.emit('SIGHUP') } }
  ]
  for (const { name, exitCode, stop } of cases) {
    it(`ends with ${String(exitCode)} on ${name} and closes the keyboard`, async () => {
      const subject = harness()
      const running = runApplication(applicationOptions({ inputs: ['characterization.log'] }), subject.environment)
      await waitFor(() => hasShown(subject.stdout, 'foxtrot 29'), 'the records')
      stop(subject)
      assert.equal(await running, exitCode)
      assert.equal(subject.state.isKeyboardClosed, true)
      assert.equal(signalListeners(subject.signals), 0)
    })
  }

  it('keeps the viewer open after a file was read', async () => {
    const { stdout, keyboard, environment } = harness()
    let isDone = false
    const running = (async () => {
      try {
        return await runApplication(applicationOptions({ inputs: ['characterization.log'] }), environment)
      } finally {
        isDone = true
      }
    })()
    // The screen redraws only the cells that change, so the status line arrives in pieces; the rows arrive whole.
    await waitFor(() => hasShown(stdout, 'foxtrot 29'), 'the records')
    await delay(150)
    assert.equal(isDone, false)
    keyboard.write('q')
    assert.equal(await running, 0)
  })
})

// The exit code of a run that should end now. A run that does not end within five seconds fails the test and is ended
// with SIGTERM, so that the test process does not wait for it forever.
const timeoutAfter = async (milliseconds: number, signal: AbortSignal): Promise<'timeout' | 'cancelled'> => {
  try {
    await delay(milliseconds, undefined, { signal })
    return 'timeout'
  } catch {
    return 'cancelled'
  }
}

const ended = async (running: Promise<number>, subject: Harness): Promise<number> => {
  const controller = new AbortController()
  const result = await Promise.race([running, timeoutAfter(5000, controller.signal)])
  controller.abort()
  if (typeof result !== 'number') {
    subject.signals.emit('SIGTERM')
    await running
    return assert.fail('the viewer did not end')
  }
  return result
}

// Plan section 8, phase 7: a run ends cleanly while a prompt, a picker or the key help is open, whatever ends it.
describe('ending the viewer with a dialog open', () => {
  const dialogs = [
    { name: 'the search prompt', keys: ['/', 'char'], shows: 'Search:' },
    { name: 'the filter manager', keys: ['f'], shows: 'addafilter' },
    { name: 'a filter prompt', keys: ['f', 'a', 'm', 'al'], shows: 'Filtermessageby:' },
    { name: 'the key help', keys: ['?'], shows: 'Keys' }
  ]
  const endings = [
    { name: 'Ctrl-C', exitCode: 130, stop: (subject: Harness) => { subject.keyboard.write('\u{3}') } },
    { name: 'SIGTERM', exitCode: 143, stop: (subject: Harness) => { subject.signals.emit('SIGTERM') } }
  ]
  for (const dialog of dialogs) {
    for (const ending of endings) {
      it(`ends with ${String(ending.exitCode)} on ${ending.name} while ${dialog.name} is open`, async () => {
        const subject = harness()
        const running = runApplication(applicationOptions({ inputs: ['characterization.log'] }), subject.environment)
        await waitFor(() => hasShown(subject.stdout, 'foxtrot 29'), 'the records')
        for (const key of dialog.keys) {
          subject.keyboard.write(key)
          await delay(20)
        }
        await waitFor(() => hasShown(subject.stdout, dialog.shows), dialog.name)
        ending.stop(subject)
        assert.equal(await ended(running, subject), ending.exitCode)
        assert.equal(subject.state.isKeyboardClosed, true)
        assert.equal(signalListeners(subject.signals), 0)
      })
    }
  }

  it('takes q as text in a prompt and quits with q once the prompt is closed', async () => {
    const subject = harness()
    let isDone = false
    const running = (async () => {
      try {
        return await runApplication(applicationOptions({ inputs: ['characterization.log'] }), subject.environment)
      } finally {
        isDone = true
      }
    })()
    await waitFor(() => hasShown(subject.stdout, 'foxtrot 29'), 'the records')
    subject.keyboard.write('/')
    await waitFor(() => hasShown(subject.stdout, 'Search:'), 'the search prompt')
    subject.keyboard.write('q')
    await delay(150)
    assert.equal(isDone, false)
    subject.keyboard.write('\u{1B}')
    await delay(100)
    subject.keyboard.write('q')
    assert.equal(await ended(running, subject), 0)
  })

  it('ends with 1 when --strict stops the input while a prompt is open, and gives the keyboard back', async () => {
    const subject = harness()
    const running = runApplication(applicationOptions({ isStrict: true }), subject.environment)
    subject.stdin.write(record(1, 'kept'))
    await waitFor(() => hasShown(subject.stdout, 'kept'), 'the record')
    subject.keyboard.write('/')
    await waitFor(() => hasShown(subject.stdout, 'Search:'), 'the search prompt')
    subject.stdin.write('not json\n')
    assert.equal(await ended(running, subject), 1)
    assert.equal(subject.state.isKeyboardClosed, true)
    assert.equal(subject.stderr.text, 'jlv: stdin:2: skipped a line that is no JSON\njlv: --strict stops at the first record that cannot be read\n')
  })
})

describe('output without a viewer', () => {
  it('releases output listeners after completed runs that borrow the same stream', async () => {
    const stdout = new TextOutput()
    for (let index = 0; index < 3; index += 1) {
      const { environment } = harness({ stdout })
      assert.equal(await runApplication(applicationOptions({ inputs: ['characterization.log'], output: 'jsonl' }), environment), 0)
      assert.equal(stdout.listenerCount('error'), 0)
      assert.equal(stdout.listenerCount('close'), 0)
    }
  })

  it('writes plain text when no keyboard can be found and says that --sort applies to the viewer only', async () => {
    const stdout = new TextOutput()
    const { stdin, stderr, environment } = harness({ hasKeyboard: false, stdout: Object.assign(stdout, { isTTY: true }) })
    const running = runApplication(applicationOptions({ sort: 'level' }), environment)
    stdin.end(record(2, 'second', 'warn') + record(1, 'first'))
    assert.equal(await running, 0)
    assert.equal(stdout.text, '2026-10-11T10:02:00.000Z warn second\n2026-10-11T10:01:00.000Z info first\n')
    assert.equal(stderr.text, 'jlv: plain output keeps the arrival order; --sort level applies to the viewer only\n')
  })

  it('fails with 1 for --output tui without a keyboard or without a terminal and opens no screen', async () => {
    const withoutKeyboard = harness({ hasKeyboard: false })
    assert.equal(await runApplication(applicationOptions({ output: 'tui' }), withoutKeyboard.environment), 1)
    assert.match(withoutKeyboard.stderr.text, /^jlv: the viewer needs a terminal: no terminal to read keys from: /u)
    assert.equal(shown(withoutKeyboard.stdout), '')
    const withoutTerminal = harness({ stdout: new TextOutput() })
    assert.equal(await runApplication(applicationOptions({ output: 'tui', inputs: ['characterization.log'] }), withoutTerminal.environment), 1)
    assert.equal(withoutTerminal.stderr.text, 'jlv: the viewer needs a terminal: standard output is no terminal\n')
  })

  it('writes plain text when the records come from the terminal itself through -', async () => {
    const stdout = new TextOutput()
    const subject = harness({ stdout: Object.assign(stdout, { isTTY: true }) })
    subject.stdin.isTTY = true
    const running = runApplication(applicationOptions({ inputs: ['-'] }), subject.environment)
    subject.stdin.end(record(1, 'typed'))
    assert.equal(await running, 0)
    assert.equal(stdout.text, '2026-10-11T10:01:00.000Z info typed\n')
    const viewer = harness()
    viewer.stdin.isTTY = true
    assert.equal(await runApplication(applicationOptions({ inputs: ['-'], output: 'tui' }), viewer.environment), 1)
    assert.equal(viewer.stderr.text, 'jlv: the viewer needs a terminal: standard input is the terminal and carries the records\n')
  })

  it('writes the records that match the level as JSON lines in arrival order and reports skipped lines', async () => {
    const stdout = new TextOutput()
    const { stderr, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ inputs: ['characterization.log'], output: 'jsonl', level: 'error' }), environment)
    assert.equal(await running, 0)
    const messages = stdout.text.trimEnd().split('\n').map(line => Reflect.get(JSON.parse(line) as object, 'message') as unknown)
    assert.deepEqual(messages, ['bravo 07', 'bravo 19', 'delta 03', 'delta 15', 'delta 27', 'foxtrot 11', 'foxtrot 23'])
    assert.equal(stderr.text, [
      'jlv: characterization.log:5: skipped a line that is no JSON',
      'jlv: characterization.log:11: skipped a line that is no JSON',
      'jlv: characterization.log:20: skipped a JSON value that is no object',
      'jlv: characterization.log:26: skipped a JSON value that is no object',
      ''
    ].join('\n'))
  })

  it('reports the first ten skipped lines and counts the others', async () => {
    const stdout = new TextOutput()
    const { stdin, stderr, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ output: 'plain' }), environment)
    stdin.end(`${'not json\n'.repeat(12)}${record(1, 'one')}`)
    assert.equal(await running, 0)
    const lines = stderr.text.trimEnd().split('\n')
    assert.equal(lines.length, 11)
    assert.equal(lines[9], 'jlv: stdin:10: skipped a line that is no JSON')
    assert.equal(lines[10], 'jlv: skipped 12 lines in total, the first 10 of them shown above')
  })

  it('fails with 1 when nonempty input holds no records', async () => {
    const { stdin, stderr, environment } = harness({ stdout: new TextOutput() })
    const running = runApplication(applicationOptions({ output: 'plain' }), environment)
    stdin.end('garbage\n{"truncated":\n')
    assert.equal(await running, 1)
    assert.match(stderr.text, /jlv: the input holds no records, only 2 skipped lines\n$/u)
  })

  it('reads from a live input only as fast as a slow output takes the records, and stops on SIGINT', async () => {
    // One chunk per 20 ms with a 16-byte buffer.
    const sink = new Writable({
      highWaterMark: 16,
      write: (_chunk, _encoding, callback) => { setTimeout(callback, 20) }
    })
    const { stdin, signals, environment } = harness({ stdout: sink })
    const running = runApplication(applicationOptions({ output: 'jsonl' }), environment)
    const line = record(1, 'x'.repeat(40))
    const total = 64 * 1024 * 1024
    let pushed = 0
    const producing = (async () => {
      while (pushed < total && !stdin.destroyed) {
        pushed += line.length
        if (stdin.write(line)) {
          continue
        }
        try {
          await Promise.race([once(stdin, 'drain'), once(stdin, 'close')])
        } catch {
          // The application stopped reading and destroyed the input.
          return
        }
      }
    })()
    await delay(500)
    const pushedBeforeStop = pushed
    signals.emit('SIGINT')
    assert.equal(await running, 130)
    await producing
    assert.ok(pushedBeforeStop < 2 * 1024 * 1024, `the input took ${String(pushedBeforeStop)} bytes`)
    assert.equal(stdin.destroyed, true)
  })

  for (const highWaterMark of [1, 1024 * 1024]) {
    it(`stops on SIGINT even when the output never completes, with a ${String(highWaterMark)}-byte buffer`, { timeout: 2000 }, async () => {
      const sink = new Writable({ highWaterMark, write: () => { /* never done */ } })
      const { stdin, signals, environment } = harness({ stdout: sink })
      const running = runApplication(applicationOptions({ output: 'jsonl' }), environment)
      try {
        stdin.end(record(1, 'stalled output'))
        await waitFor(() => sink.writableLength > 0, 'the queued output')
        // The larger buffer accepts the write immediately, so the finite input ends and the final flush waits.
        await delay(10)
        signals.emit('SIGINT')
        assert.equal(await running, 130)
        assert.equal(signalListeners(signals), 0)
      } finally {
        sink.destroy()
      }
    })
  }

  it('stops normally when the output closes without EPIPE while the input is still live', { timeout: 2000 }, async () => {
    const sink = new TextOutput()
    const { stdin, environment } = harness({ stdout: sink })
    const running = runApplication(applicationOptions({ output: 'jsonl' }), environment)
    stdin.write(record(1, 'before close'))
    await waitFor(() => sink.text.includes('before close'), 'the first record')
    sink.destroy()
    assert.equal(await running, 0)
    assert.equal(stdin.destroyed, true)
  })
})

describe('following files', () => {
  it('writes what a followed file holds and what is appended, also after a rotation, until SIGINT', async () => {
    const followed = path.join(directory, 'followed.log')
    writeFileSync(followed, record(1, 'before'))
    const stdout = new TextOutput()
    const { signals, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ inputs: [followed], isFollowing: true, output: 'plain' }), environment)
    await waitFor(() => stdout.text.includes('before'), 'the existing record')
    appendFileSync(followed, record(2, 'appended'))
    await waitFor(() => stdout.text.includes('appended'), 'the appended record')
    renameSync(followed, `${followed}.1`)
    appendFileSync(`${followed}.1`, record(3, 'late in the old file'))
    writeFileSync(followed, record(4, 'in the new file'))
    await waitFor(() => stdout.text.includes('in the new file'), 'the record of the new file')
    signals.emit('SIGINT')
    assert.equal(await running, 130)
    assert.deepEqual(stdout.text.trimEnd().split('\n').map(line => line.split(' ').slice(2).join(' ')), [
      'before', 'appended', 'late in the old file', 'in the new file'
    ])
  })

  it('shows followed records in arrival order in the viewer and quits with q', async () => {
    const followed = path.join(directory, 'viewed.log')
    writeFileSync(followed, record(5, 'newer by time') + record(1, 'older by time'))
    const { stdout, keyboard, signals, state, environment } = harness()
    const running = runApplication(applicationOptions({ inputs: [followed], isFollowing: true }), environment)
    await waitFor(() => hasShown(stdout, 'older by time'), 'the records')
    assert.ok(hasShown(stdout, 'sort: arrival | live'))
    keyboard.write('q')
    assert.equal(await running, 0)
    assert.equal(state.isKeyboardClosed, true)
    assert.equal(signalListeners(signals), 0)
  })
})

// The messages of the JSON lines in a saved file.
const savedMessages = (file: string): unknown[] => readFileSync(file, 'utf8').trimEnd().split('\n')
  .map(line => Reflect.get(JSON.parse(line) as object, 'message') as unknown)

describe('saving records', () => {
  it('refuses a directory as a save destination even with --overwrite', async () => {
    const { stderr, environment } = harness({ stdout: new TextOutput() })
    assert.equal(await runApplication(applicationOptions({ inputs: ['characterization.log'], save: directory, isOverwriting: true }), environment), 1)
    assert.equal(stderr.text, `jlv: cannot save to '${directory}': it is not a regular file\n`)
  })

  it('saves every matching record while the viewer keeps only the last ones', async () => {
    const saved = path.join(directory, 'viewer-save.jsonl')
    const { stdout, keyboard, environment } = harness()
    const running = runApplication(applicationOptions({
      inputs: ['characterization.log'], level: 'warn', maximumRecords: 3, save: saved
    }), environment)
    // None of the three records that the viewer keeps is a warning, so the screen shows no row to wait for.
    await waitFor(() => hasShown(stdout, 'level=warn'), 'the viewer')
    await delay(300)
    keyboard.write('q')
    assert.equal(await running, 0)
    // All seven warnings of the file, in the order of the file.
    assert.deepEqual(savedMessages(saved), ['charlie 14', 'charlie 26', 'kilo 10\nsecond line', 'alpha 06', 'alpha 18', 'no timestamp', 'charlie 02'])
  })

  it('saves what arrived before the viewer quit, also from a live input that never ended', async () => {
    const saved = path.join(directory, 'live-save.jsonl')
    const { stdin, stdout, keyboard, environment } = harness()
    const running = runApplication(applicationOptions({ save: saved }), environment)
    stdin.write(record(1, 'one') + record(2, 'two'))
    await waitFor(() => hasShown(stdout, 'two'), 'the records')
    keyboard.write('q')
    assert.equal(await running, 0)
    assert.deepEqual(savedMessages(saved), ['one', 'two'])
  })

  it('saves next to plain output and refuses an existing file without --overwrite', async () => {
    const saved = path.join(directory, 'plain-save.jsonl')
    const first = harness({ stdout: new TextOutput() })
    const firstRun = runApplication(applicationOptions({ output: 'plain', save: saved }), first.environment)
    first.stdin.end(record(1, 'first run'))
    assert.equal(await firstRun, 0)
    assert.deepEqual(savedMessages(saved), ['first run'])
    const refused = harness({ stdout: new TextOutput() })
    assert.equal(await runApplication(applicationOptions({ output: 'plain', save: saved }), refused.environment), 2)
    assert.equal(refused.stderr.text, `jlv: cannot save to '${saved}': the file exists; --overwrite replaces it\n`)
    const replaced = harness({ stdout: new TextOutput() })
    const replacing = runApplication(applicationOptions({ output: 'plain', save: saved, isOverwriting: true }), replaced.environment)
    replaced.stdin.end(record(2, 'second run'))
    assert.equal(await replacing, 0)
    assert.deepEqual(savedMessages(saved), ['second run'])
  })

  it('creates no save file when the viewer cannot start and gives the keyboard back when the save file fails', async () => {
    const saved = path.join(directory, 'never-created.jsonl')
    const withoutKeyboard = harness({ hasKeyboard: false })
    const options = applicationOptions({ inputs: ['characterization.log'], output: 'tui', save: saved })
    assert.equal(await runApplication(options, withoutKeyboard.environment), 1)
    assert.equal(existsSync(saved), false)
    const existing = path.join(directory, 'existing.jsonl')
    writeFileSync(existing, '')
    const subject = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: ['characterization.log'], save: existing }), subject.environment), 2)
    assert.equal(subject.state.isKeyboardClosed, true)
    assert.equal(shown(subject.stdout), '')
  })

  it('never saves into an input, also with --overwrite, another spelling of its name or a hard link', async () => {
    const input = path.join(directory, 'input.log')
    writeFileSync(input, record(1, 'kept'))
    const hardLink = path.join(directory, 'hard-link.log')
    linkSync(input, hardLink)
    for (const save of [input, `${directory}${path.sep}.${path.sep}input.log`, hardLink, path.join(directory, 'INPUT.LOG')]) {
      if (save.endsWith('INPUT.LOG') && process.platform !== 'win32') {
        continue
      }
      const { stdout, stderr, environment } = harness({ stdout: new TextOutput() })
      assert.equal(await runApplication(applicationOptions({ inputs: [input], save, isOverwriting: true }), environment), 2)
      assert.equal(stderr.text, `jlv: cannot save to '${save}': it is one of the inputs\n`)
      assert.equal(shown(stdout), '')
    }
    assert.equal(readFileSync(input, 'utf8'), record(1, 'kept'))
  })
})

describe('terminal debug logs', () => {
  it('refuses an input as the debug log before a viewer can truncate it', async () => {
    const file = path.join(directory, 'debug-input.log')
    const contents = record(1, 'must survive')
    writeFileSync(file, contents)
    const { state, stdout, stderr, environment } = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: [file], debugLog: file }), environment), 2)
    assert.equal(readFileSync(file, 'utf8'), contents)
    assert.equal(shown(stdout), '')
    assert.equal(state.isKeyboardClosed, true)
    assert.equal(stderr.text, `jlv: cannot write the debug log to '${file}': it is one of the inputs\n`)
  })

  it('writes a new debug file, closes it at quit and refuses to replace it', async () => {
    const file = path.join(directory, 'terminal-debug.log')
    const { state, stdout, keyboard, environment } = harness()
    const running = runApplication(applicationOptions({ inputs: ['characterization.log'], debugLog: file }), environment)
    await waitFor(() => hasShown(stdout, 'foxtrot 29'), 'the viewer with debug logging')
    keyboard.write('q')
    assert.equal(await running, 0)
    assert.equal(state.isKeyboardClosed, true)
    const contents = readFileSync(file, 'utf8')
    assert.match(contents, /key q/u)
    const refused = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: ['characterization.log'], debugLog: file, isOverwriting: true }), refused.environment), 2)
    assert.equal(refused.stderr.text, `jlv: cannot write the debug log to '${file}': the file exists; choose a new file\n`)
    assert.equal(readFileSync(file, 'utf8'), contents)
  })

  it('refuses a debug destination that cannot be created before opening the viewer', async () => {
    const file = path.join(directory, 'missing-debug-directory', 'terminal.log')
    const { state, stdout, stderr, environment } = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: ['characterization.log'], debugLog: file }), environment), 1)
    assert.match(stderr.text, /^jlv: cannot write the debug log to /u)
    assert.equal(shown(stdout), '')
    assert.equal(state.isKeyboardClosed, true)
  })

  it('refuses a save destination that names the debug file before --overwrite can truncate it', async () => {
    const file = path.join(directory, 'conflicting-debug.log')
    const { state, stdout, stderr, environment } = harness()
    assert.equal(await runApplication(applicationOptions({
      inputs: ['characterization.log'], debugLog: file, save: file, isOverwriting: true
    }), environment), 2)
    assert.equal(stderr.text, `jlv: cannot save to '${file}': it is one of the inputs\n`)
    assert.equal(shown(stdout), '')
    assert.equal(state.isKeyboardClosed, true)
  })

  it('creates no debug file for machine output or an empty --log value', async () => {
    const file = path.join(directory, 'unused-debug.log')
    const machine = harness({ stdout: new TextOutput() })
    assert.equal(await runApplication(applicationOptions({ inputs: ['characterization.log'], debugLog: file }), machine.environment), 0)
    assert.equal(existsSync(file), false)
    const empty = harness()
    const running = runApplication(applicationOptions({ inputs: ['characterization.log'], debugLog: '' }), empty.environment)
    await waitFor(() => hasShown(empty.stdout, 'foxtrot 29'), 'the viewer without debug logging')
    empty.keyboard.write('q')
    assert.equal(await running, 0)
  })
})

// A record with a timestamp without a zone, as Monolog writes it.
const naive = (minute: number): string => `${JSON.stringify({ timestamp: `2026-10-11 10:0${String(minute)}:00`, message: `naive ${String(minute)}` })}\n`

describe('diagnostics', () => {
  it('report each kind of warning once per source, then the totals', async () => {
    const stdout = new TextOutput()
    const { stdin, stderr, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ output: 'plain' }), environment)
    stdin.end(`${naive(1)}${naive(2)}not json\n${naive(3)}`)
    assert.equal(await running, 0)
    assert.equal(stdout.text, '2026-10-11 10:01:00 - naive 1\n2026-10-11 10:02:00 - naive 2\n2026-10-11 10:03:00 - naive 3\n')
    assert.equal(stderr.text, [
      'jlv: stdin:1: warning: the timestamp "2026-10-11 10:01:00" has no zone; it is shown as text and sorts last',
      'jlv: stdin:3: skipped a line that is no JSON',
      'jlv: 3 warnings in total, the first of each kind shown above',
      ''
    ].join('\n'))
  })

  // A logfmt key reaches the warning as it was written; a terminal must not act on it.
  it('show the keys and values of records on standard error as visible text', async () => {
    const stdout = new TextOutput()
    const { stdin, stderr, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ output: 'plain', format: 'logfmt' }), environment)
    const key = 'key\u{1B}]0;title\u{7}\u{7}'
    stdin.end(`msg=one ${key}=1 ${key}=2\n`)
    assert.equal(await running, 0)
    assert.equal(stderr.text, String.raw`jlv: stdin:1: warning: the key key\u0007 appears more than once; its last value counts` + '\n')
    assert.equal(hasControls(stdout.text.trimEnd()), false)
  })

  it('stop at the first error with --strict and end with 1', async () => {
    const stdout = new TextOutput()
    const { stdin, stderr, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ output: 'plain', isStrict: true }), environment)
    stdin.end(`${record(1, 'kept')}{"truncated":\n${record(2, 'never read')}`)
    assert.equal(await running, 1)
    assert.equal(stdout.text, '2026-10-11T10:01:00.000Z info kept\n')
    assert.equal(stderr.text, 'jlv: stdin:2: skipped a line that is no JSON\njlv: --strict stops at the first record that cannot be read\n')
  })

  it('close the viewer at the first error with --strict and report it afterwards', async () => {
    const { stdin, stderr, state, environment } = harness()
    const running = runApplication(applicationOptions({ isStrict: true }), environment)
    stdin.write(`${record(1, 'kept')}not json\n`)
    assert.equal(await running, 1)
    assert.equal(state.isKeyboardClosed, true)
    assert.equal(stderr.text, 'jlv: stdin:2: skipped a line that is no JSON\njlv: --strict stops at the first record that cannot be read\n')
  })

  it('read numeric timestamps in the unit of --timestamp-unit', async () => {
    const stdout = new TextOutput()
    const { stdin, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ output: 'plain', timestampUnit: 'seconds' }), environment)
    stdin.end('{"timestamp":1791712800,"message":"seconds"}\n{"timestamp":"1791712801.5","message":"numeric text"}\n')
    assert.equal(await running, 0)
    assert.equal(stdout.text, '2026-10-11T10:00:00.000Z - seconds\n2026-10-11T10:00:01.500Z - numeric text\n')
  })
})

// The names, sizes and modification times of the home directory's entries, to see that nothing wrote into it.
const homeSnapshot = (): string[] => readdirSync(home, { recursive: true }).map(name => {
  const status = statSync(path.join(home, String(name)))
  return `${String(name)} ${String(status.size)} ${String(status.mtimeMs)}`
}).toSorted((left, right) => left.localeCompare(right))

describe('configuration', () => {
  const project = path.join(directory, 'configured')
  mkdirSync(project)
  writeFileSync(path.join(project, 'jlv.config.json'), JSON.stringify({
    version: 1, format: 'logfmt', mapping: { message: ['text'] }, levels: { notice: 'warn' }
  }))
  writeFileSync(path.join(project, 'app.log'), 'level=notice text="from logfmt"\n')

  it('reads the project\'s file, lets the command line win, and leaves the home directory as it was', async () => {
    writeFileSync(path.join(home, '.json-log-viewer'), '[transform]\nmessage=home_message\n')
    const homeBefore = homeSnapshot()
    const configured = harness({ stdout: new TextOutput() })
    const environment = { ...configured.environment, workingDirectory: project }
    assert.equal(await runApplication(applicationOptions({ inputs: ['app.log'], output: 'plain' }), environment), 0)
    assert.equal(configured.stdout instanceof TextOutput ? configured.stdout.text : '', '- warn from logfmt\n')
    const overridden = harness({ stdout: new TextOutput() })
    const options = applicationOptions({ inputs: ['app.log'], output: 'plain', format: 'jsonl' })
    assert.equal(await runApplication(options, { ...overridden.environment, workingDirectory: project }), 1)
    assert.match(overridden.stderr.text, /^jlv: app\.log:1: skipped a line that is no JSON\n/u)
    const ignored = harness({ stdout: new TextOutput() })
    const withoutFile = applicationOptions({ inputs: ['app.log'], output: 'plain', format: 'logfmt', isConfigurationDisabled: true })
    assert.equal(await runApplication(withoutFile, { ...ignored.environment, workingDirectory: project }), 0)
    assert.equal(ignored.stdout instanceof TextOutput ? ignored.stdout.text : '', '- notice - {"text":"from logfmt"}\n')
    assert.deepEqual(homeSnapshot(), homeBefore)
    rmSync(path.join(home, '.json-log-viewer'))
  })

  // viewer-load.test.ts shows the whole status line; the screen here redraws only the cells that change.
  it('names the configuration file in the status line', async () => {
    const { stdout, keyboard, environment } = harness()
    const running = runApplication(applicationOptions({ inputs: ['app.log'] }), { ...environment, workingDirectory: project })
    await waitFor(() => hasShown(stdout, 'from logfmt'), 'the record')
    await waitFor(() => hasShown(stdout, 'loading | config: jlv.config.json'), 'the configuration file')
    keyboard.write('q')
    assert.equal(await running, 0)
  })

  it('reports a configuration that cannot be used with 2 before a screen opens', async () => {
    const missing = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: ['app.log'], configuration: 'missing.json' }), {
      ...missing.environment, workingDirectory: project
    }), 2)
    assert.equal(missing.stderr.text, 'jlv: the configuration file missing.json does not exist\n')
    assert.equal(shown(missing.stdout), '')
    const unknownFormat = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: ['app.log'], format: 'xml' }), {
      ...unknownFormat.environment, workingDirectory: project
    }), 2)
    assert.equal(unknownFormat.stderr.text, 'jlv: --format takes auto or one of docker, bunyan, pino, logfmt, csv, winston, jsonl, not \'xml\'\n')
  })
})

describe('errors before a screen opens', () => {
  it('reports a mapping file that cannot be read with 2', async () => {
    const unreadable = path.join(directory, 'unreadable-home')
    mkdirSync(path.join(unreadable, '.json-log-viewer'), { recursive: true })
    const { stdout, stderr, environment } = harness({ home: unreadable })
    assert.equal(await runApplication(applicationOptions({ inputs: ['characterization.log'] }), environment), 2)
    assert.match(stderr.text, /^jlv: cannot read the configuration file .*\.json-log-viewer: /u)
    assert.equal(shown(stdout), '')
  })

  it('reports a missing file with 1 and no input on a terminal with 2', async () => {
    const missing = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: ['missing.log'] }), missing.environment), 1)
    assert.equal(missing.stderr.text, 'jlv: cannot read \'missing.log\': no such file\n')
    const terminal = harness()
    terminal.stdin.isTTY = true
    assert.equal(await runApplication(applicationOptions(), terminal.environment), 2)
    assert.equal(terminal.stderr.text, 'jlv: no input: name a log file or pipe records into jlv\n')
    assert.equal(shown(terminal.stdout), '')
  })

  // A file that cannot be opened after it was found; Windows has no permission bits for this test.
  it('reports a file that cannot be read, reads the others and ends with 1', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
    const locked = path.join(directory, 'locked.log')
    writeFileSync(locked, record(1, 'hidden'))
    chmodSync(locked, 0)
    const stdout = new TextOutput()
    const { stderr, environment } = harness({ stdout })
    const running = runApplication(applicationOptions({ inputs: [locked, characterization], output: 'plain' }), environment)
    assert.equal(await running, 1)
    assert.match(stderr.text, /jlv: cannot read '.*locked\.log': .*EACCES/u)
    assert.match(stdout.text, /foxtrot 29/u)
  })
})

// The plain output of a harness, and the messages of its lines, which are two words in these tests.
const output = (subject: Harness): string => subject.stdout instanceof TextOutput ? subject.stdout.text : ''
const messagesOf = (text: string): string[] => text.trimEnd().split('\n').map(line => line.split(' ').slice(2, 4).join(' '))

describe('filters of the command line', () => {
  const project = path.join(directory, 'filtered')
  mkdirSync(project)
  const log = path.join(project, 'app.log')
  copyFileSync(characterization, log)
  const profiles = {
    requests: { mode: 'any', clauses: [{ field: ['message'], operator: 'contains', value: 'bravo' }, { field: ['message'], operator: 'contains', value: 'charlie' }] },
    roundTrip: { mode: 'all', clauses: [{ field: ['level'], operator: 'equals', value: 'error' }, { field: ['message'], operator: 'contains', value: 'DELTA' }] }
  } as const
  writeFileSync(path.join(project, 'jlv.config.json'), JSON.stringify({ version: 1, profiles }))
  writeFileSync(path.join(project, 'predicates.mjs'), [
    'export default {',
    '  apiVersion: 1,',
    '  formats: [],',
    '  predicates: {',
    '    hasUser: record => typeof record.fields.user === "object",',
    '    noA: record => { if (record.message.startsWith("a")) { throw new Error("cannot judge " + record.message) } return true }',
    '  }',
    '}',
    ''
  ].join('\n'))
  const inProject = (subject: Harness): ApplicationEnvironment => ({ ...subject.environment, workingDirectory: project })

  // Upstream issue #19: every part applies; the level, the clause, the profile and the predicate each leave out some
  // of the records.
  it('write and save only the records that the level, every clause, the profile and every predicate keep', async () => {
    const saved = path.join(project, 'filtered.jsonl')
    const subject = harness({ stdout: new TextOutput() })
    const options = applicationOptions({
      inputs: ['app.log'],
      output: 'plain',
      level: 'warn',
      where: [{ field: ['fields', 'requestId'], operator: 'contains', value: 'REQ' }],
      profile: 'requests',
      plugins: ['./predicates.mjs'],
      predicates: ['hasUser'],
      save: saved
    })
    assert.equal(await runApplication(options, inProject(subject)), 0)
    assert.deepEqual(messagesOf(output(subject)), ['charlie 14', 'charlie 26', 'charlie 02'])
    assert.deepEqual(savedMessages(saved), ['charlie 14', 'charlie 26', 'charlie 02'])
  })

  // The profile round trip: a filter written as a profile reads back and keeps what the same clauses of --where keep.
  it('keep with a profile what the same clauses of --where keep', async () => {
    assert.deepEqual(loadConfiguration({ workingDirectory: project, home }).profiles['roundTrip'], profiles.roundTrip)
    const fromProfile = harness({ stdout: new TextOutput() })
    assert.equal(await runApplication(applicationOptions({ inputs: ['app.log'], output: 'plain', profile: 'roundTrip' }), inProject(fromProfile)), 0)
    const fromClauses = harness({ stdout: new TextOutput() })
    const where = applicationOptions({ inputs: ['app.log'], output: 'plain', where: profiles.roundTrip.clauses })
    assert.equal(await runApplication(where, inProject(fromClauses)), 0)
    assert.deepEqual(messagesOf(output(fromProfile)), ['delta 03', 'delta 15', 'delta 27'])
    assert.equal(output(fromClauses), output(fromProfile))
  })

  it('refuse a profile or a predicate that does not exist with 2 before a screen opens', async () => {
    const profile = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: ['app.log'], profile: 'missing' }), inProject(profile)), 2)
    assert.equal(profile.stderr.text, 'jlv: --profile missing names no profile; the profiles of jlv.config.json are requests, roundTrip\n')
    assert.equal(shown(profile.stdout), '')
    const withoutFile = harness()
    assert.equal(await runApplication(applicationOptions({ inputs: [log], profile: 'requests', isConfigurationDisabled: true }), withoutFile.environment), 2)
    assert.equal(withoutFile.stderr.text, 'jlv: --profile requests names no profile; no configuration file was read\n')
    const predicate = harness()
    const options = applicationOptions({ inputs: ['app.log'], plugins: ['./predicates.mjs'], predicates: ['isLoud'] })
    assert.equal(await runApplication(options, inProject(predicate)), 2)
    assert.equal(predicate.stderr.text, 'jlv: --predicate isLoud names no predicate; the predicates of the plugins of --plugin are hasUser, noA\n')
  })

  it('report the first failure of a predicate, leave out the records that it failed on and end with 1', async () => {
    const subject = harness({ stdout: new TextOutput() })
    const options = applicationOptions({ inputs: ['app.log'], output: 'plain', plugins: ['./predicates.mjs'], predicates: ['noA'] })
    assert.equal(await runApplication(options, inProject(subject)), 1)
    const messages = messagesOf(output(subject))
    assert.equal(messages.length, 26)
    assert.ok(messages.every(message => !message.startsWith('a')))
    assert.equal(subject.stderr.text.split('\n').filter(line => line.includes('predicate')).join('\n'),
      'jlv: the predicate noA of the plugin ./predicates.mjs failed: cannot judge alpha 00; it left out the records it failed on')
  })

  it('start the viewer with the filter of the command line and save what it keeps, whatever the viewer changes', async () => {
    const saved = path.join(project, 'viewer.jsonl')
    const subject = harness()
    const options = applicationOptions({ inputs: ['app.log'], where: [{ field: ['message'], operator: 'contains', value: 'alpha' }], save: saved })
    const running = runApplication(options, inProject(subject))
    // Without the filter, foxtrot 29 would be the first record.
    await waitFor(() => hasShown(subject.stdout, 'alpha 24'), 'the records')
    assert.equal(hasShown(subject.stdout, 'foxtrot 29'), false)
    subject.keyboard.write('f')
    await delay(50)
    subject.keyboard.write('c')
    // The cursor stays on alpha 24, the newest of the alpha records, so the records after it show now.
    await waitFor(() => hasShown(subject.stdout, 'foxtrot 23'), 'all records')
    subject.keyboard.write('q')
    assert.equal(await running, 0)
    assert.deepEqual(savedMessages(saved), ['alpha 00', 'alpha 12', 'alpha 24', 'alpha 06', 'alpha 18'])
  })

  // A configuration is data: it cannot name a plugin, so no code runs because of it.
  it('run no code that a configuration file names', async () => {
    const elsewhere = path.join(directory, 'no-code')
    mkdirSync(elsewhere)
    const marker = path.join(elsewhere, 'imported.txt')
    writeFileSync(path.join(elsewhere, 'code.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'imported')\nexport default { apiVersion: 1, formats: [] }\n`)
    writeFileSync(path.join(elsewhere, 'jlv.config.json'), JSON.stringify({ version: 1, plugin: './code.mjs', predicates: { code: './code.mjs' } }))
    copyFileSync(characterization, path.join(elsewhere, 'app.log'))
    const subject = harness({ stdout: new TextOutput() })
    assert.equal(await runApplication(applicationOptions({ inputs: ['app.log'], output: 'plain' }), { ...subject.environment, workingDirectory: elsewhere }), 2)
    assert.match(subject.stderr.text, /^jlv: jlv\.config\.json: the configuration has the unknown key "plugin"/u)
    assert.equal(existsSync(marker), false)
  })
})
