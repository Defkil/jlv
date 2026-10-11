// The plugin of a third-party author (plan section 8, phase 6): packages/format-fixtures/fixtures/plugin-author
// compiles with strict settings and skipLibCheck off against the declarations that jlv publishes as 'jlv' and
// 'jlv/formats', through the exports of jlv's manifest, and then runs in jlv. The package is built into a temporary
// directory, with links to its runtime dependencies, so that nothing in the repository changes.
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { builtInFormatIdentifiers } from '../src/formats/registry.js'
import { loadPlugins } from '../src/plugins.js'
import { readRecords } from './support/records.js'

// The repository, from the emitted test in .test-dist/packages/jlv/test.
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const packageDirectory = path.join(repository, 'packages', 'jlv')
const fixtureDirectory = path.join(repository, 'packages', 'format-fixtures', 'fixtures', 'plugin-author')

const directory = mkdtempSync(path.join(tmpdir(), 'jlv-plugin-author-'))
after(() => {
  rmSync(directory, { recursive: true, force: true })
})

const link = (target: string, name: string): void => {
  mkdirSync(path.dirname(name), { recursive: true })
  symlinkSync(realpathSync(target), name, 'junction')
}

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]): string => ts.formatDiagnostics(diagnostics, {
  getCanonicalFileName: name => name,
  getCurrentDirectory: () => directory,
  getNewLine: () => '\n'
})

// Compiles a TypeScript project and gives its diagnostics.
const compile = (configuration: string, overrides: ts.CompilerOptions = {}): readonly ts.Diagnostic[] => {
  const parsed = ts.getParsedCommandLineOfConfigFile(configuration, overrides, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => { assert.fail(formatDiagnostics([diagnostic])) }
  })
  assert.ok(parsed)
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
  const emitted = program.emit()
  return [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
}

interface Manifest {
  readonly type?: unknown
  readonly types?: unknown
  readonly exports?: unknown
  readonly dependencies?: Readonly<Record<string, string>>
}

// The package as it is published: jlv's manifest with its exports, the build of its sources, and its dependencies.
const buildPackage = (): string => {
  const target = path.join(directory, 'jlv')
  const diagnostics = compile(path.join(packageDirectory, 'tsconfig.build.json'), {
    outDir: path.join(target, 'dist'),
    sourceMap: false,
    inlineSources: false
  })
  assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics))
  const manifest = JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8')) as Manifest
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'jlv', type: manifest.type, types: manifest.types, exports: manifest.exports
  }))
  const dependencies = Object.keys(manifest.dependencies ?? {})
  for (const dependency of dependencies) {
    link(path.join(packageDirectory, 'node_modules', dependency), path.join(target, 'node_modules', dependency))
  }
  return target
}

// The author's project: the fixture's sources and settings, jlv installed, and Node's types.
const authorProject = (jlv: string, source: string): string => {
  const project = mkdtempSync(path.join(directory, 'author-'))
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ type: 'module', private: true }))
  copyFileSync(path.join(fixtureDirectory, 'tsconfig.json'), path.join(project, 'tsconfig.json'))
  writeFileSync(path.join(project, 'plugin.ts'), source)
  link(jlv, path.join(project, 'node_modules', 'jlv'))
  const nodeTypes = path.dirname(createRequire(path.join(repository, 'package.json')).resolve('@types/node/package.json'))
  link(nodeTypes, path.join(project, 'node_modules', '@types', 'node'))
  return project
}

describe('a plugin of a third-party author', () => {
  const source = readFileSync(path.join(fixtureDirectory, 'plugin.ts'), 'utf8')
  const jlv = buildPackage()

  it('compiles strictly against the published declarations and runs in jlv', async () => {
    const project = authorProject(jlv, source)
    const diagnostics = compile(path.join(project, 'tsconfig.json'))
    assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics))
    const [plugin] = await loadPlugins([path.join(project, 'dist', 'plugin.js')], {
      workingDirectory: project,
      reservedIdentifiers: new Set(['auto', ...builtInFormatIdentifiers])
    })
    assert.ok(plugin)
    const { records, diagnostics: readDiagnostics, format } = await readRecords(
      '{"sev":3,"text":"slow request","at":1791712800,"ms":1500}\n{"sev":2,"at":1791712801}\n', { formats: plugin.formats })
    assert.equal(format, 'acme')
    assert.deepEqual(records.map(({ record }) => [record.level, record.message, record.timestamp]), [
      ['warn', 'slow request', 1_791_712_800_000], ['info', '', 1_791_712_801_000]
    ])
    assert.deepEqual(readDiagnostics.map(diagnostic => [diagnostic.code, diagnostic.message]), [['acme-no-text', 'a record of test.log has no text']])
    const [slow, fast] = records
    assert.ok(slow && fast)
    assert.deepEqual([plugin.predicates['isSlow']?.(slow.record), plugin.predicates['isSlow']?.(fast.record)], [true, false])
  })

  it('fails to compile a plugin that breaks the contract', () => {
    const project = authorProject(jlv, source.replace(': \'unknown\',', ': \'loud\','))
    const diagnostics = compile(path.join(project, 'tsconfig.json'))
    assert.match(formatDiagnostics(diagnostics), /Type '"loud"' is not assignable to type 'LogLevel'/u)
  })
})
