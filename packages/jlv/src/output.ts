// Writes records as text lines (plan section 6.1): plain text or JSON lines on standard output for the machine output
// modes, and JSON lines into the file of --save. Writes wait for the destination to drain, so a slow reader slows the
// input down instead of filling the memory, and a reader that goes away early (EPIPE) ends the output normally.
import type { BigIntStats } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import type { LogRecord } from './api.js'
import type { NormalizedRecord } from './ingestion.js'
import { rowOf, type LogRow, type RowOptions } from './tui/log-row.js'

type MachineFormat = 'plain' | 'jsonl'

// A record as one JSON line in the record model's shape (plan section 5): its identity, its normalized parts and its
// complete original fields, in a fixed order. Values are the parsed ones, never the raw bytes.
const jsonLine = (record: LogRecord): string => `${JSON.stringify({
  identifier: record.identifier,
  source: record.source,
  position: record.position,
  timestamp: record.timestamp,
  timestampText: record.timestampText,
  level: record.level,
  message: record.message,
  correlationIdentifier: record.correlationIdentifier,
  fields: record.fields
})}\n`

const escapeLineBreaks = (text: string): string => text.replaceAll('\r', String.raw`\r`).replaceAll('\n', String.raw`\n`)

// Text as it is, a missing or empty value as a dash; line breaks become visible escapes, so that every record stays on
// one line.
const plainField = (value: string | undefined): string => value === undefined || value === '' ? '-' : escapeLineBreaks(value)

// A record as one text line: timestamp, level and message of the viewer's row, then the fields that the viewer's
// details show, as JSON.
const plainLine = (row: LogRow): string => {
  const fields = [row.timestamp, row.level, row.message].map(value => plainField(value)).join(' ')
  return Object.keys(row.data).length > 0 ? `${fields} ${escapeLineBreaks(JSON.stringify(row.data))}\n` : `${fields}\n`
}

const formatLine = (format: MachineFormat, normalized: NormalizedRecord, options: RowOptions): string =>
  format === 'jsonl' ? jsonLine(normalized.record) : plainLine(rowOf(normalized, options))

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

  // Writes the text and waits until the destination can take more, or until the signal aborts the waiting, so that
  // Ctrl-C does not wait for a slow reader.
  async write (text: string, signal?: AbortSignal): Promise<void> {
    if (text === '' || this.#isClosed || this.#stream.write(text) || signal?.aborted === true) {
      return
    }
    await new Promise<void>(resolve => {
      const done = (): void => {
        this.#stream.off('drain', done)
        this.#stream.off('close', done)
        this.#stream.off('error', done)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      this.#stream.on('drain', done)
      this.#stream.on('close', done)
      this.#stream.on('error', done)
      signal?.addEventListener('abort', done)
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
