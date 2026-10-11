// Writes records as text lines for machine output modes (plan section 6.1): plain text or JSON lines on standard
// output. Writes wait for the destination to drain, so a slow reader slows the input down instead of filling the
// memory, and a reader that goes away early (EPIPE) ends the output normally.
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
}

export { LineWriter, formatLine, jsonLine, plainLine }
export type { MachineFormat }
