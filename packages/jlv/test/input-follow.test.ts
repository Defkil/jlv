// Following files by polling (src/input/follow.ts) through controlled file operations: appends, writes that end
// inside a character, truncation, rotation, deletion and recreation, failures and the end at an abort signal.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { Ingestion } from '../src/application.js'
import { FileFollower, followFiles } from '../src/input/follow.js'
import type { LineEvent } from '../src/input/lines.js'
import { RecordStore } from '../src/store.js'

const root = mkdtempSync(path.join(tmpdir(), 'jlv-follow-'))
after(() => {
  rmSync(root, { recursive: true, force: true })
})

const newDirectory = (): string => mkdtempSync(path.join(root, 'case-'))

const describeEvent = (event: LineEvent): string =>
  event.kind === 'line' ? `${String(event.lineNumber)}:${event.bytes.toString('utf8')}` : `${String(event.lineNumber)}:oversized`

// One poll of the follower, as line number and text per line.
const poll = async (follower: FileFollower): Promise<string[]> => {
  const lines: string[] = []
  for await (const events of follower.poll()) {
    lines.push(...events.map(event => describeEvent(event)))
  }
  return lines
}

describe('file follower', () => {
  it('reads what the file holds at the first poll and holds back an unfinished line', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, 'a\nb')
    const follower = new FileFollower(file)
    try {
      assert.deepEqual(await poll(follower), ['1:a'])
      assert.equal(follower.hasPartialLine, true)
      assert.deepEqual(await poll(follower), [])
      appendFileSync(file, '\n')
      assert.deepEqual(await poll(follower), ['2:b'])
    } finally {
      await follower.close()
    }
  })

  it('reads appended lines also when a write ends inside a UTF-8 character', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, '')
    const follower = new FileFollower(file)
    try {
      assert.deepEqual(await poll(follower), [])
      const text = Buffer.from('{"m":"€ and 𝄞"}\n', 'utf8')
      for (let split = 1; split < text.length; split += 3) {
        appendFileSync(file, text.subarray(split - 1, Math.min(split + 2, text.length)))
        assert.deepEqual(await poll(follower), split + 2 >= text.length ? ['1:{"m":"€ and 𝄞"}'] : [])
      }
    } finally {
      await follower.close()
    }
  })

  it('ends the unfinished line and starts again at 0 when the file is truncated', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, 'one\ntwo\npartial')
    const follower = new FileFollower(file)
    try {
      assert.deepEqual(await poll(follower), ['1:one', '2:two'])
      truncateSync(file, 0)
      appendFileSync(file, 'fresh\n')
      assert.deepEqual(await poll(follower), ['3:partial', '1:fresh'])
    } finally {
      await follower.close()
    }
  })

  it('reads the rest of a rotated file, ends its unfinished line and reads the new file from its start', async () => {
    const directory = newDirectory()
    const file = path.join(directory, 'app.log')
    writeFileSync(file, 'a\nb')
    const follower = new FileFollower(file)
    try {
      assert.deepEqual(await poll(follower), ['1:a'])
      renameSync(file, path.join(directory, 'app.log.1'))
      appendFileSync(path.join(directory, 'app.log.1'), 'c\nd')
      writeFileSync(file, 'new\n')
      assert.deepEqual(await poll(follower), ['2:bc', '3:d', '1:new'])
      appendFileSync(file, 'next\n')
      assert.deepEqual(await poll(follower), ['2:next'])
    } finally {
      await follower.close()
    }
  })

  it('waits while the path names no file and reads the file that appears there', async () => {
    const file = path.join(newDirectory(), 'app.log')
    writeFileSync(file, 'a\n')
    const follower = new FileFollower(file)
    try {
      assert.deepEqual(await poll(follower), ['1:a'])
      unlinkSync(file)
      assert.deepEqual(await poll(follower), [])
      assert.deepEqual(await poll(follower), [])
      writeFileSync(file, 'b\n')
      assert.deepEqual(await poll(follower), ['1:b'])
      // A directory in its place counts as no file.
      unlinkSync(file)
      mkdirSync(file)
      assert.deepEqual(await poll(follower), [])
      rmSync(file, { recursive: true })
      writeFileSync(file, 'c\n')
      assert.deepEqual(await poll(follower), ['1:c'])
    } finally {
      await follower.close()
    }
  })

  it('numbers the records of a followed source on across rotations', async () => {
    const directory = newDirectory()
    const file = path.join(directory, 'app.log')
    writeFileSync(file, '{"n":1}\n{"n":2}\n')
    const follower = new FileFollower(file)
    const store = new RecordStore()
    const ingestion = new Ingestion({ store, mapping: undefined })
    const source = { identifier: '1', label: 'app.log', order: 0 }
    const pollInto = async (): Promise<void> => {
      for await (const events of follower.poll()) {
        ingestion.accept(source, events)
      }
    }
    try {
      await pollInto()
      renameSync(file, path.join(directory, 'app.log.1'))
      writeFileSync(file, '{"n":3}\n')
      await pollInto()
      const identifiers = [0, 1, 2].map(sequence => store.identifierAt(sequence))
      assert.deepEqual(identifiers, ['1:1', '1:2', '1:3'])
    } finally {
      await follower.close()
    }
  })
})

describe('followFiles', () => {
  it('polls the files in their order and stops at the abort signal during its pause', async () => {
    const directory = newDirectory()
    const first = path.join(directory, 'first.log')
    const second = path.join(directory, 'second.log')
    writeFileSync(first, 'one\n')
    writeFileSync(second, 'two\n')
    const controller = new AbortController()
    const files = [
      { source: { identifier: '1', label: 'first.log', order: 0 }, path: first },
      { source: { identifier: '2', label: 'second.log', order: 1 }, path: second }
    ]
    const batches: string[] = []
    let stopped = 0
    const following = followFiles(files, controller.signal, { interval: 60_000 })
    await assert.rejects(async () => {
      for await (const batch of following) {
        batches.push(`${batch.source.label} ${batch.events.map(event => describeEvent(event)).join(',')}`)
        if (batches.length === 2) {
          setTimeout(() => {
            stopped = performance.now()
            controller.abort()
          }, 20)
        }
      }
    }, { name: 'AbortError' })
    assert.ok(performance.now() - stopped < 1000)
    assert.deepEqual(batches, ['first.log 1:one', 'second.log 1:two'])
  })

  // A path with a null character cannot be checked on any platform, which stands for any error other than a
  // missing file.
  it('reports a file that cannot be read and goes on with the others', async () => {
    const directory = newDirectory()
    const healthy = path.join(directory, 'healthy.log')
    writeFileSync(healthy, 'b\n')
    const controller = new AbortController()
    const failures: string[] = []
    const files = [
      { source: { identifier: '1', label: 'broken.log', order: 0 }, path: path.join(directory, 'broken\u{0}.log') },
      { source: { identifier: '2', label: 'healthy.log', order: 1 }, path: healthy }
    ]
    const batches: string[] = []
    const following = followFiles(files, controller.signal, {
      interval: 10,
      onFailure: source => { failures.push(source.label) }
    })
    for await (const batch of following) {
      batches.push(`${batch.source.label} ${batch.events.map(event => describeEvent(event)).join(',')}`)
      if (batches.length === 1) {
        appendFileSync(healthy, 'c\n')
      } else if (batches.length === 2) {
        break
      }
    }
    assert.deepEqual(failures, ['broken.log'])
    assert.deepEqual(batches, ['healthy.log 1:b', 'healthy.log 2:c'])
  })
})
