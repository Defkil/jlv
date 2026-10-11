// Plugins of src/plugins.ts (plan section 5): explicit loading of ES modules, CommonJS modules, compiled TypeScript and
// installed packages; apiVersion, identifier and predicate checks; checked output of a plugin's formats; and no plugin
// code without --plugin.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { after, describe, it } from 'node:test'
import { runApplication, type ApplicationOptions } from '../src/application.js'
import { builtInFormatIdentifiers, builtInFormats } from '../src/formats/registry.js'
import { loadPlugins, type LoadedPlugin } from '../src/plugins.js'
import { readRecords } from './support/records.js'

const directory = mkdtempSync(path.join(tmpdir(), 'jlv-plugins-'))
after(() => {
  rmSync(directory, { recursive: true, force: true })
})

const write = (name: string, text: string): string => {
  const file = path.join(directory, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

// A format of "key=value;key=value" lines with its level in "severity", as plugin source text.
const keyValueFormat = (identifier: string): string => String.raw`{
  identifier: ${JSON.stringify(identifier)},
  probe: sample => sample.text.includes(';') && sample.text.includes('=') ? 100 : 0,
  read: async function * (input) {
    let text = ''
    let line = 0
    for await (const chunk of input) {
      text += Buffer.from(chunk).toString('utf8')
    }
    for (const row of text.split('\n')) {
      line += 1
      if (row === '') continue
      yield { kind: 'entry', value: Object.fromEntries(row.split(';').map(pair => pair.split('='))), position: { firstLine: line, lastLine: line } }
    }
  },
  normalize: value => ({
    record: { level: value.severity === 'bad' ? 'loud' : (value.severity ?? 'unknown'), message: value.text ?? '', fields: value },
    diagnostics: []
  })
}`

write('key-value.mjs', `export default { apiVersion: 1, formats: [${keyValueFormat('keyvalue')}], predicates: { isLoud: record => record.message.endsWith('!') } }\n`)
const commonJs = write('key-value.cjs', `module.exports = { apiVersion: 1, formats: [${keyValueFormat('keyvalue-cjs')}] }\n`)
write('compiled.cjs', [
  '"use strict";',
  'Object.defineProperty(exports, "__esModule", { value: true });',
  `exports.default = { apiVersion: 1, formats: [${keyValueFormat('keyvalue-ts')}] };`,
  ''
].join('\n'))

const load = async (specifiers: readonly string[], workingDirectory = directory): Promise<LoadedPlugin[]> =>
  loadPlugins(specifiers, { workingDirectory, reservedIdentifiers: new Set(['auto', ...builtInFormatIdentifiers]) })

const loadError = async (specifiers: readonly string[], workingDirectory = directory): Promise<string> => {
  try {
    await load(specifiers, workingDirectory)
  } catch (error) {
    assert.ok(error instanceof Error && error.name === 'PluginError', String(error))
    return error.message
  }
  return assert.fail('no plugin error')
}

describe('loading plugins', () => {
  it('loads ES modules, CommonJS modules and compiled TypeScript by path, relative or absolute', async () => {
    const plugins = await load(['./key-value.mjs', commonJs, 'compiled.cjs'])
    assert.deepEqual(plugins.map(plugin => [plugin.specifier, plugin.formats.map(format => format.identifier)]), [
      ['./key-value.mjs', ['keyvalue']], [commonJs, ['keyvalue-cjs']], ['compiled.cjs', ['keyvalue-ts']]
    ])
    assert.deepEqual(Object.keys(plugins[0]?.predicates ?? {}), ['isLoud'])
  })

  it('resolves an installed package from the working directory', async () => {
    const project = path.join(directory, 'project')
    write('project/node_modules/jlv-plugin-sample/package.json', JSON.stringify({ name: 'jlv-plugin-sample', main: 'index.cjs' }))
    write('project/node_modules/jlv-plugin-sample/index.cjs', `module.exports = { apiVersion: 1, formats: [${keyValueFormat('sample')}] }\n`)
    const [plugin] = await load(['jlv-plugin-sample'], project)
    assert.deepEqual(plugin?.formats.map(format => format.identifier), ['sample'])
    assert.match(await loadError(['jlv-plugin-missing'], project), /^cannot load the plugin jlv-plugin-missing: no file of that name, and no package that /u)
  })

  it('refuses URLs, missing files, other versions and modules without a plugin', async () => {
    assert.equal(await loadError(['https://example.invalid/plugin.mjs']), 'cannot load the plugin https://example.invalid/plugin.mjs: plugins are files or installed packages, not URLs')
    assert.equal(await loadError(['data:text/javascript,export default 1']), 'cannot load the plugin data:text/javascript,export default 1: plugins are files or installed packages, not URLs')
    assert.equal(await loadError(['./missing.mjs']), 'cannot load the plugin ./missing.mjs: no such file')
    write('version-2.mjs', `export default { apiVersion: 2, formats: [${keyValueFormat('v2')}] }\n`)
    assert.equal(await loadError(['./version-2.mjs']), 'cannot load the plugin ./version-2.mjs: it has the apiVersion 2, and this jlv takes plugins of apiVersion 1')
    write('no-default.mjs', 'export const plugin = {}\n')
    assert.equal(await loadError(['./no-default.mjs']), 'cannot load the plugin ./no-default.mjs: its module has no plugin object as its default export')
    write('no-read.mjs', 'export default { apiVersion: 1, formats: [{ identifier: "half", probe: () => 0, normalize: () => ({}) }] }\n')
    assert.equal(await loadError(['./no-read.mjs']), 'cannot load the plugin ./no-read.mjs: its format half has no function read')
    write('bad-predicate.mjs', 'export default { apiVersion: 1, formats: [], predicates: { yes: true } }\n')
    assert.equal(await loadError(['./bad-predicate.mjs']), 'cannot load the plugin ./bad-predicate.mjs: its predicate yes is no function')
    write('throws.mjs', 'throw new Error("broken at import")\n')
    assert.equal(await loadError(['./throws.mjs']), 'cannot load the plugin ./throws.mjs: broken at import')
  })

  it('refuses identifiers of built-in formats and of other plugins, and repeated predicate names', async () => {
    write('pino.mjs', `export default { apiVersion: 1, formats: [${keyValueFormat('pino')}] }\n`)
    assert.equal(await loadError(['./pino.mjs']), 'cannot load the plugin ./pino.mjs: its format pino has the identifier of a built-in format')
    write('auto.mjs', `export default { apiVersion: 1, formats: [${keyValueFormat('auto')}] }\n`)
    assert.match(await loadError(['./auto.mjs']), /its format auto has the identifier of a built-in format$/u)
    write('again.mjs', `export default { apiVersion: 1, formats: [${keyValueFormat('keyvalue')}] }\n`)
    assert.equal(await loadError(['./key-value.mjs', './again.mjs']), 'cannot load the plugin ./again.mjs: its format keyvalue has the identifier of the plugin ./key-value.mjs')
    write('loud.mjs', 'export default { apiVersion: 1, formats: [], predicates: { isLoud: () => true } }\n')
    assert.equal(await loadError(['./key-value.mjs', './loud.mjs']), 'cannot load the plugin ./loud.mjs: its predicate isLoud has the name of a predicate of the plugin ./key-value.mjs')
  })
})

describe('the formats of plugins', () => {
  it('read and normalize records, and probe after the built-in formats', async () => {
    const [plugin] = await load(['./key-value.mjs'])
    assert.ok(plugin)
    const formats = [...builtInFormats(), ...plugin.formats]
    const { records, format } = await readRecords('severity=warn;text=from a plugin\n', { formats })
    assert.equal(format, 'keyvalue')
    assert.deepEqual(records.map(({ record }) => [record.level, record.message, record.identifier]), [['warn', 'from a plugin', '1:1']])
    assert.equal(plugin.predicates['isLoud']?.(records[0]?.record ?? assert.fail('no record')), false)
  })

  it('lose the records of output that does not fit, with a diagnostic that names the plugin', async () => {
    const [plugin] = await load(['./key-value.mjs'])
    assert.ok(plugin)
    const { records, diagnostics } = await readRecords('severity=bad;text=loud\nseverity=info;text=fine\n', { formats: plugin.formats })
    assert.deepEqual(records.map(({ record }) => record.message), ['fine'])
    assert.deepEqual(diagnostics.map(diagnostic => [diagnostic.code, diagnostic.position?.firstLine, diagnostic.message]), [[
      'normalize-failure', 1,
      'skipped a record that keyvalue cannot normalize: the format keyvalue of the plugin ./key-value.mjs gave a level other than trace, debug, info, warn, error, fatal and unknown'
    ]])
    write('bad-events.mjs', `export default { apiVersion: 1, formats: [{
      identifier: 'bad-events', probe: () => 'high',
      read: async function * () { yield { kind: 'entry', value: [1], position: { firstLine: 1, lastLine: 1 } }; yield { kind: 'other' } },
      normalize: value => ({ record: { level: 'info', message: '', fields: value }, diagnostics: [] })
    }] }\n`)
    const [bad] = await load(['./bad-events.mjs'])
    assert.ok(bad)
    const events = await readRecords('anything\n', { formats: bad.formats })
    assert.equal(events.format, 'jsonl')
    assert.deepEqual(events.diagnostics.map(diagnostic => diagnostic.code), ['probe-failure', 'invalid-json'])
    const [badFormat] = bad.formats
    assert.ok(badFormat)
    const forced = await readRecords('anything\n', { formats: bad.formats, format: badFormat })
    assert.deepEqual(forced.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message]), [
      ['plugin-output', 'the format bad-events of the plugin ./bad-events.mjs gave an entry whose value is no JSON object'],
      ['plugin-output', 'the format bad-events of the plugin ./bad-events.mjs gave neither an entry nor a diagnostic']
    ])
  })
})

class TextOutput extends Writable {
  text = ''

  override _write (chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString('utf8')
    callback()
  }
}

const run = async (options: Partial<ApplicationOptions>): Promise<{ readonly code: number, readonly output: string, readonly errors: string }> => {
  const stdout = new TextOutput()
  const stderr = new TextOutput()
  const code = await runApplication({
    inputs: ['records.log'],
    isFollowing: false,
    sort: undefined,
    level: undefined,
    where: [],
    profile: undefined,
    predicates: [],
    output: 'plain',
    format: undefined,
    timestampUnit: undefined,
    isStrict: false,
    configuration: undefined,
    isConfigurationDisabled: true,
    plugins: [],
    maximumRecords: undefined,
    maximumBytes: undefined,
    save: undefined,
    isOverwriting: false,
    debugLog: undefined,
    ...options
  }, {
    stdin: new PassThrough(),
    stdout,
    stderr,
    workingDirectory: directory,
    home: directory,
    platform: process.platform,
    // eslint-disable-next-line unicorn/prefer-event-target -- the application listens to process, which is an EventEmitter
    signals: new EventEmitter(),
    openKeyboard: () => {
      // No keyboard: the output is plain text.
    }
  })
  return { code, output: stdout.text, errors: stderr.text }
}

describe('plugins in a run', () => {
  write('records.log', 'severity=error;text=through the plugin\n')

  it('run only with --plugin, and give their formats to --format', async () => {
    const marker = path.join(directory, 'marker.txt')
    write('marker.mjs', `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(marker)}, 'ran')\nexport default { apiVersion: 1, formats: [] }\n`)
    const without = await run({})
    assert.equal(without.code, 1)
    assert.equal(existsSync(marker), false)
    const loaded = await run({ plugins: ['./key-value.mjs', './marker.mjs'], format: 'keyvalue' })
    assert.deepEqual([loaded.code, loaded.output, loaded.errors], [0, '- error through the plugin {"severity":"error","text":"through the plugin"}\n', ''])
    assert.equal(existsSync(marker), true)
  })

  it('end with 1 when a plugin cannot be loaded', async () => {
    const failed = await run({ plugins: ['./version-2.mjs'] })
    assert.deepEqual([failed.code, failed.errors], [1, 'jlv: cannot load the plugin ./version-2.mjs: it has the apiVersion 2, and this jlv takes plugins of apiVersion 1\n'])
  })
})
