// The release script, scripts/publish-package.ts (plan sections 8, phase 8, and 9.3), against a stub npm on the PATH that
// plays the registry: it publishes a version that is not on npm, skips one that is, and stops without publishing when
// the registry lookup fails or answers something else than versions, when the tarball is not the tested one, when the
// changelog lacks the version, when npm is too old, and outside the publish job on master. Nothing reaches npm.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const script = fileURLToPath(new URL('publish-package.js', import.meta.url))
const directory = mkdtempSync(path.join(tmpdir(), 'jlv-publish-'))
after(() => {
  rmSync(directory, { recursive: true, force: true })
})

interface Tarball {
  readonly file: string
  readonly sha256: string
}

// A gzipped ustar archive with one file, package/package.json, as npm pack writes it.
const tarball = (name: string, manifest: object): Tarball => {
  const content = Buffer.from(JSON.stringify(manifest))
  const header = Buffer.alloc(512)
  header.write('package/package.json', 0)
  header.write('0000644', 100)
  header.write(content.length.toString(8).padStart(11, '0'), 124)
  header.write('0', 156)
  header.write('ustar', 257)
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  const file = path.join(directory, name)
  const archive = Buffer.concat([header, content, padding, Buffer.alloc(1024)])
  writeFileSync(file, gzipSync(archive))
  const bytes = readFileSync(file)
  return { file, sha256: createHash('sha256').update(bytes).digest('hex') }
}

// The stub npm: --version, view <name> versions --json and publish, as the state file says. Every call is recorded.
const stubSource = String.raw`const fs = require('node:fs')
const file = process.env.STUB_STATE
const state = JSON.parse(fs.readFileSync(file, 'utf8'))
const parameters = process.argv.slice(2)
state.calls.push(parameters)
let code = 0
if (parameters[0] === '--version') {
  process.stdout.write(state.npmVersion + '\n')
  code = state.npmVersionCode ?? 0
} else if (parameters[0] === 'view') {
  if (state.view === 'fail') {
    process.stderr.write('npm error code E500\n')
    code = 1
  } else if (state.view === 'missing') {
    process.stderr.write('npm error code E404\n')
    code = 1
  } else if (state.view === 'garbage') {
    process.stdout.write('<html>proxy error</html>\n')
  } else if (state.view === 'object') {
    process.stdout.write('{"error":"odd"}\n')
  } else {
    process.stdout.write(JSON.stringify(state.versions.length === 1 ? state.versions[0] : state.versions) + '\n')
  }
} else if (parameters[0] === 'publish') {
  if (state.publish === 'fail') {
    code = 1
  } else {
    state.versions.push(state.publishes)
  }
}
fs.writeFileSync(file, JSON.stringify(state))
process.exitCode = code
`

interface State {
  readonly versions: readonly string[]
  readonly view?: 'ok' | 'fail' | 'missing' | 'garbage' | 'object'
  readonly npmVersion?: string
  readonly npmVersionCode?: number
  readonly publish?: 'ok' | 'fail'
}

interface Outcome {
  readonly code: number | null
  readonly output: string
  readonly errors: string
  readonly calls: readonly (readonly string[])[]
}

const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

// Runs the script with a stub npm first on the PATH, as the publish job on master unless the environment says otherwise.
const release = async (subject: Tarball, state: State, parameters: readonly string[] = [], environment: Readonly<Record<string, string | undefined>> = {}): Promise<Outcome> => {
  const run = mkdtempSync(path.join(directory, 'run-'))
  const stub = path.join(run, 'bin')
  // npm.cmd marks the directory on Windows, where the script runs node_modules/npm/bin/npm-cli.js beside it.
  mkdirSync(path.join(stub, 'node_modules', 'npm', 'bin'), { recursive: true })
  writeFileSync(path.join(run, 'package.json'), '{"type":"commonjs"}')
  writeFileSync(path.join(stub, 'npm.cmd'), '')
  writeFileSync(path.join(stub, 'node_modules', 'npm', 'bin', 'npm-cli.js'), stubSource)
  writeFileSync(path.join(stub, 'npm'), `#!/usr/bin/env node\n${stubSource}`)
  chmodSync(path.join(stub, 'npm'), 0o755)
  const stateFile = path.join(run, 'state.json')
  writeFileSync(stateFile, JSON.stringify({ view: 'ok', npmVersion: '12.2.0', publish: 'ok', publishes: '2.0.0', calls: [], ...state }))
  const changelog = path.join(run, 'CHANGELOG.md')
  writeFileSync(changelog, '# Changelog\n\n## [Unreleased]\n\n## [2.0.0] - 2026-10-12\n\n### Added\n\n- Everything.\n')
  // Windows keeps the search path as Path; one key of any case replaces it.
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  const child = spawn(process.execPath, [script, subject.file, '--sha256', subject.sha256, '--changelog', changelog, ...parameters], {
    env: {
      ...process.env,
      [pathKey]: `${stub}${path.delimiter}${process.env[pathKey] ?? ''}`,
      STUB_STATE: stateFile,
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'Defkil/jlv',
      GITHUB_REF: 'refs/heads/master',
      GITHUB_EVENT_NAME: 'push',
      ...environment
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  let output = ''
  let errors = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errors += chunk })
  const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })
  const recorded: unknown = JSON.parse(readFileSync(stateFile, 'utf8'))
  const calls: unknown = typeof recorded === 'object' && recorded !== null ? Reflect.get(recorded, 'calls') : undefined
  return { code, output, errors, calls: Array.isArray(calls) ? calls.filter(call => isTextList(call)) : [] }
}

const commands = (outcome: Outcome): string[] => outcome.calls.map(call => call.slice(0, 2).join(' '))

const release200 = tarball('jlv-2.0.0.tgz', { name: 'jlv', version: '2.0.0' })

// Every run has its own stub and state, so the cases run at the same time.
describe('publishing the tested tarball', { concurrency: true }, () => {
  it('publishes a version that is not on npm yet, with provenance, and waits until the registry lists it', async () => {
    const outcome = await release(release200, { versions: ['1.0.0', '1.0.1'] })
    assert.equal(outcome.code, 0, outcome.errors)
    assert.deepEqual(outcome.calls.find(call => call[0] === 'publish'), ['publish', release200.file, '--access', 'public', '--provenance', '--tag', 'latest', '--registry', 'https://registry.npmjs.org/'])
    assert.ok(outcome.calls.filter(call => call[0] === 'view').every(call => call.slice(-2).join(' ') === '--registry https://registry.npmjs.org/'))
    assert.deepEqual(commands(outcome), ['--version', 'view jlv', `publish ${release200.file}`, 'view jlv'])
    assert.match(outcome.output, /::notice::jlv@2\.0\.0 is on npm\./u)
  })

  it('skips a version that is on npm already, also when npm answers one version as text', async () => {
    const several = await release(release200, { versions: ['1.0.1', '2.0.0'] })
    assert.equal(several.code, 0, several.errors)
    assert.match(several.output, /jlv@2\.0\.0 is on npm already; nothing to publish/u)
    assert.deepEqual(commands(several), ['--version', 'view jlv'])
    const single = await release(release200, { versions: ['2.0.0'] })
    assert.equal(single.code, 0, single.errors)
    assert.deepEqual(commands(single), ['--version', 'view jlv'])
  })

  it('decides without publishing in a dry run, on any branch', async () => {
    const outcome = await release(release200, { versions: ['1.0.1'] }, ['--dry-run'], { GITHUB_REF: 'refs/heads/feat/branch' })
    assert.equal(outcome.code, 0, outcome.errors)
    assert.match(outcome.output, /jlv@2\.0\.0 is not on npm yet; the publish job on master publishes jlv-2\.0\.0\.tgz/u)
    assert.deepEqual(commands(outcome), ['--version', 'view jlv'])
  })

  it('stops without publishing when the registry lookup fails or answers no versions', async () => {
    for (const view of ['fail', 'missing', 'garbage', 'object'] as const) {
      const outcome = await release(release200, { versions: [], view })
      assert.equal(outcome.code, 1, view)
      assert.match(outcome.errors, /::error::publish-package: npm view jlv versions .*nothing was published/u, view)
      assert.deepEqual(commands(outcome), ['--version', 'view jlv'], view)
    }
    const wrongStrings = await release(release200, { versions: ['unavailable'] })
    assert.equal(wrongStrings.code, 1)
    assert.match(wrongStrings.errors, /answered no list of versions/u)
    assert.deepEqual(commands(wrongStrings), ['--version', 'view jlv'])
  })

  it('stops before npm when the tarball is not the tested one, or not a stable jlv release', async () => {
    const other = await release({ file: release200.file, sha256: '0'.repeat(64) }, { versions: [] })
    assert.equal(other.code, 1)
    assert.match(other.errors, /has the SHA-256 [\da-f]{64}, not 0{64} of the tested tarball/u)
    assert.deepEqual(other.calls, [])
    const prerelease = await release(tarball('jlv-2.1.0-beta.1.tgz', { name: 'jlv', version: '2.1.0-beta.1' }), { versions: [] })
    assert.equal(prerelease.code, 1)
    assert.match(prerelease.errors, /jlv@2\.1\.0-beta\.1 is no stable version/u)
    const otherName = await release(tarball('other-2.0.0.tgz', { name: 'jlv-workspace', version: '2.0.0' }), { versions: [] })
    assert.equal(otherName.code, 1)
    assert.match(otherName.errors, /the tarball holds jlv-workspace, not jlv/u)
    const undocumented = await release(tarball('jlv-2.0.1.tgz', { name: 'jlv', version: '2.0.1' }), { versions: [] })
    assert.equal(undocumented.code, 1)
    assert.match(undocumented.errors, /has no dated section "## \[2\.0\.1\] - YYYY-MM-DD" for jlv@2\.0\.1/u)
    assert.deepEqual([...prerelease.calls, ...otherName.calls, ...undocumented.calls], [])
  })

  it('needs npm 11.5.1 or later', async () => {
    const outcome = await release(release200, { versions: [], npmVersion: '11.5.0' })
    assert.equal(outcome.code, 1)
    assert.match(outcome.errors, /trusted publishing needs npm 11\.5\.1 or later, found 11\.5\.0/u)
    assert.deepEqual(commands(outcome), ['--version'])
  })

  it('rejects a failed or malformed npm version command before consulting the registry', async () => {
    for (const state of [
      { npmVersion: '12.2.0', npmVersionCode: 1 },
      { npmVersion: '12.2.0-garbage' }, { npmVersion: '12.2.0 additional output' }
    ]) {
      const outcome = await release(release200, { versions: [], ...state })
      assert.equal(outcome.code, 1)
      assert.deepEqual(commands(outcome), ['--version'])
    }
  })

  it('rejects impossible calendar dates in the changelog before running npm', async () => {
    const changelog = path.join(directory, 'invalid-date.md')
    writeFileSync(changelog, '## [2.0.0] - 2026-02-30\n')
    const outcome = await release(release200, { versions: [] }, ['--changelog', changelog])
    assert.equal(outcome.code, 1)
    assert.match(outcome.errors, /has no dated section/u)
    assert.deepEqual(outcome.calls, [])
  })

  it('publishes only from the publish job on master', async () => {
    for (const environment of [
      { GITHUB_REF: 'refs/heads/feat/branch' }, { GITHUB_ACTIONS: undefined },
      { GITHUB_REPOSITORY: 'someone/jlv' }, { GITHUB_EVENT_NAME: 'pull_request' }
    ]) {
      const outcome = await release(release200, { versions: ['1.0.1'] }, [], environment)
      assert.equal(outcome.code, 1)
      assert.match(outcome.errors, /jlv@2\.0\.0 is published only by the publish job on refs\/heads\/master/u)
      assert.deepEqual(commands(outcome), ['--version', 'view jlv'])
    }
  })

  it('fails visibly when npm publish fails', async () => {
    const outcome = await release(release200, { versions: ['1.0.1'], publish: 'fail' })
    assert.equal(outcome.code, 1)
    assert.match(outcome.errors, /npm publish of jlv@2\.0\.0 failed with exit code 1\. Check npm view jlv versions before running this job again/u)
  })

  it('refuses an incomplete command line', async () => {
    const outcome = await release({ file: release200.file, sha256: 'abc' }, { versions: [] })
    assert.equal(outcome.code, 1)
    assert.match(outcome.errors, /usage: node scripts\/publish-package\.ts <tarball> --sha256 <hex>/u)
  })
})
