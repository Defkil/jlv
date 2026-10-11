// Follows files by name with polling (plan section 6.1): every 500 ms each file is checked and what was appended is
// read, instead of relying on fs.watch notifications, which differ between platforms. A follower keeps the open file,
// its identity (device and file number), the byte offset read so far and the unfinished last line.
//
// - Appended bytes are read from the offset on; an unfinished line, also one that ends inside a UTF-8 character,
//   waits for its line feed.
// - A file that shrinks was truncated in place: its unfinished line is ended, and reading starts again at 0.
// - A path that names another file was rotated: the rest of the old file, written before or after the rename, is read
//   and its unfinished line ended; then the new file is read from its start.
// - A path that names no regular file, while it is deleted, renamed away or replaced by a directory, is tried again
//   at the next poll.
// Record numbers go on across these changes; line numbers start at 1 in each file. Truncation that is followed by
// more writes than the file held before the next poll cannot be seen by size; polling has that limit.
import type { BigIntStats } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { SourceInformation } from './files.js'
import { LineSplitter, type LineEvent } from './lines.js'

// The polling interval of plan section 6.1.
const defaultFollowInterval = 500

const chunkBytes = 256 * 1024

interface FollowOptions {
  readonly interval?: number
  readonly maximumLineBytes?: number
  // A file that cannot be read any more is reported here and no longer followed; the others go on.
  readonly onFailure?: (source: SourceInformation, error: unknown) => void
}

// Errors of a path that names no readable file right now: missing, or on Windows deleted while a handle is open.
const absentCodes: ReadonlySet<unknown> = new Set(['ENOENT', 'ENOTDIR', 'EPERM', 'EACCES'])

const isAbsent = (error: unknown): boolean => error instanceof Error && 'code' in error && absentCodes.has(error.code)

// What makes a file the same file: device and file number where the file system has them, else device and birth.
const identityOf = (status: BigIntStats): string =>
  status.ino === 0n ? `${String(status.dev)}@${String(status.birthtimeNs)}` : `${String(status.dev)}:${String(status.ino)}`

class FileFollower {
  #handle: FileHandle | undefined
  #identity: string | undefined
  #offset = 0
  readonly #splitter: LineSplitter
  readonly path: string

  constructor (path: string, options: FollowOptions = {}) {
    this.path = path
    this.#splitter = new LineSplitter(options.maximumLineBytes === undefined ? {} : { maximumLineBytes: options.maximumLineBytes })
  }

  // Reads the open file from the offset to its current end, chunk by chunk.
  async * #readToEnd (): AsyncGenerator<LineEvent[]> {
    const handle = this.#handle
    if (handle === undefined) {
      return
    }
    for (;;) {
      const buffer = Buffer.allocUnsafe(chunkBytes)
      const { bytesRead } = await handle.read(buffer, 0, chunkBytes, this.#offset)
      if (bytesRead === 0) {
        return
      }
      this.#offset += bytesRead
      const events = this.#splitter.push(buffer.subarray(0, bytesRead))
      if (events.length > 0) {
        yield events
      }
    }
  }

  // Reads the rest of the old file, ends its unfinished line and closes it.
  async * #retire (): AsyncGenerator<LineEvent[]> {
    yield * this.#readToEnd()
    const events = this.#splitter.end()
    if (events.length > 0) {
      yield events
    }
    await this.close()
  }

  async #openCurrent (): Promise<boolean> {
    let handle: FileHandle
    try {
      handle = await open(this.path, 'r')
    } catch (error) {
      if (isAbsent(error)) {
        return false
      }
      throw error
    }
    this.#handle = handle
    this.#identity = identityOf(await handle.stat({ bigint: true }))
    this.#offset = 0
    this.#splitter.reset()
    return true
  }

  // Whether an unfinished line waits for its line feed.
  get hasPartialLine (): boolean {
    return this.#splitter.hasPartialLine
  }

  // Reads what changed since the last poll, as lists of line events.
  async * poll (): AsyncGenerator<LineEvent[]> {
    let status: BigIntStats | undefined
    try {
      status = await stat(this.path, { bigint: true })
    } catch (error) {
      if (!isAbsent(error)) {
        throw error
      }
    }
    if (status !== undefined && !status.isFile()) {
      status = undefined
    }
    if (this.#handle !== undefined && (status === undefined || identityOf(status) !== this.#identity)) {
      yield * this.#retire()
    }
    if (status === undefined) {
      return
    }
    if (this.#handle === undefined && !await this.#openCurrent()) {
      return
    }
    if (status.size < BigInt(this.#offset)) {
      const events = this.#splitter.end()
      if (events.length > 0) {
        yield events
      }
      this.#offset = 0
      this.#splitter.reset()
    }
    yield * this.#readToEnd()
  }

  async close (): Promise<void> {
    const handle = this.#handle
    this.#handle = undefined
    this.#identity = undefined
    await handle?.close()
  }
}

interface FollowedFile {
  readonly source: SourceInformation
  readonly path: string
}

// The lines of the files as they change, file by file in their order at every poll, until the signal aborts or no
// file is left. The first poll reads what the files hold already.
async function * followFiles (
  files: readonly FollowedFile[],
  signal: AbortSignal,
  options: FollowOptions = {}
): AsyncGenerator<{ readonly source: SourceInformation, readonly events: LineEvent[] }> {
  let followers = files.map(file => ({ source: file.source, follower: new FileFollower(file.path, options) }))
  try {
    while (followers.length > 0) {
      const failed = new Set<FileFollower>()
      for (const { source, follower } of followers) {
        signal.throwIfAborted()
        try {
          const changes = follower.poll()
          for await (const events of changes) {
            yield { source, events }
          }
        } catch (error) {
          if (signal.aborted || options.onFailure === undefined) {
            throw error
          }
          options.onFailure(source, error)
          failed.add(follower)
          await follower.close()
        }
      }
      followers = followers.filter(({ follower }) => !failed.has(follower))
      if (followers.length > 0) {
        await delay(options.interval ?? defaultFollowInterval, undefined, { signal })
      }
    }
  } finally {
    await Promise.allSettled(followers.map(async ({ follower }) => { await follower.close() }))
  }
}

export { FileFollower, defaultFollowInterval, followFiles }
export type { FollowedFile, FollowOptions }
