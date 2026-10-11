// Checks the npm tarball of jlv as its users get it (plan section 9.2).
//
// The static part reads the tarball itself: exactly the expected files, the manifest of the release, the shebang of the
// command and the public declarations, which must not reach blessed or any other package that a consumer does not get.
// The installed part puts the tarball into an empty project outside the workspace, with its production dependencies
// only and lifecycle scripts disabled, and runs what users run: the jlv command on pino, bunyan, CSV, a glob and standard
// input with its exit codes and an untouched home directory, a strict TypeScript consumer of 'jlv' and 'jlv/formats'
// with skipLibCheck off, and plugins compiled as an ECMAScript and as a CommonJS module. npm audit reviews the
// production dependencies, and no installed package may need an install script or native code.
//
// Usage: node .test-dist/scripts/check-package.js [--tarball <file>] [--pack-destination <directory>] [--keep]
//   without --tarball    packs packages/jlv with npm pack; run pnpm run build first
//   --tarball <file>     checks a tarball packed before, such as the CI artifact on another Node version
//   --pack-destination   packs into this directory and keeps the tarball there, for the publish workflow
//   --keep               keeps the temporary project for a closer look
// The install and the audit need the npm registry. Exit code 0 means that every check passed. In GitHub Actions, the
// tarball's path, name, version and SHA-256 become outputs of the step.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import ts from 'typescript'

// The workspace root: the nearest directory above this script with pnpm-workspace.yaml, from the emitted script in
// .test-dist/scripts as from the source in scripts.
const findRepository = (start: string): string => {
  let directory = start
  while (!existsSync(path.join(directory, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(directory)
    if (parent === directory) {
      throw new Error(`No pnpm workspace contains ${start}.`)
    }
    directory = parent
  }
  return directory
}

const repository = findRepository(import.meta.dirname)
const packageDirectory = path.join(repository, 'packages', 'jlv')
const examples = path.join(repository, 'docs', 'examples')
const fixtures = path.join(repository, 'packages', 'format-fixtures', 'fixtures')
const isWindows = process.platform === 'win32'

const { values: options } = parseArgs({
  options: {
    tarball: { type: 'string' },
    'pack-destination': { type: 'string' },
    keep: { type: 'boolean' }
  }
})

// Problems are collected, so that one run reports all of them.
const problems: string[] = []

const check = (isPassing: boolean, description: string, detail = ''): void => {
  if (isPassing) {
    process.stdout.write(`  ok    ${description}\n`)
  } else {
    problems.push(detail === '' ? description : `${description}\n${detail}`)
    const indented = detail.replaceAll(/^/gmu, ' '.repeat(8))
    process.stdout.write(`  FAIL  ${description}${detail === '' ? '' : `\n${indented}`}\n`)
  }
}

const section = (title: string): void => {
  process.stdout.write(`\n${title}\n`)
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

type Indexed = Readonly<Record<string, unknown>>

const isIndexed = (value: unknown): value is Indexed => typeof value === 'object' && value !== null && !Array.isArray(value)

const property = (value: unknown, key: string): unknown => isIndexed(value) ? value[key] : undefined

interface Completed {
  readonly code: number | undefined
  readonly output: string
  readonly errors: string
}

interface RunOptions {
  readonly cwd: string
  readonly input?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly timeout?: number
  readonly isVerbatim?: boolean
}

// Runs a program without a shell and collects its output; a program that outlives its timeout is killed and fails.
const run = async (command: string, parameters: readonly string[], runOptions: RunOptions): Promise<Completed> => {
  const child = spawn(command, parameters, {
    cwd: runOptions.cwd,
    env: runOptions.environment ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: runOptions.isVerbatim === true
  })
  let output = ''
  let errors = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errors += chunk })
  child.stdin.end(runOptions.input ?? '')
  const timer = setTimeout(() => { child.kill() }, runOptions.timeout ?? 60_000)
  // A process that a signal ended, or that never started, has no exit code.
  const code = await new Promise<number | undefined>(resolve => {
    child.on('error', error => {
      errors += `${error.message}\n`
      resolve(undefined)
    })
    child.on('close', exitCode => { resolve(exitCode ?? undefined) })
  })
  clearTimeout(timer)
  return { code, output, errors }
}

// npm.cmd needs a shell on Windows; its JavaScript entry point runs with this Node instead, so that no argument passes
// through a shell. Elsewhere npm is a plain executable.
const npmInvocation = (parameters: readonly string[]): { readonly command: string, readonly parameters: readonly string[] } => {
  if (!isWindows) {
    return { command: 'npm', parameters }
  }
  const directories = (process.env['PATH'] ?? '').split(path.delimiter)
  for (const directory of directories) {
    const base = directory.replaceAll('"', '')
    const entry = path.join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (base !== '' && existsSync(path.join(base, 'npm.cmd')) && existsSync(entry)) {
      return { command: process.execPath, parameters: [entry, ...parameters] }
    }
  }
  throw new Error('No npm.cmd with its npm-cli.js on the PATH.')
}

const npm = async (parameters: readonly string[], runOptions: RunOptions): Promise<Completed> => {
  const invocation = npmInvocation(parameters)
  return run(invocation.command, invocation.parameters, runOptions)
}

interface TarEntry {
  readonly path: string
  readonly type: string
  readonly content: Buffer
}

// The entries of a gzipped tar archive in the ustar form that npm writes, with pax headers for long names.
const readTarball = (file: string): TarEntry[] => {
  const archive = gunzipSync(readFileSync(file))
  const entries: TarEntry[] = []
  let offset = 0
  let extendedPath: string | undefined
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      break
    }
    const field = (start: number, length: number): string => {
      const bytes = header.subarray(start, start + length)
      const end = bytes.indexOf(0)
      return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8')
    }
    const size = Number.parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1) || '0'
    const prefix = field(345, 155)
    const name = prefix === '' ? field(0, 100) : `${prefix}/${field(0, 100)}`
    const content = Buffer.from(archive.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {
      extendedPath = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(content.toString('utf8'))?.[1]
      continue
    }
    entries.push({ path: extendedPath ?? name, type, content })
    extendedPath = undefined
  }
  return entries
}

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

// The tarball to check: the one given, or a new one packed from packages/jlv.
const obtainTarball = async (temporary: string): Promise<string> => {
  if (options.tarball !== undefined) {
    return path.resolve(options.tarball)
  }
  if (!existsSync(path.join(packageDirectory, 'dist', 'cli.js'))) {
    throw new Error('packages/jlv/dist is missing; run pnpm run build first.')
  }
  const destination = path.resolve(options['pack-destination'] ?? path.join(temporary, 'pack'))
  mkdirSync(destination, { recursive: true })
  const packed = await npm(['pack', '--json', '--pack-destination', destination], { cwd: packageDirectory, timeout: 120_000 })
  const report: unknown = packed.code === 0 ? JSON.parse(packed.output) : undefined
  // npm 11 reports a list of packages, npm 12 an object with a key per package.
  const result: unknown = Array.isArray(report) ? report[0] : property(report, 'jlv')
  const fileName = property(result, 'filename')
  if (typeof fileName === 'string') {
    return path.join(destination, fileName)
  }
  throw new Error(`npm pack failed with ${String(packed.code)}:\n${packed.errors}`)
}

const byText = (left: string, right: string): number => left.localeCompare(right)

// The files that the build of src/ makes, with the manifest, the readme, the license and the notices.
const expectedFiles = (): string[] => {
  const source = path.join(packageDirectory, 'src')
  const modules = readdirSync(source, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
    .map(entry => path.relative(source, path.join(entry.parentPath, entry.name)).split(path.sep).join('/').replace(/\.ts$/u, ''))
  const built = modules.flatMap(module => [`dist/${module}.js`, `dist/${module}.js.map`, `dist/${module}.d.ts`])
  return ['package.json', 'README.md', 'LICENSE', 'NOTICE.md', ...built].toSorted(byText)
}

const expectedManifest: Readonly<Record<string, unknown>> = {
  name: 'jlv',
  type: 'module',
  license: 'MIT',
  engines: { node: '>=22.9.0' },
  bin: { jlv: './dist/cli.js' },
  types: './dist/api.d.ts',
  exports: {
    '.': { types: './dist/api.d.ts', default: './dist/api.js' },
    './formats': { types: './dist/formats/index.d.ts', default: './dist/formats/index.js' }
  },
  repository: { type: 'git', url: 'git+https://github.com/Defkil/jlv.git', directory: 'packages/jlv' },
  files: ['dist/', 'README.md', 'LICENSE', 'NOTICE.md'],
  publishConfig: { access: 'public', provenance: true }
}

// The declaration files that 'jlv' and 'jlv/formats' reach, with the modules they import that are no files of the
// package.
const publicDeclarations = (files: ReadonlyMap<string, Buffer>): { readonly reached: string[], readonly external: string[] } => {
  const pending = ['dist/api.d.ts', 'dist/formats/index.d.ts']
  const reached = new Set<string>()
  const external = new Set<string>()
  const specifiers = /(?:\bfrom\s+|\bimport\s*\(\s*|<reference\s+types=)["']([^"']+)["']/gu
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (reached.has(file)) {
      continue
    }
    reached.add(file)
    const imports = (files.get(file)?.toString('utf8') ?? '').matchAll(specifiers)
    for (const [, specifier = ''] of imports) {
      if (specifier.startsWith('.')) {
        pending.push(path.posix.join(path.posix.dirname(file), specifier.replace(/\.js$/u, '.d.ts')))
      } else {
        external.add(specifier)
      }
    }
  }
  return { reached: reached.values().toArray().toSorted(byText), external: external.values().toArray().toSorted(byText) }
}

const checkTarball = (tarball: string): Indexed => {
  section(`Tarball ${path.basename(tarball)}`)
  const entries = readTarball(tarball)
  const files = new Map(entries.filter(entry => entry.type === '0').map(entry => [entry.path.replace(/^package\//u, ''), entry.content]))
  const size = statSync(tarball).size
  process.stdout.write(`  ${String(size)} bytes, ${String(files.size)} files, SHA-256 ${sha256(tarball)}\n`)
  const present = files.keys().toArray().toSorted(byText)
  for (const name of present) {
    process.stdout.write(`        ${String(files.get(name)?.length).padStart(7)}  ${name}\n`)
  }
  check(entries.every(entry => entry.path.startsWith('package/') && !entry.path.split('/').includes('..')),
    'every entry lies below package/')
  check(entries.every(entry => entry.type === '0' || entry.type === '5'), 'the tarball holds only files and directories')
  const expected = expectedFiles()
  const missing = expected.filter(file => !files.has(file))
  const unexpected = present.filter(file => !expected.includes(file))
  check(missing.length === 0 && unexpected.length === 0, `exactly the ${String(expected.length)} files of the build, the manifest, the readme, the license and the notices`,
    [...missing.map(file => `missing: ${file}`), ...unexpected.map(file => `unexpected: ${file}`)].join('\n'))

  const manifest: unknown = JSON.parse(files.get('package.json')?.toString('utf8') ?? 'null')
  const sourceManifest = readJson(path.join(packageDirectory, 'package.json'))
  check(isDeepStrictEqual(manifest, sourceManifest), 'the manifest is that of packages/jlv')
  for (const [key, value] of Object.entries(expectedManifest)) {
    check(isDeepStrictEqual(property(manifest, key), value), `the manifest's ${key} is ${JSON.stringify(value)}`,
      `found ${JSON.stringify(property(manifest, key))}`)
  }
  const version = property(manifest, 'version')
  check(typeof version === 'string' && /^\d+\.\d+\.\d+$/u.test(version), `the version ${String(version)} is a stable release version`)
  check(property(manifest, 'private') === undefined && property(manifest, 'scripts') === undefined,
    'the manifest is not private and has no scripts, so installing it runs nothing')
  const dependencies = property(manifest, 'dependencies')
  const dependencyEntries = isIndexed(dependencies) ? Object.entries(dependencies) : []
  check(dependencyEntries.length > 0 && dependencyEntries.every(([, range]) => typeof range === 'string' && /^\d+\.\d+\.\d+$/u.test(range)),
    'every runtime dependency is pinned to a registry version, without workspace:, file:, link: or Git sources',
    JSON.stringify(dependencies))
  check(['bundleDependencies', 'bundledDependencies', 'optionalDependencies', 'peerDependencies'].every(key => property(manifest, key) === undefined),
    'no bundled, optional or peer dependencies')
  for (const workspaceManifest of ['package.json', 'packages/format-fixtures/package.json']) {
    const workspace = readJson(path.join(repository, workspaceManifest))
    check(property(workspace, 'private') === true, `${workspaceManifest} stays private`)
  }

  const command = files.get('dist/cli.js')?.toString('utf8') ?? ''
  check(command.startsWith('#!/usr/bin/env node\n'), 'dist/cli.js starts with the node shebang')
  const license = files.get('LICENSE')?.toString('utf8') ?? ''
  check(license.startsWith('MIT License') && license.includes('Oliver Grüttner') && license.includes('Felipe Coury and json-log-viewer contributors'),
    'LICENSE is the MIT license with both copyright lines')
  check((files.get('NOTICE.md')?.toString('utf8') ?? '').includes('json-log-viewer'), 'NOTICE.md credits json-log-viewer')
  const readme = (files.get('README.md')?.toString('utf8') ?? '').replaceAll(/\s+/gu, ' ')
  check(readme.includes('npm install --global jlv') && readme.includes('json-log-viewer') && readme.includes('Felipe Coury and contributors'),
    'README.md tells how to install jlv and credits json-log-viewer, Felipe Coury and contributors')
  const maps = [...files].filter(([name]) => name.endsWith('.js.map'))
  check(maps.every(([, content]) => !/(?:[A-Za-z]:\\\\|\/home\/|\/Users\/|\/tmp\/)/u.test(content.toString('utf8'))),
    'the source maps hold no paths of the machine that built them')

  const { reached, external } = publicDeclarations(files)
  check(reached.every(file => files.has(file)), `the public declarations are complete: ${reached.join(', ')}`)
  check(external.length === 0, 'the public declarations import nothing outside the package', external.join(', '))
  check(reached.every(file => !/blessed/u.test(files.get(file)?.toString('utf8') ?? '')), 'the public declarations do not mention blessed')
  return isIndexed(manifest) ? manifest : {}
}

// Expected output of the installed command; the documentation shows the same records.
const pinoLines = [
  '2026-10-11T10:00:00.000Z info server listening {"pid":4120,"hostname":"api-1","port":8080}',
  '2026-10-11T10:00:01.250Z warn slow request {"pid":4120,"hostname":"api-1","reqId":"req-7","responseTime":1840}',
  '2026-10-11T10:00:02.500Z error upstream failed {"pid":4120,"hostname":"api-1","reqId":"req-8","err":{"type":"Error","message":"connection refused"}}',
  '2026-10-11T10:00:03.000Z fatal shutting down {"pid":4120,"hostname":"api-1"}'
]
const bunyanLines = [
  '2026-10-11T10:00:00.000Z info hi {"name":"myapp","hostname":"banana.local","pid":40161,"v":0}',
  '2026-10-11T10:00:01.000Z warn au revoir {"name":"myapp","hostname":"banana.local","pid":40161,"lang":"fr","v":0}',
  String.raw`2026-10-11T10:00:02.000Z error boom {"name":"myapp","hostname":"banana.local","pid":40161,"err":{"message":"boom","name":"Error","stack":"Error: boom\n    at Object.<anonymous> (/srv/app.js:1:7)"},"v":0}`,
  '2026-10-11T10:00:03.123Z debug child logger {"name":"myapp","hostname":"banana.local","pid":40161,"component":"db","v":0}',
  '2026-10-11T10:00:04.000Z fatal fatal {"name":"myapp","hostname":"banana.local","pid":40161,"v":0}',
  '2026-10-11T10:00:05.000Z trace trace {"name":"myapp","hostname":"banana.local","pid":40161,"v":0}',
  '2026-10-11T10:00:06.000Z info request {"name":"myapp","hostname":"banana.local","pid":40161,"req_id":7,"v":0,"req":{"method":"GET","url":"/"}}'
]
const csvLines = [
  '2026-10-11T10:00:00.000Z info order placed {"order":"A-17"}',
  String.raw`2026-10-11T10:00:05.000Z error payment declined\ncard expired {"order":"A-17"}`
]
const fatalRecord = '{"identifier":"1:4","source":{"identifier":"1","label":"logs/pino.log","order":0},"position":{"recordNumber":4,"firstLine":4,"lastLine":4},"timestamp":1791712803000,"level":"fatal","message":"shutting down","fields":{"level":60,"time":1791712803000,"pid":4120,"hostname":"api-1","msg":"shutting down"}}'
const acmeLog = '{"sev":3,"text":"slow request","at":1791712800,"ms":1500}\n{"sev":2,"text":"fast request","at":1791712801,"ms":20}\n'
// The README's plugin reads no time and calls only severity 4 an error.
const readmePluginOutput = [
  '- info slow request {"sev":3,"text":"slow request","at":1791712800,"ms":1500}',
  '- info fast request {"sev":2,"text":"fast request","at":1791712801,"ms":20}',
  ''
].join('\n')

const lines = (text: string): string[] => text === '' ? [] : text.replace(/\n$/u, '').split('\n')

// A consumer of the installed package: types from 'jlv', values from 'jlv/formats', and a report of what importing
// them did to the process.
const consumerSource = String.raw`import { createRequire } from 'node:module'
import type { FormatContext, LogDraft, LogFormat, ParseEvent } from 'jlv'
import { builtInFormats, createCsvFormat, pinoFormat, readJsonLines } from 'jlv/formats'

const api: object = await import('jlv')
const context: FormatContext = {
  signal: new AbortController().signal,
  source: { identifier: '1', label: 'sample.log', order: 0 },
  maximumRecordSize: 1_048_576,
  mapping: {},
  levels: {}
}
const chunks = async function * (text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text)
}
const events: ParseEvent[] = []
for await (const event of readJsonLines(chunks('{"level":40,"time":1791712800000,"msg":"slow"}\n'), context)) {
  events.push(event)
}
const [event] = events
const draft: LogDraft | undefined = event?.kind === 'entry' ? pinoFormat.normalize(event.value, context).record : undefined
const formats: readonly LogFormat[] = builtInFormats()
const bunyan = '{"name":"api","hostname":"h","pid":1,"level":30,"msg":"hi","time":"2026-10-11T10:00:00.000Z","v":0}'
const scores = formats.map(format => [format.identifier, format.probe({ text: bunyan }, context)] as const)
const best = scores.reduce((winner, candidate) => candidate[1] > winner[1] ? candidate : winner)
const loaded = Object.keys(createRequire(import.meta.url).cache)
process.stdout.write(JSON.stringify({
  apiExports: Object.keys(api),
  formats: formats.map(format => format.identifier),
  csv: createCsvFormat({ delimiter: ';' }).identifier,
  record: draft === undefined ? undefined : [draft.level, draft.message, draft.timestamp],
  bunyanFormat: best[0],
  terminalLibraryLoaded: loaded.some(file => file.includes('neo-blessed')),
  signalListeners: process.listenerCount('SIGINT') + process.listenerCount('SIGTERM'),
  hasExitCode: process.exitCode !== undefined
}))
`

const expectedConsumerReport = {
  apiExports: [],
  formats: ['docker', 'bunyan', 'pino', 'logfmt', 'csv', 'winston', 'jsonl'],
  csv: 'csv',
  record: ['warn', 'slow', 1_791_712_800_000],
  bunyanFormat: 'bunyan',
  terminalLibraryLoaded: false,
  signalListeners: 0,
  hasExitCode: false
}

// A plugin as a CommonJS module: its types come from the ECMAScript package through a type-only import, and jlv loads
// its module.exports.
const commonJsPluginSource = String.raw`import type { FormatPlugin, LogFormat, ParseEvent } from 'jlv'

const lines: LogFormat = {
  identifier: 'lines',
  probe: () => 0,
  async * read (chunks): AsyncGenerator<ParseEvent> {
    let text = ''
    for await (const chunk of chunks) {
      text += Buffer.from(chunk).toString('utf8')
    }
    let line = 0
    for (const part of text.split('\n')) {
      line += 1
      if (part !== '') {
        yield { kind: 'entry', value: { text: part }, position: { firstLine: line, lastLine: line } }
      }
    }
  },
  normalize: value => ({ record: { level: 'info', message: String(value['text']), fields: {} }, diagnostics: [] })
}

const plugin: FormatPlugin = { apiVersion: 1, formats: [lines] }
export = plugin
`

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[], directory: string): string => ts.formatDiagnostics(diagnostics, {
  getCanonicalFileName: name => name,
  getCurrentDirectory: () => directory,
  getNewLine: () => '\n'
})

// Compiles a TypeScript project with its own settings and gives its diagnostics.
const compile = (configuration: string): string => {
  const directory = path.dirname(configuration)
  let unrecoverable = ''
  const parsed = ts.getParsedCommandLineOfConfigFile(configuration, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => { unrecoverable = formatDiagnostics([diagnostic], directory) }
  })
  if (parsed === undefined) {
    return unrecoverable
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
  const emitted = program.emit()
  return formatDiagnostics([...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics], directory)
}

const checkInstalled = async (tarball: string, manifest: Indexed, project: string): Promise<void> => {
  section(`Installed into ${project}`)
  writeFileSync(path.join(project, 'package.json'), `${JSON.stringify({ name: 'jlv-package-check', private: true, type: 'module' }, undefined, 2)}\n`)
  const installed = await npm(['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', tarball], { cwd: project, timeout: 300_000 })
  check(installed.code === 0, 'npm install of the tarball with its production dependencies and without lifecycle scripts',
    installed.output + installed.errors)
  if (installed.code !== 0) {
    return
  }
  const installedManifest = readJson(path.join(project, 'node_modules', 'jlv', 'package.json'))
  check(property(installedManifest, 'version') === manifest['version'], `jlv@${String(manifest['version'])} is installed`)
  const lockfile = readJson(path.join(project, 'package-lock.json'))
  const packages = property(lockfile, 'packages')
  const installedPackages = isIndexed(packages) ? Object.entries(packages).filter(([name]) => name !== '') : []
  process.stdout.write(`  production packages: ${installedPackages.map(([name, entry]) => `${name.replace(/^.*node_modules\//u, '')}@${String(property(entry, 'version'))}`).join(', ')}\n`)
  check(installedPackages.every(([, entry]) => property(entry, 'hasInstallScript') !== true), 'no installed package has an install script')
  const nativeFiles = readdirSync(path.join(project, 'node_modules'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && (entry.name.endsWith('.node') || entry.name === 'binding.gyp'))
    .map(entry => path.join(entry.parentPath, entry.name))
  check(nativeFiles.length === 0, 'no installed package ships native code', nativeFiles.join('\n'))
  // npm links the bin of every installed package; neo-blessed's bin, named after its package, runs its tput script.
  const commands = new Set(readdirSync(path.join(project, 'node_modules', '.bin')).map(name => name.replace(/\.(?:cmd|ps1)$/u, '')))
  check(isDeepStrictEqual(commands.values().toArray().toSorted(byText), ['jlv', 'neo-blessed']), 'node_modules/.bin holds jlv and neo-blessed only',
    [...commands].join(', '))
  const audit = await npm(['audit', '--omit=dev', '--audit-level=high'], { cwd: project, timeout: 120_000 })
  check(audit.code === 0, 'npm audit finds no high or critical advisory in the production dependencies', audit.output + audit.errors)
}

const checkCommand = async (manifest: Indexed, project: string): Promise<void> => {
  section('The jlv command')
  const home = path.join(project, 'home')
  const logs = path.join(project, 'logs')
  mkdirSync(home)
  mkdirSync(logs)
  mkdirSync(path.join(project, 'bad'))
  copyFileSync(path.join(examples, 'pino.log'), path.join(logs, 'pino.log'))
  copyFileSync(path.join(examples, 'orders.csv'), path.join(logs, 'orders.csv'))
  copyFileSync(path.join(fixtures, 'bunyan', 'bunyan.log'), path.join(logs, 'bunyan.log'))
  writeFileSync(path.join(project, 'bad', 'broken.log'), 'no json\n[1, 2]\n')
  const pino = readFileSync(path.join(logs, 'pino.log'), 'utf8')
  const environment = { ...process.env, HOME: home, USERPROFILE: home }
  const bin = property(manifest['bin'], 'jlv')
  const installed = path.join(project, 'node_modules', 'jlv', typeof bin === 'string' ? bin : 'missing')
  // POSIX runs the linked command itself, which needs its shebang and the mode that npm gave it; Windows runs its
  // target, and the .cmd shim once below.
  const jlv = async (parameters: readonly string[], input?: string): Promise<Completed> => isWindows
    ? run(process.execPath, [installed, ...parameters], { cwd: project, environment, ...(input !== undefined && { input }) })
    : run(path.join(project, 'node_modules', '.bin', 'jlv'), parameters, { cwd: project, environment, ...(input !== undefined && { input }) })
  const expectRun = (result: Completed, description: string, code: number, output: readonly string[] | RegExp, errors: RegExp = /^$/u): void => {
    const isOutputRight = output instanceof RegExp ? output.test(result.output) : isDeepStrictEqual(lines(result.output), output)
    check(result.code === code && isOutputRight && errors.test(result.errors), `${description}: exit code ${String(code)}`,
      `exit code ${String(result.code)}\nstdout:\n${result.output}stderr:\n${result.errors}`)
  }

  expectRun(await jlv(['--version']), 'jlv --version prints the version', 0, [String(manifest['version'])])
  expectRun(await jlv(['--help']), 'jlv --help prints the usage', 0, /^usage: jlv \[options\] \[file \| 'glob' \| -\]\.\.\.\n/u)
  expectRun(await jlv(['--output', 'plain', 'logs/pino.log']), 'pino records as plain text', 0, pinoLines)
  expectRun(await jlv(['--output', 'plain', 'logs/bunyan.log']), 'bunyan records as plain text', 0, bunyanLines)
  expectRun(await jlv(['--output', 'plain', 'logs/orders.csv']), 'CSV records as plain text', 0, csvLines)
  expectRun(await jlv(['--output', 'plain'], pino), 'pino records from standard input', 0, pinoLines)
  expectRun(await jlv(['--output', 'plain', '-'], pino), 'pino records from - as standard input', 0, pinoLines)
  expectRun(await jlv(['--output', 'plain', 'logs/*.log']), 'a quoted glob reads its matches in order', 0, [...bunyanLines, ...pinoLines])
  expectRun(await jlv(['--output', 'jsonl', '--level', 'fatal', 'logs/pino.log']), 'a record as a JSON line', 0, [fatalRecord])
  expectRun(await jlv(['--output', 'plain', '--save', 'saved.jsonl', 'logs/pino.log']), '--save writes a new file', 0, pinoLines)
  const saved = existsSync(path.join(project, 'saved.jsonl')) ? lines(readFileSync(path.join(project, 'saved.jsonl'), 'utf8')) : []
  check(isDeepStrictEqual(saved.map(line => property(JSON.parse(line), 'level')), ['info', 'warn', 'error', 'fatal']),
    'the save file holds the four records as JSON lines')
  expectRun(await jlv(['--output', 'plain', '--save', 'saved.jsonl', 'logs/pino.log']), '--save refuses an existing file', 2, [],
    /^jlv: cannot save to 'saved\.jsonl': the file exists; --overwrite replaces it\n$/u)
  expectRun(await jlv(['--bogus']), 'an unknown option is a usage error', 2, [], /^jlv: Unknown option '--bogus'\./u)
  expectRun(await jlv(['--output', 'plain', 'logs/missing.log']), 'a missing file fails', 1, [], /^jlv: cannot read 'logs\/missing\.log': no such file\n$/u)
  expectRun(await jlv(['--output', 'plain', 'bad/broken.log']), 'an input without records fails', 1, [],
    /jlv: the input holds no records, only 2 skipped lines\n$/u)
  expectRun(await jlv(['--output', 'tui', 'logs/pino.log']), 'the viewer refuses to start without a terminal', 1, [],
    /^jlv: the viewer needs a terminal: /u)
  if (isWindows) {
    const shim = path.join(project, 'node_modules', '.bin', 'jlv.cmd')
    // As Node runs a shell command on Windows: cmd's /s takes the outer quotes off and leaves the quoted path.
    const result = await run(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', `""${shim}" --version"`], { cwd: project, environment, isVerbatim: true })
    expectRun(result, 'the jlv.cmd shim runs', 0, [String(manifest['version'])])
  } else {
    check((statSync(installed).mode & 0o111) !== 0, 'the installed dist/cli.js is executable')
  }
  check(readdirSync(home).length === 0, 'the home directory stays empty')
}

const checkConsumer = async (project: string): Promise<void> => {
  section('TypeScript consumers and plugins')
  const consumer = path.join(project, 'consumer')
  const commonJs = path.join(project, 'commonjs')
  mkdirSync(consumer)
  mkdirSync(commonJs)
  // The consumers compile with the workspace's TypeScript and Node types, linked into the project.
  const nodeTypes = path.join(repository, 'node_modules', '@types', 'node')
  mkdirSync(path.join(project, 'node_modules', '@types'), { recursive: true })
  symlinkSync(nodeTypes, path.join(project, 'node_modules', '@types', 'node'), 'junction')
  const authorFixture = path.join(fixtures, 'plugin-author')
  const settings = readJson(path.join(authorFixture, 'tsconfig.json'))
  const compilerOptions = property(settings, 'compilerOptions')
  check(property(compilerOptions, 'strict') === true && property(compilerOptions, 'skipLibCheck') === false,
    'the consumers compile with strict settings and skipLibCheck off')
  copyFileSync(path.join(authorFixture, 'plugin.ts'), path.join(consumer, 'plugin.ts'))
  writeFileSync(path.join(consumer, 'consumer.ts'), consumerSource)
  // The plugin that the installed README shows compiles and runs too.
  const readmePlugin = /```ts\n(.*?)```/su.exec(readFileSync(path.join(project, 'node_modules', 'jlv', 'README.md'), 'utf8'))?.[1]
  check(readmePlugin !== undefined, 'README.md shows a plugin in TypeScript')
  writeFileSync(path.join(consumer, 'readme-plugin.ts'), readmePlugin ?? '')
  writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['plugin.ts', 'consumer.ts', 'readme-plugin.ts'] }))
  const consumerDiagnostics = compile(path.join(consumer, 'tsconfig.json'))
  check(consumerDiagnostics === '', 'an ECMAScript consumer and plugin compile against \'jlv\' and \'jlv/formats\'', consumerDiagnostics)
  writeFileSync(path.join(commonJs, 'plugin.cts'), commonJsPluginSource)
  writeFileSync(path.join(commonJs, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['plugin.cts'] }))
  const commonJsDiagnostics = compile(path.join(commonJs, 'tsconfig.json'))
  check(commonJsDiagnostics === '', 'a CommonJS plugin compiles against \'jlv\' with a type-only import', commonJsDiagnostics)

  const report = await run(process.execPath, [path.join(consumer, 'dist', 'consumer.js')], { cwd: project, timeout: 30_000 })
  let parsed: unknown
  try {
    parsed = JSON.parse(report.output)
  } catch {
    parsed = undefined
  }
  check(report.code === 0 && isDeepStrictEqual(parsed, expectedConsumerReport),
    'the consumer imports \'jlv\' and \'jlv/formats\' without effects: no terminal library, no signal handlers, no exit code, and it ends by itself',
    `exit code ${String(report.code)}\nstdout: ${report.output}\nstderr: ${report.errors}`)

  writeFileSync(path.join(project, 'acme.log'), acmeLog)
  writeFileSync(path.join(project, 'notes.txt'), 'backup started\nbackup finished\n')
  const command = path.join(project, 'node_modules', 'jlv', 'dist', 'cli.js')
  const environment = { ...process.env, HOME: path.join(project, 'home'), USERPROFILE: path.join(project, 'home') }
  const acme = await run(process.execPath, [command, '--output', 'plain', '--plugin', './consumer/dist/plugin.js', '--predicate', 'isSlow', 'acme.log'],
    { cwd: project, environment })
  check(acme.code === 0 && acme.output === '2026-10-11T10:00:00.000Z warn slow request {"sev":3,"text":"slow request","at":1791712800,"ms":1500}\n',
    'jlv runs the compiled ECMAScript plugin and its predicate', `exit code ${String(acme.code)}\n${acme.output}${acme.errors}`)
  const notes = await run(process.execPath, [command, '--output', 'plain', '--plugin', './commonjs/dist/plugin.cjs', '--format', 'lines', 'notes.txt'],
    { cwd: project, environment })
  check(notes.code === 0 && notes.output === '- info backup started\n- info backup finished\n',
    'jlv runs the compiled CommonJS plugin', `exit code ${String(notes.code)}\n${notes.output}${notes.errors}`)
  const shown = await run(process.execPath, [command, '--output', 'plain', '--plugin', './consumer/dist/readme-plugin.js', 'acme.log'],
    { cwd: project, environment })
  check(shown.code === 0 && shown.output === readmePluginOutput, 'jlv runs the plugin of README.md, which recognizes its format',
    `exit code ${String(shown.code)}\n${shown.output}${shown.errors}`)
}

const main = async (): Promise<number> => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'jlv-package-check-'))
  try {
    const npmVersion = await npm(['--version'], { cwd: temporary })
    process.stdout.write(`Node ${process.version} on ${process.platform}/${process.arch}; npm ${npmVersion.output.trim()}\n`)
    const tarball = await obtainTarball(temporary)
    const manifest = checkTarball(tarball)
    const project = path.join(temporary, 'project')
    mkdirSync(project)
    await checkInstalled(tarball, manifest, project)
    if (existsSync(path.join(project, 'node_modules', 'jlv'))) {
      await checkCommand(manifest, project)
      await checkConsumer(project)
    }
    const outputs = process.env['GITHUB_OUTPUT']
    if (outputs !== undefined && problems.length === 0) {
      appendFileSync(outputs, [
        `tarball=${tarball}`, `file=${path.basename(tarball)}`, `name=${String(manifest['name'])}`,
        `version=${String(manifest['version'])}`, `sha256=${sha256(tarball)}`, ''
      ].join('\n'))
    }
    section(problems.length === 0
      ? `All checks passed for ${path.basename(tarball)} (SHA-256 ${sha256(tarball)}).`
      : `${String(problems.length)} checks failed for ${path.basename(tarball)}.`)
    return problems.length === 0 ? 0 : 1
  } finally {
    if (options.keep === true) {
      process.stdout.write(`Kept ${temporary}\n`)
    } else {
      rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }
}

process.exitCode = await main()
