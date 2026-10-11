// The built-in formats in the order that decides between equal probes: formats with strong signatures first, generic
// JSON lines last, as the fallback for sources that no probe recognizes. Formats with options, such as the CSV
// delimiter, are built with the run's settings.
import type { LogFormat } from '../api.js'
import { bunyanFormat } from './bunyan.js'
import { createCsvFormat } from './csv.js'
import { dockerFormat } from './docker.js'
import { jsonLinesFormat } from './json-lines.js'
import { logfmtFormat } from './logfmt.js'
import { pinoFormat } from './pino.js'
import { winstonFormat } from './winston.js'

export { jsonLinesFormat } from './json-lines.js'

interface BuiltInOptions {
  readonly csvDelimiter?: string | undefined
}

const builtInFormats = (options: BuiltInOptions = {}): readonly LogFormat[] => [
  dockerFormat,
  bunyanFormat,
  pinoFormat,
  logfmtFormat,
  createCsvFormat(options.csvDelimiter === undefined ? {} : { delimiter: options.csvDelimiter }),
  winstonFormat,
  jsonLinesFormat
]

// The identifiers that --format takes besides auto.
const builtInFormatIdentifiers: readonly string[] = builtInFormats().map(format => format.identifier)

export { builtInFormatIdentifiers, builtInFormats }
export type { BuiltInOptions }
