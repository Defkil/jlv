// The public types of jlv (plan section 5): the record model that every format normalizes to, and the contract of
// a format and of a plugin. This module holds types only, so importing the package has no effects. The built-in
// formats are exported from 'jlv/formats'.
//
// A plugin is trusted application code, not a sandbox: jlv loads it only from an explicit --plugin option and runs it
// in its own process.

/**
 * A value of parsed JSON. Numbers are finite.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/**
 * A JSON object: the shape of every record that a format reads.
 */
export type JsonObject = { readonly [key: string]: JsonValue }

/**
 * The path of a field as a list of segments: object keys, and array indexes as numbers. `["datetime", "date"]` reads
 * `date` inside `datetime`; `["log.level"]` reads the key `log.level` itself. Lookups follow own properties only.
 */
export type FieldPath = readonly (string | number)[]

/**
 * The normalized severity of a record; `unknown` keeps the original value in the record's fields.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'unknown'

/**
 * The unit of numeric timestamps.
 */
export type TimestampUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'

/**
 * Where a record or a problem is in its input: the first and the last line, from 1, within one file.
 */
export interface LinePosition {
  readonly firstLine: number
  readonly lastLine: number
}

/**
 * The position of a stored record: its lines, and its number among the records of its source from 1.
 */
export interface RecordPosition extends LinePosition {
  /**
   * Counts on across the files that a followed name rotates through.
   */
  readonly recordNumber: number
}

/**
 * One input of a run.
 */
export interface SourceInformation {
  /**
   * The input's position among the inputs, from 1, as text.
   */
  readonly identifier: string
  /**
   * What the viewer shows: the argument as given, a matched path, or `stdin`.
   */
  readonly label: string
  /**
   * The input's position among the inputs, from 0.
   */
  readonly order: number
}

/**
 * What a format makes of one record: the normalized parts and the complete original fields.
 */
export interface LogDraft {
  /**
   * Epoch milliseconds; finite, and possibly fractional.
   */
  readonly timestamp?: number
  /**
   * The original timestamp as text when it is no valid time: naive, unparseable or out of range.
   */
  readonly timestampText?: string
  readonly level: LogLevel
  /**
   * Always text: a missing message is empty, and structured messages are bounded JSON text.
   */
  readonly message: string
  /**
   * A non-empty text; numeric identifiers become text, so the identifier 0 is kept.
   */
  readonly correlationIdentifier?: string
  /**
   * The complete original data of the record, not just the fields that the normalized parts left over.
   */
  readonly fields: JsonObject
}

/**
 * A record of a run: a draft with the identity that jlv assigns.
 */
export interface LogRecord extends LogDraft {
  /**
   * `<source identifier>:<record number>`, unique within a run and independent of any order.
   */
  readonly identifier: string
  readonly source: SourceInformation
  readonly position: RecordPosition
}

/**
 * Explicit paths of the normalized parts. A path given here wins over a format's own default fields.
 */
export interface FieldMapping {
  readonly timestamp?: FieldPath
  readonly level?: FieldPath
  readonly message?: FieldPath
  readonly correlationIdentifier?: FieldPath
}

/**
 * What a format learns about the source it reads and the user's settings.
 */
export interface FormatContext {
  /**
   * Aborts when the run ends; a reader stops reading then.
   */
  readonly signal: AbortSignal
  readonly source: SourceInformation
  /**
   * The largest record a reader keeps: bytes of a line, or characters of a CSV record.
   */
  readonly maximumRecordSize: number
  readonly mapping: FieldMapping
  /**
   * The unit that the user gave for numeric timestamps; undefined lets each format use its own default.
   */
  readonly timestampUnit?: TimestampUnit
  /**
   * Levels that the user named for raw level values, which win over a format's own levels. Keys are numbers as
   * decimal text, or text in lower case: `{ "35": "info", "notice": "info" }`.
   */
  readonly levels: Readonly<Record<string, LogLevel>>
}

/**
 * The start of a source, which formats probe to recognize it.
 */
export interface FormatSample {
  /**
   * At most 64 KiB and 32 complete lines, decoded as UTF-8 without a byte order mark.
   */
  readonly text: string
  /**
   * The extension of the source's file name in lower case, with its dot, such as `.csv`.
   */
  readonly extension?: string
}

/**
 * A problem with the input. Errors lose a record; warnings keep it.
 */
export interface ParseDiagnostic {
  readonly kind: 'diagnostic'
  readonly severity: 'warning' | 'error'
  /**
   * A stable code such as `invalid-json`, for counting and documentation.
   */
  readonly code: string
  readonly message: string
  readonly position?: LinePosition
}

/**
 * A record that a reader framed and parsed, before normalization.
 */
export interface ParsedEntry {
  readonly kind: 'entry'
  readonly value: JsonObject
  readonly position: LinePosition
}

/**
 * What a reader produces, in input order.
 */
export type ParseEvent = ParseDiagnostic | ParsedEntry

/**
 * A normalized record and the problems that normalization found, which keep the record.
 */
export interface NormalizationResult {
  readonly record: LogDraft
  readonly diagnostics: readonly ParseDiagnostic[]
}

/**
 * A log format. Its reader frames and parses the bytes of one input and its normalizer turns each parsed entry into
 * the record model; jlv adds the identity, the source and the record number.
 */
export interface LogFormat {
  /**
   * A unique name, which `--format` takes.
   */
  readonly identifier: string
  /**
   * How well the sample fits, from 0 (not at all) to 100. It does no input or output.
   */
  probe (sample: FormatSample, context: FormatContext): number
  /**
   * Reads one input, which ends with its file. A followed file that is truncated or replaced gets a new reader. The
   * reader owns the framing, so records may span lines.
   */
  read (input: AsyncIterable<Uint8Array>, context: FormatContext): AsyncIterable<ParseEvent>
  /**
   * Normalizes one entry of `read`. It changes no field of the value and has no side effects.
   */
  normalize (value: JsonObject, context: FormatContext): NormalizationResult
}

/**
 * A test of a record that a plugin offers to the filters.
 */
export type RecordPredicate = (record: LogRecord) => boolean

/**
 * What a plugin module exports as its default export.
 */
export interface FormatPlugin {
  readonly apiVersion: 1
  readonly formats: readonly LogFormat[]
  readonly predicates?: Readonly<Record<string, RecordPredicate>>
}

/**
 * One condition of a filter. `equals` compares JSON values by type; `contains` looks for text, ignoring case.
 */
export type FilterClause =
  | { readonly field: FieldPath, readonly operator: 'equals', readonly value: JsonValue }
  | { readonly field: FieldPath, readonly operator: 'contains', readonly value: string }

/**
 * Conditions that all (`all`) or at least one (`any`) of must hold.
 */
export interface FilterGroup {
  readonly mode: 'all' | 'any'
  readonly clauses: readonly FilterClause[]
}
