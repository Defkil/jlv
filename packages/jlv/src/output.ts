// Writes records as text lines (plan section 6.1): plain text or JSON lines on standard output for the machine output
// modes, and JSON lines into the file of --save. Writes wait for the destination to drain, so a slow reader slows the
// input down instead of filling the memory, and a reader that goes away early (EPIPE) ends the output normally.
import type { BigIntStats } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import { toEntry } from './log.js'

type MachineFormat = 'plain' | 'jsonl'

// A record as one JSON line, with the values as they were parsed and mapped.
const jsonLine = (record: unknown): string => `${JSON.stringify(record)}\n`

const escapeLineBreaks = (text: string): string => text.replaceAll('\r', String.raw`\r`).replaceAll('\n', String.raw`\n`)

// Text as it is, other values as JSON, a missing value as a dash; line breaks become visible escapes, so that every
// record stays on one line.
const plainField = (value: unknown): string => {
  if (value === undefined) {
    return '-'
  }
  return escapeLineBreaks(typeof value === 'string' ? value : JSON.stringify(value))
}

// A record as one text line: timestamp, level and message of the viewer's row, then its other fields as JSON.
const plainLine = (record: unknown): string => {
  const { timestamp, level, message, data } = toEntry(record)
  const fields = [timestamp, level, message].map(value => plainField(value)).join(' ')
  return Object.keys(data).length > 0 ? `${fields} ${escapeLineBreaks(JSON.stringify(data))}\n` : `${fields}\n`
}

const formatLine = (format: MachineFormat, record: unknown): string => format === 'jsonl' ? jsonLine(record) : plainLine(record)

const isBrokenPipe = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')

// Writes text to a stream and waits for it to drain when its buffer is full. A destination that closes early ends
// the writer: later writes are dropped, and onClose tells the application to stop.
class LineWriter {
  #isClosed = false
  #error: Error | undefined
  readonly #stream: Writable
  readonly #onClose: (error: Error | undefined) => void
  readonly #handleError = (error: Error): void => {
    if (this.#isClosed) {
      return
    }
    this.#isClosed = true
    this.#error = isBrokenPipe(error) ? undefined : error
    this.#onClose(this.#error)
  }

  constructor (stream: Writable, onClose: (error: Error | undefined) => void) {
    this.#stream = stream
    this.#onClose = onClose
    stream.on('error', this.#handleError)
  }

  // Whether the destination went away.
  get isClosed (): boolean {
    return this.#isClosed
  }

  // The error that closed the destination; undefined when it closed normally or not at all.
  get error (): Error | undefined {
    return this.#error
  }

  async write (text: string): Promise<void> {
    if (text === '' || this.#isClosed || this.#stream.write(text)) {
      return
    }
    await new Promise<void>(resolve => {
      const done = (): void => {
        this.#stream.off('drain', done)
        this.#stream.off('close', done)
        this.#stream.off('error', done)
        resolve()
      }
      this.#stream.on('drain', done)
      this.#stream.on('close', done)
      this.#stream.on('error', done)
    })
  }

  // Waits until everything written so far has left the stream's buffer. The writer keeps listening for errors, so
  // that a reader that goes away after the last write cannot end the process with an unhandled error.
  async flush (): Promise<void> {
    if (!this.#isClosed && this.#stream.writableLength > 0) {
      await new Promise<void>(resolve => {
        this.#stream.write('', () => { resolve() })
      })
    }
  }

  // Ends a stream that the writer owns, such as a file, and waits until it is closed.
  async end (): Promise<void> {
    if (this.#stream.closed) {
      return
    }
    await new Promise<void>(resolve => {
      this.#stream.once('close', resolve)
      this.#stream.end()
    })
  }
}

// A save file that cannot be used, with the exit code of plan section 6.1: 2 when the command line asks for something
// that would destroy data, 1 when the file cannot be created.
class SaveFileError extends Error {
  readonly exitCode: 1 | 2

  constructor (message: string, exitCode: 1 | 2) {
    super(message)
    this.name = 'SaveFileError'
    this.exitCode = exitCode
  }
}

interface SaveFileOptions {
  // How the command line named the file, for messages.
  readonly label: string
  // Replace an existing file instead of refusing it.
  readonly isOverwriting: boolean
  // The input files, which the save file must not be.
  readonly inputs: readonly string[]
}

const statOrUndefined = async (file: string): Promise<BigIntStats | undefined> => {
  try {
    return await stat(file, { bigint: true })
  } catch {
    return undefined
  }
}

// Two names of one file: the same device and file number, or the same real path where there are no file numbers.
const isSameFile = async (file: string, status: BigIntStats, other: string): Promise<boolean> => {
  const otherStatus = await statOrUndefined(other)
  if (otherStatus === undefined) {
    return false
  }
  return status.ino !== 0n && otherStatus.ino !== 0n
    ? status.dev === otherStatus.dev && status.ino === otherStatus.ino
    : await realpath(file) === await realpath(other)
}

// Creates the file that --save writes the matching records to (plan section 6.1). An existing file is refused unless
// it is to be overwritten, and an input is refused always, also through another spelling, a link or a hard link.
// The file is created exclusively, so that a file created in the meantime is not replaced either.
const openSaveFile = async (file: string, options: SaveFileOptions): Promise<Writable> => {
  const status = await statOrUndefined(file)
  if (status !== undefined) {
    for (const input of options.inputs) {
      if (await isSameFile(file, status, input)) {
        throw new SaveFileError(`cannot save to '${options.label}': it is one of the inputs`, 2)
      }
    }
    if (!options.isOverwriting) {
      throw new SaveFileError(`cannot save to '${options.label}': the file exists; --overwrite replaces it`, 2)
    }
  }
  try {
    const handle = await open(file, options.isOverwriting ? 'w' : 'wx')
    return handle.createWriteStream()
  } catch (error) {
    throw new SaveFileError(`cannot save to '${options.label}': ${error instanceof Error ? error.message : String(error)}`, 1)
  }
}

export { LineWriter, SaveFileError, formatLine, jsonLine, openSaveFile, plainLine }
export type { MachineFormat, SaveFileOptions }
