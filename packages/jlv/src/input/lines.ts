// Frames the records of a source from its byte chunks (plan section 6.1). A record is one line: it ends at a line
// feed, and a carriage return right before it belongs to the line ending. A UTF-8 byte order mark at the start of a
// source is dropped. Framing works on bytes, not on decoded text: a line feed (0x0A) never occurs inside a UTF-8
// multi-byte sequence, so a chunk may end anywhere, inside a character or between CR and LF, without decoder state.
//
// Lines are bounded. A line longer than the maximum is not collected: its bytes are dropped up to the next line feed
// and reported once, so a source without line feeds cannot fill the memory.

// The largest record a line may hold, 1 MiB (plan section 6.1).
const defaultMaximumLineBytes = 1024 * 1024

const lineFeed = 0x0A
const carriageReturn = 0x0D
const byteOrderMark: readonly number[] = [0xEF, 0xBB, 0xBF]

// A complete line without its line ending, numbered from 1 within its file. The bytes may share memory with the
// chunk they came from and stay valid as long as that chunk does.
interface Line {
  readonly kind: 'line'
  readonly bytes: Buffer
  readonly lineNumber: number
}

// A line longer than the maximum, with the number of bytes that were dropped, without the line feed.
interface OversizedLine {
  readonly kind: 'oversized'
  readonly lineNumber: number
  readonly byteLength: number
}

type LineEvent = Line | OversizedLine

interface LineSplitterOptions {
  readonly maximumLineBytes?: number
}

const toBuffer = (chunk: Uint8Array): Buffer =>
  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)

class LineSplitter {
  // The start of an unfinished line, copied out of earlier chunks.
  #pieces: Buffer[] = []
  #pendingLength = 0
  // The bytes dropped so far of an oversized line, undefined while no line is dropped.
  #droppedLength: number | undefined
  #lineNumber = 0
  // The leading bytes of the source while they may still be a byte order mark, undefined once decided.
  #startBytes: number[] | undefined = []
  readonly maximumLineBytes: number

  constructor (options: LineSplitterOptions = {}) {
    this.maximumLineBytes = options.maximumLineBytes ?? defaultMaximumLineBytes
    if (!Number.isSafeInteger(this.maximumLineBytes) || this.maximumLineBytes < 1) {
      throw new RangeError(`The maximum line size must be a positive integer, not ${String(this.maximumLineBytes)}.`)
    }
  }

  // Drops a byte order mark at the start of the source, which may arrive split over several chunks.
  #withoutByteOrderMark (bytes: Buffer): Buffer {
    const startBytes = this.#startBytes
    if (startBytes === undefined) {
      return bytes
    }
    const earlierLength = startBytes.length
    let index = 0
    while (index < bytes.length && startBytes.length < byteOrderMark.length) {
      const byte = bytes[index] ?? 0
      if (byte !== byteOrderMark[startBytes.length]) {
        // Not a byte order mark: the bytes taken from earlier chunks belong to the first line, before this chunk.
        this.#startBytes = undefined
        return earlierLength === 0 ? bytes : Buffer.concat([Buffer.from(startBytes.slice(0, earlierLength)), bytes])
      }
      startBytes.push(byte)
      index += 1
    }
    if (startBytes.length === byteOrderMark.length) {
      this.#startBytes = undefined
    }
    return bytes.subarray(index)
  }

  #hold (bytes: Buffer): void {
    if (this.#droppedLength !== undefined) {
      this.#droppedLength += bytes.length
      return
    }
    this.#pendingLength += bytes.length
    // One byte more than the maximum may still be the carriage return of a CRLF ending.
    if (this.#pendingLength > this.maximumLineBytes + 1) {
      this.#droppedLength = this.#pendingLength
      this.#pieces = []
      this.#pendingLength = 0
      return
    }
    this.#pieces.push(Buffer.from(bytes))
  }

  // Ends the line with the segment before its line feed.
  #complete (segment: Buffer, events: LineEvent[]): void {
    this.#lineNumber += 1
    const lineNumber = this.#lineNumber
    const pieces = this.#pieces
    const droppedLength = this.#droppedLength
    const totalLength = (droppedLength ?? this.#pendingLength) + segment.length
    this.#pieces = []
    this.#pendingLength = 0
    this.#droppedLength = undefined
    const lastByte = segment.length > 0 ? segment.at(-1) : pieces.at(-1)?.at(-1)
    const contentLength = lastByte === carriageReturn ? totalLength - 1 : totalLength
    if (droppedLength !== undefined || contentLength > this.maximumLineBytes) {
      events.push({ kind: 'oversized', lineNumber, byteLength: totalLength })
      return
    }
    const line = pieces.length === 0 ? segment : Buffer.concat([...pieces, segment], totalLength)
    events.push({ kind: 'line', bytes: line.subarray(0, contentLength), lineNumber })
  }

  // Whether the bytes of an unfinished line are held back until its line feed arrives.
  get hasPartialLine (): boolean {
    return this.#pendingLength > 0 || this.#droppedLength !== undefined || (this.#startBytes?.length ?? 0) > 0
  }

  // The bytes held for the unfinished line, never more than the maximum plus one for a carriage return.
  get pendingByteLength (): number {
    return this.#pendingLength
  }

  // Frames the complete lines of the chunk and holds back the rest.
  push (chunk: Uint8Array): LineEvent[] {
    const events: LineEvent[] = []
    const bytes = this.#withoutByteOrderMark(toBuffer(chunk))
    let start = 0
    while (start < bytes.length) {
      const end = bytes.indexOf(lineFeed, start)
      if (end === -1) {
        this.#hold(bytes.subarray(start))
        break
      }
      this.#complete(bytes.subarray(start, end), events)
      start = end + 1
    }
    return events
  }

  // Ends the source: an unfinished last line is a line of its own, as at the end of a finite file.
  end (): LineEvent[] {
    const events: LineEvent[] = []
    if (this.#startBytes !== undefined && this.#startBytes.length > 0) {
      this.#hold(Buffer.from(this.#startBytes))
    }
    this.#startBytes = undefined
    if (this.#pendingLength > 0 || this.#droppedLength !== undefined) {
      this.#complete(Buffer.alloc(0), events)
    }
    return events
  }

  // Forgets the unfinished line and starts a new file: line numbers start at 1 again, and a byte order mark at its
  // start is dropped.
  reset (): void {
    this.#pieces = []
    this.#pendingLength = 0
    this.#droppedLength = undefined
    this.#lineNumber = 0
    this.#startBytes = []
  }
}

// Frames a source of byte chunks, one list of events per chunk that completes a line, and the last line at the end.
async function * readLines (chunks: AsyncIterable<Uint8Array>, options: LineSplitterOptions = {}): AsyncGenerator<LineEvent[]> {
  const splitter = new LineSplitter(options)
  for await (const chunk of chunks) {
    const events = splitter.push(chunk)
    if (events.length > 0) {
      yield events
    }
  }
  const events = splitter.end()
  if (events.length > 0) {
    yield events
  }
}

export { LineSplitter, defaultMaximumLineBytes, readLines }
export type { Line, LineEvent, LineSplitterOptions, OversizedLine }
