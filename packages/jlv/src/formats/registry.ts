// The built-in formats in the order that decides between equal probes: formats with strong signatures first, generic
// JSON lines last, as the fallback for sources that no probe recognizes.
import type { LogFormat } from '../api.js'
import { jsonLinesFormat } from './json-lines.js'
import { pinoFormat } from './pino.js'

export { jsonLinesFormat } from './json-lines.js'

const builtInFormats = (): readonly LogFormat[] => [pinoFormat, jsonLinesFormat]

// The identifiers that --format takes besides auto.
const builtInFormatIdentifiers: readonly string[] = builtInFormats().map(format => format.identifier)

export { builtInFormatIdentifiers, builtInFormats }
