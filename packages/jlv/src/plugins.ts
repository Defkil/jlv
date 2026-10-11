// Plugins (plan section 5): formats and predicates from modules that the user names with --plugin, and from nowhere
// else. jlv never discovers, installs or downloads code, and a configuration file cannot name a plugin. A plugin is
// trusted code that runs in jlv's own process; jlv checks its shape, but it is no sandbox.
//
// A file that exists, relative to the working directory or absolute, is imported through its file URL; any other
// name is a package that require.resolve finds from the working directory. URLs are refused. The plugin object is the
// module's default export: export default of an ES module, module.exports of a CommonJS module, or exports.default of
// compiled TypeScript.
//
// jlv checks the plugin when it loads it: apiVersion 1, formats with identifiers that no other format has and the
// functions probe, read and normalize, and predicates as functions. At runtime it checks every probe score, parse event
// and normalization result of a plugin's format; output that does not fit costs that record, with a diagnostic that
// names the plugin.
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LinePosition, LogFormat, NormalizationResult, ParseEvent, RecordPredicate } from './api.js'
import { isLogLevel, isPlainObject, jsonProblem } from './record.js'

// A plugin that cannot be loaded; the command line ends with exit code 1.
class PluginError extends Error {
  constructor (message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PluginError'
  }
}

interface LoadedPlugin {
  // The --plugin argument, as given.
  readonly specifier: string
  readonly formats: readonly LogFormat[]
  readonly predicates: Readonly<Record<string, RecordPredicate>>
}

interface PluginOptions {
  readonly workingDirectory: string
  // Identifiers that plugin formats must not take: the built-in formats' and auto.
  readonly reservedIdentifiers: ReadonlySet<string>
}

type Indexed = Readonly<Record<PropertyKey, unknown>>

type Callable = (...parameters: unknown[]) => unknown

const isIndexed = (value: unknown): value is Indexed =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'

const isCallable = (value: unknown): value is Callable => typeof value === 'function'

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

// A URL such as https:, data:, file: or node:, but not a Windows drive letter.
const urlPattern = /^[a-z][\d+.a-z-]+:/i
const pathPattern = /^(?:\.{1,2}(?:[/\\]|$)|[/\\]|[a-z]:)/i

// The URL to import for a --plugin argument.
const pluginUrl = (specifier: string, workingDirectory: string): string => {
  if (urlPattern.test(specifier)) {
    throw new PluginError(`cannot load the plugin ${specifier}: plugins are files or installed packages, not URLs`)
  }
  const file = path.resolve(workingDirectory, specifier)
  if (statSync(file, { throwIfNoEntry: false })?.isFile() === true) {
    return pathToFileURL(file).href
  }
  if (pathPattern.test(specifier)) {
    throw new PluginError(`cannot load the plugin ${specifier}: no such file`)
  }
  try {
    const resolved = createRequire(path.join(workingDirectory, 'jlv-plugin-resolution.cjs')).resolve(specifier)
    return pathToFileURL(resolved).href
  } catch (error) {
    throw new PluginError(`cannot load the plugin ${specifier}: no file of that name, and no package that ${workingDirectory} can resolve`, { cause: error })
  }
}

// The plugin object of a module: its default export, or the default export of compiled TypeScript inside it.
const pluginObject = (namespace: unknown): unknown => {
  const exported = isIndexed(namespace) ? namespace['default'] : undefined
  return isIndexed(exported) && !('apiVersion' in exported) && 'default' in exported ? exported['default'] : exported
}

const isLinePosition = (value: unknown): value is LinePosition =>
  isIndexed(value) &&
  Number.isSafeInteger(value['firstLine']) && Number.isSafeInteger(value['lastLine']) &&
  Number(value['firstLine']) >= 1 && Number(value['lastLine']) >= Number(value['firstLine'])

// What is wrong with a diagnostic of a plugin, or undefined.
const diagnosticProblem = (value: Indexed): string | undefined => {
  if (value['severity'] !== 'warning' && value['severity'] !== 'error') {
    return 'a diagnostic whose severity is neither warning nor error'
  }
  if (typeof value['code'] !== 'string' || value['code'] === '' || typeof value['message'] !== 'string') {
    return 'a diagnostic without a code or a message'
  }
  return value['position'] === undefined || isLinePosition(value['position']) ? undefined : 'a diagnostic with an invalid position'
}

// What is wrong with a parse event of a plugin, or undefined.
const eventProblem = (event: unknown): string | undefined => {
  if (!isIndexed(event)) {
    return 'no object'
  }
  if (event['kind'] === 'diagnostic') {
    return diagnosticProblem(event)
  }
  if (event['kind'] !== 'entry') {
    return 'neither an entry nor a diagnostic'
  }
  if (!isPlainObject(event['value']) || jsonProblem(event['value']) !== undefined) {
    return 'an entry whose value is no JSON object'
  }
  return isLinePosition(event['position']) ? undefined : 'an entry without a valid position'
}

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  isIndexed(value) && typeof value[Symbol.asyncIterator] === 'function'

// A plugin's events, each checked; an event that does not fit becomes an error diagnostic.
async function * checkedEvents (events: unknown, owner: string): AsyncGenerator<ParseEvent> {
  if (!isAsyncIterable(events)) {
    throw new Error(`${owner} gave no async iterable from read`)
  }
  for await (const event of events) {
    const problem = eventProblem(event)
    yield problem === undefined
      ? event as ParseEvent
      : { kind: 'diagnostic', severity: 'error', code: 'plugin-output', message: `${owner} gave ${problem}` }
  }
}

// What is wrong with a normalization result of a plugin, or undefined.
const resultProblem = (result: unknown): string | undefined => {
  if (!isIndexed(result) || !isIndexed(result['record'])) {
    return 'no result with a record'
  }
  const record = result['record']
  const timestamp = record['timestamp']
  const correlation = record['correlationIdentifier']
  const diagnostics = result['diagnostics']
  const problems: readonly [boolean, string][] = [
    [!isLogLevel(record['level']), 'a level other than trace, debug, info, warn, error, fatal and unknown'],
    [typeof record['message'] !== 'string', 'a message that is no text'],
    [!isPlainObject(record['fields']) || jsonProblem(record['fields']) !== undefined, 'fields that are no JSON object'],
    [timestamp !== undefined && !(typeof timestamp === 'number' && Math.abs(timestamp) <= 8.64e15), 'a timestamp that is no time'],
    [record['timestampText'] !== undefined && typeof record['timestampText'] !== 'string', 'a timestamp text that is no text'],
    [correlation !== undefined && (typeof correlation !== 'string' || correlation === ''), 'a correlation identifier that is no text'],
    [!Array.isArray(diagnostics) || diagnostics.some(diagnostic => !isIndexed(diagnostic) || diagnosticProblem(diagnostic) !== undefined),
      'diagnostics that are no list of diagnostics']
  ]
  return problems.find(([isProblem]) => isProblem)?.[1]
}

// The functions of a plugin's format, which are called with the format as this.
interface FormatFunctions {
  readonly probe: Callable
  readonly read: Callable
  readonly normalize: Callable
}

// A plugin's format whose output jlv checks.
const checkedFormat = (format: Indexed, identifier: string, functions: FormatFunctions, specifier: string): LogFormat => {
  const owner = `the format ${identifier} of the plugin ${specifier}`
  return {
    identifier,
    probe: (sample, context) => {
      const score = Reflect.apply(functions.probe, format, [sample, context])
      if (typeof score !== 'number' || Number.isNaN(score)) {
        throw new TypeError(`${owner} gave the probe score ${String(score)}, not a number`)
      }
      return score
    },
    read: (input, context) => checkedEvents(Reflect.apply(functions.read, format, [input, context]), owner),
    normalize: (value, context) => {
      const result = Reflect.apply(functions.normalize, format, [value, context])
      const problem = resultProblem(result)
      if (problem !== undefined) {
        throw new TypeError(`${owner} gave ${problem}`)
      }
      return result as NormalizationResult
    }
  }
}

// The checked formats and predicates of a plugin object.
const validatePlugin = (plugin: unknown, specifier: string): LoadedPlugin => {
  const fail = (message: string): never => {
    throw new PluginError(`cannot load the plugin ${specifier}: ${message}`)
  }
  if (!isIndexed(plugin)) {
    return fail('its module has no plugin object as its default export')
  }
  const version = plugin['apiVersion']
  if (version !== 1) {
    const found = version === undefined ? 'no apiVersion' : `the apiVersion ${JSON.stringify(version)}`
    return fail(`it has ${found}, and this jlv takes plugins of apiVersion 1`)
  }
  const formats = plugin['formats']
  if (!Array.isArray(formats)) {
    return fail('it has no list of formats')
  }
  const checked = formats.map((format: unknown, index): LogFormat => {
    if (!isIndexed(format) || typeof format['identifier'] !== 'string' || format['identifier'] === '') {
      return fail(`its format ${String(index + 1)} has no identifier`)
    }
    const identifier = format['identifier']
    const functionOf = (name: string): Callable => {
      const value = format[name]
      return isCallable(value) ? value : fail(`its format ${identifier} has no function ${name}`)
    }
    const functions = { probe: functionOf('probe'), read: functionOf('read'), normalize: functionOf('normalize') }
    return checkedFormat(format, identifier, functions, specifier)
  })
  const predicates = plugin['predicates'] ?? {}
  if (!isIndexed(predicates)) {
    return fail('its predicates are no object')
  }
  const checkedPredicates = Object.fromEntries(Object.entries(predicates).map(([name, predicate]): [string, RecordPredicate] => {
    const callable = isCallable(predicate) ? predicate : fail(`its predicate ${name} is no function`)
    // fromEntries defines own properties, including a predicate named __proto__.
    return [name, record => {
      const result = Reflect.apply(callable, predicates, [record])
      if (typeof result !== 'boolean') {
        if (isIndexed(result) && isCallable(result['then'])) {
          // Predicates are synchronous. Observe a mistakenly returned promise so its rejection cannot escape.
          // eslint-disable-next-line unicorn/prefer-await -- a synchronous predicate cannot await its invalid asynchronous output
          Promise.resolve(result).catch(() => {})
        }
        throw new TypeError(`the predicate ${name} of the plugin ${specifier} gave no boolean; predicates must return true or false synchronously`)
      }
      return result
    }]
  }))
  return { specifier, formats: checked, predicates: checkedPredicates }
}

// Loads the plugins in their order. Identifiers of formats and names of predicates must be unique among the built-in
// formats and all plugins.
const loadPlugins = async (specifiers: readonly string[], options: PluginOptions): Promise<LoadedPlugin[]> => {
  const plugins: LoadedPlugin[] = []
  const owners = new Map<string, string>([...options.reservedIdentifiers].map(identifier => [identifier, 'a built-in format']))
  const predicateOwners = new Map<string, string>()
  for (const specifier of specifiers) {
    const url = pluginUrl(specifier, options.workingDirectory)
    let namespace: unknown
    try {
      namespace = await import(url)
    } catch (error) {
      throw new PluginError(`cannot load the plugin ${specifier}: ${errorMessage(error)}`, { cause: error })
    }
    const plugin = validatePlugin(pluginObject(namespace), specifier)
    for (const { identifier } of plugin.formats) {
      const owner = owners.get(identifier)
      if (owner !== undefined) {
        throw new PluginError(`cannot load the plugin ${specifier}: its format ${identifier} has the identifier of ${owner}`)
      }
      owners.set(identifier, `the plugin ${specifier}`)
    }
    for (const name of Object.keys(plugin.predicates)) {
      const owner = predicateOwners.get(name)
      if (owner !== undefined) {
        throw new PluginError(`cannot load the plugin ${specifier}: its predicate ${name} has the name of a predicate of ${owner}`)
      }
      predicateOwners.set(name, `the plugin ${specifier}`)
    }
    plugins.push(plugin)
  }
  return plugins
}

export { PluginError, loadPlugins }
export type { LoadedPlugin, PluginOptions }
