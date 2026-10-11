// Follows files by name with polling (plan section 6.1): every 500 ms the file is checked and what was appended is
// read, instead of relying on fs.watch notifications, which differ between platforms. A follower keeps the open file,
// its identity (device and file number) and the byte offset read so far. It hands over bytes, not records: the
// source's format frames them, so that a CSV reader keeps its header and quote state while the file grows.
//
// - Appended bytes are read from the offset on.
// - A file that shrinks was truncated in place: its data ends, and reading starts again at 0.
// - A path that names another file was rotated: the rest of the old file, written before or after the rename, is read
//   and its data ends; then the new file is read from its start.
// - A path that names no regular file, while it is deleted, renamed away or replaced by a directory, is tried again
//   at the next poll.
// Where the data of a file ends, the format's reader ends too and parses the unfinished last record; the next file
// gets a new reader. Record numbers go on across these changes; line numbers start at 1 in each file. Truncation that
// is followed by more writes than the file held before the next poll cannot be seen by size; polling has that limit.
import type { BigIntStats } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// The polling interval of plan section 6.1.
const defaultFollowInterval = 500

const chunkBytes = 256 * 1024

interface FollowOptions {
  readonly interval?: number
}

// Bytes of the followed file, or the end of a file's data at a truncation or a rotation.
type FollowEvent =
  | { readonly kind: 'bytes', readonly bytes: Uint8Array }
  | { readonly kind: 'end' }

const fileEnd: FollowEvent = { kind: 'end' }

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
  readonly path: string

  constructor (path: string) {
    this.path = path
  }

  // Reads the open file from the offset to its current end, chunk by chunk.
  async * #readToEnd (): AsyncGenerator<FollowEvent> {
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
      yield { kind: 'bytes', bytes: buffer.subarray(0, bytesRead) }
    }
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
    return true
  }

  // Reads what changed since the last poll.
  async * poll (): AsyncGenerator<FollowEvent> {
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
      // Rotated or removed: the rest of the old file first.
      yield * this.#readToEnd()
      yield fileEnd
      await this.close()
    }
    if (status === undefined) {
      return
    }
    if (this.#handle === undefined && !await this.#openCurrent()) {
      return
    }
    if (status.size < BigInt(this.#offset)) {
      yield fileEnd
      this.#offset = 0
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

// The changes of a followed file, poll after poll, until the signal aborts. The first poll reads what the file holds
// already. A file that cannot be read ends the iteration with its error.
async function * followFile (path: string, signal: AbortSignal, options: FollowOptions = {}): AsyncGenerator<FollowEvent> {
  const follower = new FileFollower(path)
  try {
    for (;;) {
      signal.throwIfAborted()
      yield * follower.poll()
      await delay(options.interval ?? defaultFollowInterval, undefined, { signal })
    }
  } finally {
    await follower.close()
  }
}

// Splits the changes of a followed name into the files it holds over time: each generation gives the bytes of one file
// until its data ends. A generation is read, or left, before the next one starts.
async function * generationsOf (events: AsyncIterable<FollowEvent>): AsyncGenerator<AsyncIterable<Uint8Array>> {
  const iterator = events[Symbol.asyncIterator]()
  const state = { isDone: false, isEnded: false }
  // Whether the current file may still give bytes.
  const isOpen = (): boolean => !state.isEnded && !state.isDone
  const next = async (): Promise<Uint8Array | undefined> => {
    const result = await iterator.next()
    if (result.done === true) {
      state.isDone = true
      return undefined
    }
    if (result.value.kind === 'end') {
      state.isEnded = true
      return undefined
    }
    return result.value.bytes
  }
  async function * generation (): AsyncGenerator<Uint8Array> {
    for (let bytes = await next(); bytes !== undefined; bytes = await next()) {
      yield bytes
    }
  }
  try {
    while (!state.isDone) {
      state.isEnded = false
      yield generation()
      // A reader that stopped early leaves the rest of its file.
      while (isOpen()) {
        await next()
      }
    }
  } finally {
    await iterator.return?.()
  }
}

export { FileFollower, defaultFollowInterval, followFile, generationsOf }
export type { FollowEvent, FollowOptions }
