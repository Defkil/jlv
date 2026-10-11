// Input resolution of src/input/files.ts: literal paths, quoted glob patterns, standard input, dash and spaced names,
// Windows separators, duplicates and the errors for inputs that cannot be read (plan section 6.1).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { InputError, readFileChunks, resolveInputs, type InputSource, type ResolveOptions } from '../src/input/files.js'

const directory = mkdtempSync(path.join(tmpdir(), 'jlv-inputs-'))
const options: ResolveOptions = { workingDirectory: directory, isStdinTerminal: true }

const files = ['a.log', 'b.log', 'x.log', '[x].log', '-dash.log', '-', 'notes.txt', 'my logs/space.log', 'my logs/other.log', 'sub/deep.log']

before(() => {
  for (const file of files) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    writeFileSync(path.join(directory, file), `{"file":"${file}"}\n`)
  }
})

after(() => {
  rmSync(directory, { recursive: true, force: true })
})

// The kind and label of each source, and its order and identifier as one check.
const summary = (sources: readonly InputSource[]): string[] => sources.map((source, index) => {
  assert.equal(source.information.order, index)
  assert.equal(source.information.identifier, String(index + 1))
  return `${source.kind}:${source.information.label}`
})

const rejection = (exitCode: 1 | 2, message: RegExp) => (error: unknown): boolean => {
  assert.ok(error instanceof InputError)
  assert.equal(error.exitCode, exitCode)
  assert.match(error.message, message)
  return true
}

describe('literal paths', () => {
  it('reads a named file with its argument as the label and its absolute path', async () => {
    const [source] = await resolveInputs(['a.log'], options)
    assert.deepEqual(source, { kind: 'file', path: path.join(directory, 'a.log'), information: { identifier: '1', label: 'a.log', order: 0 } })
  })

  it('keeps the order of the arguments', async () => {
    assert.deepEqual(summary(await resolveInputs(['x.log', 'a.log', 'notes.txt'], options)), ['file:x.log', 'file:a.log', 'file:notes.txt'])
  })

  it('reads an existing path literally even when it contains pattern characters', async () => {
    assert.deepEqual(summary(await resolveInputs(['[x].log'], options)), ['file:[x].log'])
  })

  it('reads names with spaces and names that start with a dash', async () => {
    assert.deepEqual(summary(await resolveInputs(['my logs/space.log', '-dash.log', `.${path.sep}-`], options)), [
      'file:my logs/space.log', 'file:-dash.log', `file:.${path.sep}-`
    ])
  })

  it('reads absolute paths', async () => {
    const absolute = path.join(directory, 'sub', 'deep.log')
    assert.deepEqual(summary(await resolveInputs([absolute], options)), [`file:${absolute}`])
  })

  it('reports a missing file with exit code 1', async () => {
    await assert.rejects(resolveInputs(['missing.log'], options), rejection(1, /^cannot read 'missing\.log': no such file$/u))
    await assert.rejects(resolveInputs([''], options), rejection(1, /^cannot read '': no such file$/u))
  })

  it('reports a directory with exit code 1', async () => {
    await assert.rejects(resolveInputs(['sub'], options), rejection(1, /^cannot read 'sub': it is a directory$/u))
  })
})

describe('glob patterns', () => {
  it('reads the matches of a pattern in sorted order with labels relative to the working directory', async () => {
    assert.deepEqual(summary(await resolveInputs(['*.log'], options)), [
      'file:-dash.log', 'file:[x].log', 'file:a.log', 'file:b.log', 'file:x.log'
    ])
    assert.deepEqual(summary(await resolveInputs(['**/deep.log', 'my logs/*.log'], options)), [
      `file:sub${path.sep}deep.log`, `file:my logs${path.sep}other.log`, `file:my logs${path.sep}space.log`
    ])
  })

  it('reads a file that two arguments reach only once, at its first position', async () => {
    assert.deepEqual(summary(await resolveInputs(['b.log', '*.log', `.${path.sep}a.log`, 'b.log'], options)), [
      'file:b.log', 'file:-dash.log', 'file:[x].log', 'file:a.log', 'file:x.log'
    ])
  })

  it('reports a pattern without matches with the pattern and exit code 1', async () => {
    await assert.rejects(resolveInputs(['a.log', '*.json'], options), rejection(1, /^no file matches the pattern '\*\.json'$/u))
  })

  it('treats backslashes as separators on Windows', async () => {
    const windows = { ...options, platform: 'win32' as const }
    assert.deepEqual(summary(await resolveInputs([String.raw`sub\*.log`, String.raw`my logs\s*.log`], windows)), [
      `file:sub${path.sep}deep.log`, `file:my logs${path.sep}space.log`
    ])
  })

  it('reads absolute Windows patterns with backslashes', { skip: process.platform !== 'win32' }, async () => {
    const pattern = path.join(directory, 'sub', '*.log')
    assert.match(pattern, /\\/u)
    assert.deepEqual(summary(await resolveInputs([pattern], options)), [`file:sub${path.sep}deep.log`])
  })

  it('matches without regard to case on Windows only', async () => {
    const windows = await resolveInputs(['*.LOG'], { ...options, platform: 'win32' })
    assert.equal(windows.length, 5)
    await assert.rejects(resolveInputs(['*.LOG'], { ...options, platform: 'linux' }), rejection(1, /no file matches/u))
  })
})

describe('standard input', () => {
  it('reads standard input without arguments when it is not a terminal', async () => {
    assert.deepEqual(await resolveInputs([], { ...options, isStdinTerminal: false }), [
      { kind: 'stdin', information: { identifier: '1', label: 'stdin', order: 0 } }
    ])
  })

  it('reports a usage error with exit code 2 without arguments when standard input is a terminal', async () => {
    await assert.rejects(resolveInputs([], options), rejection(2, /^no input: name a log file or pipe records into jv$/u))
  })

  it('reads standard input only where - names it, once', async () => {
    const piped = { ...options, isStdinTerminal: false }
    assert.deepEqual(summary(await resolveInputs(['a.log'], piped)), ['file:a.log'])
    assert.deepEqual(summary(await resolveInputs(['a.log', '-', 'b.log', '-'], piped)), ['file:a.log', 'stdin:stdin', 'file:b.log'])
  })
})

describe('readFileChunks', () => {
  it('reads a file in chunks', async () => {
    const chunks: Buffer[] = []
    const stream = readFileChunks(path.join(directory, 'a.log'))
    for await (const chunk of stream) {
      assert.ok(Buffer.isBuffer(chunk))
      chunks.push(chunk)
    }
    assert.equal(Buffer.concat(chunks).toString('utf8'), '{"file":"a.log"}\n')
  })

  it('stops reading and closes the file when the signal aborts', async () => {
    const controller = new AbortController()
    const stream = readFileChunks(path.join(directory, 'a.log'), controller.signal)
    controller.abort()
    await assert.rejects(async () => {
      for await (const chunk of stream) {
        assert.fail(`read ${String(chunk)}`)
      }
    }, { name: 'AbortError' })
    assert.equal(stream.destroyed, true)
  })
})
