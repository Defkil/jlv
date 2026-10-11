// The built-in formats of jlv, exported as 'jlv/formats' (plan sections 4.1 and 6.2), for plugins that wrap or
// combine them, and the JSON-lines reader that JSON profiles share. Importing this module has no effects.
//
// A plugin can, for example, reuse the reader with its own probe and normalization:
//
//   import type { FormatPlugin } from 'jlv'
//   import { readJsonLines } from 'jlv/formats'
//   const plugin: FormatPlugin = { apiVersion: 1, formats: [{ identifier: 'acme', probe, read: readJsonLines, normalize }] }
export { bunyanFormat } from './bunyan.js'
export { createCsvFormat, csvFormat } from './csv.js'
export type { CsvOptions } from './csv.js'
export { dockerFormat } from './docker.js'
export { jsonLinesFormat, readJsonLines } from './json-lines.js'
export { logfmtFormat } from './logfmt.js'
export { pinoFormat } from './pino.js'
export { builtInFormats } from './registry.js'
export type { BuiltInOptions } from './registry.js'
export { winstonFormat } from './winston.js'
