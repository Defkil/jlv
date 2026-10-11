// Writes records as text lines (plan section 6.1): plain text or JSON lines on standard output for the machine output
// modes, and JSON lines into the file of --save. Writes wait for the destination to drain, so a slow reader slows the
// input down instead of filling the memory, and a reader that goes away early (EPIPE) ends the output normally.
import { constants, type BigIntStats } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import type { LogRecord } from './api.js'
import type { NormalizedRecord } from './ingestion.js'
import { escapeControls, visibleText } from './terminal-text.js'
import { rowOf, type LogRow, type RowOptions } from './tui/log-row.js'

type MachineFormat = 'plain' | 'jsonl'

// A record as one JSON line in the record model's shape (plan section 5): its identity, its normalized parts and its
// complete original fields, in a fixed order. Values are the parsed ones, never the raw bytes. JSON.stringify leaves
// DEL, the C1 controls and a few other control characters as they are; they become escapes too, which JSON reads back
// as the same values, so that the line is safe on a terminal.
const jsonLine = (record: LogRecord): string => `${escapeControls(JSON.stringify({
  identifier: record.identifier,
  source: record.source,
  position: record.position,
  timestamp: record.timestamp,
  timestampText: record.timestampText,
  level: record.level,
  message: record.message,
  correlationIdentifier: record.correlationIdentifier,
  fields: record.fields
}))}\n`

// Text as the viewer shows it: no escape sequences, and control characters such as line breaks as JSON escapes, so
// that every record stays on one line. A missing or empty value is a dash.
const plainField = (value: string | undefined): string => {
  const text = value === undefined ? '' : visibleText(value)
  return text === '' ? '-' : text
}

// A record as one text line: timestamp, level and message of the viewer's row, then the fields that the viewer's
// details show, as JSON.
const plainLine = (row: LogRow): string => {
  const fields = [row.timestamp, row.level, row.message].map(value => plainField(value)).join(' ')
  return Object.keys(row.data).length > 0 ? `${fields} ${escapeControls(JSON.stringify(row.data))}\n` : `${fields}\n`
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

  readonly #handleClose = (): void => {
    if (this.#isClosed) {
      return
    }
    this.#isClosed = true
    this.#onClose(undefined)
  }

  constructor (stream: Writable, onClose: (error: Error | undefined) => void) {
    this.#stream = stream
    this.#onClose = onClose
    stream.on('error', this.#handleError)
    stream.on('close', this.#handleClose)
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
    if (text === '' || this.#isClosed || signal?.aborted === true || this.#stream.write(text)) {
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
  async flush (signal?: AbortSignal): Promise<void> {
    if (!this.#isClosed && this.#stream.writableLength > 0) {
      await new Promise<void>(resolve => {
        const done = (): void => {
          signal?.removeEventListener('abort', done)
          this.#stream.off('close', done)
          resolve()
        }
        if (signal?.aborted === true) {
          done()
          return
        }
        signal?.addEventListener('abort', done, { once: true })
        this.#stream.once('close', done)
        this.#stream.write('', done)
      })
    }
  }

  // Ends a stream that the writer owns, such as a file, and waits until it is closed.
  async end (): Promise<void> {
    if (this.#stream.closed) {
      return
    }
    await new Promise<void>(resolve => {
      // Closing an owned stream deliberately is not a failure of its destination.
      this.#stream.off('close', this.#handleClose)
      this.#stream.once('close', resolve)
      this.#stream.end()
    })
  }

  // A completed run must not leave listeners on a borrowed stdout. Pending writes after cancellation retain the
  // error listener until they finish or close, so a late EPIPE still has a handler.
  dispose (): void {
    this.#stream.off('close', this.#handleClose)
    const release = (): void => {
      this.#stream.off('error', this.#handleError)
      this.#stream.off('close', release)
      this.#stream.off('drain', release)
    }
    if (this.#stream.writableLength === 0 || this.#stream.closed) {
      release()
    } else {
      this.#stream.once('close', release)
      this.#stream.once('drain', release)
    }
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
  // A terminal debug destination follows the same file protections, with a message that names its purpose.
  readonly isDebugLog?: boolean
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
  const action = options.isDebugLog === true ? 'write the debug log' : 'save'
  const status = await statOrUndefined(file)
  if (status !== undefined) {
    for (const input of options.inputs) {
      if (await isSameFile(file, status, input)) {
        throw new SaveFileError(`cannot ${action} to '${options.label}': it is one of the inputs`, 2)
      }
    }
    if (!status.isFile()) {
      throw new SaveFileError(`cannot ${action} to '${options.label}': it is not a regular file`, 1)
    }
    if (!options.isOverwriting) {
      const remedy = options.isDebugLog === true ? 'choose a new file' : '--overwrite replaces it'
      throw new SaveFileError(`cannot ${action} to '${options.label}': the file exists; ${remedy}`, 2)
    }
  }
  try {
    // Write access without O_TRUNC opens an existing file without truncating it. Validate the handle first:
    // the destination may have changed to a link to an input since the path was checked above.
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NONBLOCK | (options.isOverwriting ? 0 : constants.O_EXCL)
    const handle = await open(file, flags)
    try {
      const openedStatus = await handle.stat({ bigint: true })
      for (const input of options.inputs) {
        if (await isSameFile(file, openedStatus, input)) {
          throw new SaveFileError(`cannot ${action} to '${options.label}': it is one of the inputs`, 2)
        }
      }
      if (!openedStatus.isFile()) {
        throw new SaveFileError(`cannot ${action} to '${options.label}': it is not a regular file`, 1)
      }
      if (options.isOverwriting) {
        await handle.truncate(0)
      }
      return handle.createWriteStream()
    } catch (error) {
      await handle.close()
      throw error
    }
  } catch (error) {
    if (error instanceof SaveFileError) {
      throw error
    }
    throw new SaveFileError(`cannot ${action} to '${options.label}': ${error instanceof Error ? error.message : String(error)}`, 1)
  }
}

export { LineWriter, SaveFileError, formatLine, jsonLine, openSaveFile, plainLine }
export type { MachineFormat, SaveFileOptions }
