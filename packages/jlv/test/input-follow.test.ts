// Following files by polling (src/input/follow.ts) through controlled file operations: appends, writes that end
// inside a character, truncation, rotation, deletion and recreation, failures and the end at an abort signal. The
// follower hands over bytes and the end of each file's data; a line framer that ends there shows what a reader makes
// of them.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { after, describe, it } from 'node:test'
import { builtInFormats, jsonLinesFormat } from '../src/formats/registry.js'
import { Ingestion, SourceState, sourceBatches, type IngestionSettings } from '../src/ingestion.js'
import { FileFollower, followFile, generationsOf, type FollowEvent } from '../src/input/follow.js'
import { LineSplitter, type LineEvent } from '../src/input/lines.js'
import { RecordStore } from '../src/store.js'

const root = mkdtempSync(path.join(tmpdir(), 'jlv-follow-'))
after(() => {
  rmSync(root, { recursive: true, force: true })
})

const newDirectory = (): string => mkdtempSync(path.join(root, 'case-'))

const describeLine = (event: LineEvent): string =>
  event.kind === 'line' ? `${String(event.lineNumber)}:${event.bytes.toString('utf8')}` : `${String(event.lineNumber)}:oversized`

// One poll of the follower, framed into lines: the end of a file's data ends its unfinished line and starts the line
// numbers again.
const poll = async (follower: FileFollower, splitter: LineSplitter): Promise<string[]> => {
  const lines: string[] = []
  for await (const event of follower.poll()) {
    if (event.kind === 'bytes') {
      lines.push(...splitter.push(event.bytes).map(line => describeLine(line)))
    } else {
      lines.push(...splitter.end().map(line => describeLine(line)))
      splitter.reset()
    }
  }
  return lines
}

describe('file follower', () => {
  it('reads what the file holds at the first poll, and the reader holds back an unfinished line', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, 'a\nb')
    const follower = new FileFollower(file)
    const splitter = new LineSplitter()
    try {
      assert.deepEqual(await poll(follower, splitter), ['1:a'])
      assert.equal(splitter.hasPartialLine, true)
      assert.deepEqual(await poll(follower, splitter), [])
      appendFileSync(file, '\n')
      assert.deepEqual(await poll(follower, splitter), ['2:b'])
    } finally {
      await follower.close()
    }
  })

  it('reads appended bytes also when a write ends inside a UTF-8 character', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, '')
    const follower = new FileFollower(file)
    const splitter = new LineSplitter()
    try {
      assert.deepEqual(await poll(follower, splitter), [])
      const text = Buffer.from('{"m":"€ and 𝄞"}\n', 'utf8')
      for (let split = 1; split < text.length; split += 3) {
        appendFileSync(file, text.subarray(split - 1, Math.min(split + 2, text.length)))
        assert.deepEqual(await poll(follower, splitter), split + 2 >= text.length ? ['1:{"m":"€ and 𝄞"}'] : [])
      }
    } finally {
      await follower.close()
    }
  })

  it('ends the file\'s data and starts again at 0 when the file is truncated', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, 'one\ntwo\npartial')
    const follower = new FileFollower(file)
    const splitter = new LineSplitter()
    try {
      assert.deepEqual(await poll(follower, splitter), ['1:one', '2:two'])
      truncateSync(file, 0)
      appendFileSync(file, 'fresh\n')
      assert.deepEqual(await poll(follower, splitter), ['3:partial', '1:fresh'])
    } finally {
      await follower.close()
    }
  })

  it('reads the rest of a rotated file, ends its data and reads the new file from its start', async () => {
    const directory = newDirectory()
    const file = path.join(directory, 'app.log')
    writeFileSync(file, 'a\nb')
    const follower = new FileFollower(file)
    const splitter = new LineSplitter()
    try {
      assert.deepEqual(await poll(follower, splitter), ['1:a'])
      renameSync(file, path.join(directory, 'app.log.1'))
      appendFileSync(path.join(directory, 'app.log.1'), 'c\nd')
      writeFileSync(file, 'new\n')
      assert.deepEqual(await poll(follower, splitter), ['2:bc', '3:d', '1:new'])
      appendFileSync(file, 'next\n')
      assert.deepEqual(await poll(follower, splitter), ['2:next'])
    } finally {
      await follower.close()
    }
  })

  it('waits while the path names no file and reads the file that appears there', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, 'a\n')
    const follower = new FileFollower(file)
    const splitter = new LineSplitter()
    try {
      assert.deepEqual(await poll(follower, splitter), ['1:a'])
      unlinkSync(file)
      assert.deepEqual(await poll(follower, splitter), [])
      assert.deepEqual(await poll(follower, splitter), [])
      writeFileSync(file, 'b\n')
      assert.deepEqual(await poll(follower, splitter), ['1:b'])
      // A directory in its place counts as no file. On Node 22.9.0, Windows keeps the name of a deleted file that is
      // still open, so the directory can only take its place once a poll has closed the file.
      unlinkSync(file)
      assert.deepEqual(await poll(follower, splitter), [])
      mkdirSync(file)
      assert.deepEqual(await poll(follower, splitter), [])
      rmSync(file, { recursive: true })
      writeFileSync(file, 'c\n')
      assert.deepEqual(await poll(follower, splitter), ['1:c'])
    } finally {
      await follower.close()
    }
  })
})

const events = (...list: readonly FollowEvent[]): AsyncIterable<FollowEvent> => Readable.from(list)

const bytes = (text: string): FollowEvent => ({ kind: 'bytes', bytes: Buffer.from(text, 'utf8') })

const textOf = (chunk: Uint8Array): string => Buffer.from(chunk).toString('utf8')

// The first chunk of a generation, whose reader then stops.
const firstChunk = async (generation: AsyncIterable<Uint8Array>): Promise<string | undefined> => {
  const iterator = generation[Symbol.asyncIterator]()
  const result = await iterator.next()
  await iterator.return?.()
  return result.done === true ? undefined : textOf(result.value)
}

describe('generations of a followed name', () => {
  it('give the bytes of each file until its data ends', async () => {
    const files: string[] = []
    const generations = generationsOf(events(bytes('a'), bytes('b'), { kind: 'end' }, bytes('c'), { kind: 'end' }, bytes('d')))
    for await (const generation of generations) {
      let text = ''
      for await (const chunk of generation) {
        text += textOf(chunk)
      }
      files.push(text)
    }
    assert.deepEqual(files, ['ab', 'c', 'd'])
  })

  it('skip the rest of a file that its reader left early', async () => {
    const firsts: (string | undefined)[] = []
    const generations = generationsOf(events(bytes('a'), bytes('b'), { kind: 'end' }, bytes('c')))
    for await (const generation of generations) {
      firsts.push(await firstChunk(generation))
    }
    assert.deepEqual(firsts, ['a', 'c'])
  })
})

const jsonSettings: IngestionSettings = {
  formats: builtInFormats(),
  format: jsonLinesFormat,
  fallback: jsonLinesFormat,
  mapping: {},
  timestampUnit: undefined,
  levels: {},
  maximumRecordSize: 1024 * 1024
}

const waitUntil = async (isReady: () => boolean): Promise<void> => {
  const deadline = performance.now() + 5000
  while (!isReady()) {
    assert.ok(performance.now() < deadline, 'timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('following a file', () => {
  it('numbers the records of a followed source on across rotations, with a reader per file', async () => {
    const directory = newDirectory()
    const file = path.join(directory, 'app.log')
    writeFileSync(file, '{"n":1}\n{"n":2}\n')
    const controller = new AbortController()
    const store = new RecordStore()
    const ingestion = new Ingestion({ store })
    const source = new SourceState({ identifier: '1', label: 'app.log', order: 0 }, file, jsonSettings, controller.signal)
    const following = (async () => {
      const batches = sourceBatches(source, generationsOf(followFile(file, controller.signal, { interval: 10 })), jsonSettings, true)
      for await (const batch of batches) {
        ingestion.accept(batch)
      }
    })()
    await waitUntil(() => store.retained === 2)
    renameSync(file, path.join(directory, 'app.log.1'))
    writeFileSync(file, '{"n":3}\n')
    await waitUntil(() => store.retained === 3)
    controller.abort()
    await assert.rejects(following, { name: 'AbortError' })
    assert.deepEqual([0, 1, 2].map(sequence => store.identifierAt(sequence)), ['1:1', '1:2', '1:3'])
    assert.deepEqual([0, 1, 2].map(sequence => store.positionAt(sequence).firstLine), [1, 2, 1])
  })

  it('stops at the abort signal during its pause', async () => {
    const file = path.join(newDirectory(), 'paused.log')
    writeFileSync(file, 'one\n')
    const controller = new AbortController()
    const changes: string[] = []
    let stopped = 0
    const following = followFile(file, controller.signal, { interval: 60_000 })
    await assert.rejects(async () => {
      for await (const event of following) {
        changes.push(event.kind === 'bytes' ? Buffer.from(event.bytes).toString('utf8') : 'end')
        setTimeout(() => {
          stopped = performance.now()
          controller.abort()
        }, 20)
      }
    }, { name: 'AbortError' })
    assert.ok(performance.now() - stopped < 1000)
    assert.deepEqual(changes, ['one\n'])
  })

  // A path with a null character cannot be checked on any platform, which stands for any error other than a
  // missing file.
  it('ends with the error of a file that cannot be read', async () => {
    const broken = path.join(newDirectory(), 'broken\u{0}.log')
    const following = followFile(broken, new AbortController().signal, { interval: 10 })
    await assert.rejects(async () => {
      for await (const event of following) {
        assert.fail(`no event expected, got ${event.kind}`)
      }
    }, (error: unknown) => error instanceof Error && error.name !== 'AbortError')
  })
})
