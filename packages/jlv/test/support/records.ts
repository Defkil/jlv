// Reads text through the format pipeline as the application does: per-source format choice from a sample, the
// format's reader, normalization, identity and diagnostics.
import { Readable } from 'node:stream'
import type { FieldMapping, LogFormat, LogLevel, ParseDiagnostic, TimestampUnit } from '../../src/api.js'
import { builtInFormats, jsonLinesFormat } from '../../src/formats/registry.js'
import { Ingestion, SourceState, sourceBatches, type NormalizedRecord } from '../../src/ingestion.js'
import { defaultMaximumLineBytes } from '../../src/input/lines.js'
import { rowOf, type LogRow, type RowOptions } from '../../src/tui/log-row.js'

export interface ReadOptions {
  // The format of the input; undefined probes it.
  readonly format?: LogFormat
  // The formats that probes choose from, in their order; the built-in formats by default.
  readonly formats?: readonly LogFormat[]
  readonly mapping?: FieldMapping
  readonly timestampUnit?: TimestampUnit
  readonly levels?: Readonly<Record<string, LogLevel>>
  // The name of the input, whose extension the probes see.
  readonly file?: string
  // Splits the input into chunks of this many bytes; one chunk by default.
  readonly chunkBytes?: number
}

export interface ReadResult {
  readonly records: readonly NormalizedRecord[]
  readonly diagnostics: readonly ParseDiagnostic[]
  // The identifier of the format that read the input.
  readonly format: string | undefined
}

const chunksOf = (bytes: Buffer, size: number): Buffer[] => {
  const chunks: Buffer[] = []
  for (let start = 0; start < bytes.length; start += size) {
    chunks.push(bytes.subarray(start, start + size))
  }
  return chunks
}

export const readRecords = async (input: string | Buffer, options: ReadOptions = {}): Promise<ReadResult> => {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  const settings = {
    formats: options.formats ?? builtInFormats(),
    format: options.format,
    fallback: jsonLinesFormat,
    mapping: options.mapping ?? {},
    timestampUnit: options.timestampUnit,
    levels: options.levels ?? {},
    maximumRecordSize: defaultMaximumLineBytes
  }
  const file = options.file ?? 'test.log'
  const source = new SourceState({ identifier: '1', label: file, order: 0 }, file, settings, new AbortController().signal)
  const diagnostics: ParseDiagnostic[] = []
  const ingestion = new Ingestion({ isCollecting: true, onDiagnostic: (_source, diagnostic) => { diagnostics.push(diagnostic) } })
  const records: NormalizedRecord[] = []
  const chunks = Readable.from(chunksOf(bytes, options.chunkBytes ?? Math.max(bytes.length, 1)))
  const batches = sourceBatches(source, [chunks], settings, false)
  for await (const batch of batches) {
    records.push(...ingestion.accept(batch))
  }
  return { records, diagnostics, format: source.format?.identifier }
}

// The rows of the viewer for the records.
export const rowsOf = (records: readonly NormalizedRecord[], options: RowOptions = {}): LogRow[] =>
  records.map(record => rowOf(record, options))

// The rows without their records, as the widgets read them.
export const shownRows = (records: readonly NormalizedRecord[], options: RowOptions = {}): object[] =>
  rowsOf(records, options).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'record')))
