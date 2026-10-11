// Publishes the tested tarball of jlv to npm (plan section 9.3). The publish job of .github/workflows/publish.yml runs it
// on master with an OIDC token, which npm exchanges for a short-lived publish token: trusted publishing, so that no npm
// token exists anywhere. The quality job runs it with --dry-run on every branch, which makes every decision without
// publishing.
//
// Usage: node scripts/publish-package.ts <tarball> --sha256 <hex> [--changelog <file>] [--dry-run]
//
// Before publishing, it requires:
//   - the tarball's SHA-256 to be the one that the quality job recorded, so that the tested file is published;
//   - its manifest to name jlv with a stable version, and the changelog to have a dated section for that version;
//   - npm 11.5.1 or later, the first release with trusted publishing (the workflow installs 12.2.0);
//   - `npm view jlv versions --json` to answer with the list of published versions. A failed or malformed answer
//     stops the run; it never counts as a missing version.
// A version that is on npm already is skipped, which makes a rerun safe. Otherwise it runs
// `npm publish <tarball> --access public --provenance --tag latest` and waits until the registry lists the version.
// A real publication also requires GitHub Actions on refs/heads/master. Exit code 0 means published or skipped.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'

const packageName = 'jlv'
const minimumNpm: readonly number[] = [11, 5, 1]
const confirmationAttempts = 12
const confirmationDelay = 5000

class ReleaseError extends Error {}

// npm.cmd needs a shell on Windows; its JavaScript entry point runs with this Node instead, so that no argument passes
// through a shell. Elsewhere npm is a plain executable.
const npmInvocation = (parameters: readonly string[]): { readonly command: string, readonly parameters: readonly string[] } => {
  if (process.platform !== 'win32') {
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
  throw new ReleaseError('cannot find npm.cmd with its npm-cli.js on the PATH')
}

interface Completed {
  readonly code: number | undefined
  readonly output: string
  readonly errors: string
}

const npm = (parameters: readonly string[], isShown = false): Completed => {
  const invocation = npmInvocation(parameters)
  const result = spawnSync(invocation.command, invocation.parameters, {
    encoding: 'utf8',
    stdio: ['ignore', isShown ? 'inherit' : 'pipe', isShown ? 'inherit' : 'pipe'],
    windowsHide: true
  })
  if (result.error !== undefined) {
    throw new ReleaseError(`cannot run npm: ${result.error.message}`)
  }
  // Shown output goes to this process's streams, and spawnSync gives null for it.
  return { code: result.status ?? undefined, output: isShown ? '' : result.stdout, errors: isShown ? '' : result.stderr }
}

// The package.json of an npm tarball.
const manifestOf = (file: string): unknown => {
  const archive = gunzipSync(readFileSync(file))
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    const nameEnd = header.indexOf(0)
    const name = header.subarray(0, nameEnd === -1 || nameEnd > 100 ? 100 : nameEnd).toString('utf8')
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replaceAll('\0', '').trim() || '0', 8)
    if (name === 'package/package.json') {
      return JSON.parse(archive.subarray(offset + 512, offset + 512 + size).toString('utf8'))
    }
    if (header.every(byte => byte === 0)) {
      break
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw new ReleaseError(`${file} holds no package/package.json`)
}

const textProperty = (value: unknown, key: string): string | undefined => {
  const found: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
  return typeof found === 'string' ? found : undefined
}

// The published versions of the package. npm answers one version as a string and several as an array; an error, an
// unknown package or anything else stops the run.
const publishedVersions = (): readonly string[] => {
  const result = npm(['view', packageName, 'versions', '--json'])
  if (result.code !== 0) {
    throw new ReleaseError(`npm view ${packageName} versions failed with exit code ${String(result.code)}; nothing was published.\n${result.output}${result.errors}`)
  }
  let answer: unknown
  try {
    answer = JSON.parse(result.output)
  } catch {
    throw new ReleaseError(`npm view ${packageName} versions answered no JSON; nothing was published.\n${result.output}`)
  }
  const answers: unknown[] = Array.isArray(answer) ? answer : [answer]
  const versions = answers.filter(version => typeof version === 'string')
  if (versions.length === 0 || versions.length !== answers.length) {
    throw new ReleaseError(`npm view ${packageName} versions answered no list of versions; nothing was published.\n${result.output}`)
  }
  return versions
}

const isAtLeast = (version: string, minimum: readonly number[]): boolean => {
  const parts = version.split('.').map(Number)
  for (const [index, required] of minimum.entries()) {
    const part = parts[index] ?? 0
    if (part !== required) {
      return part > required
    }
  }
  return true
}

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise(resolve => { setTimeout(resolve, milliseconds) })
}

const notice = (message: string): void => {
  process.stdout.write(process.env['GITHUB_ACTIONS'] === 'true' ? `::notice::${message}\n` : `${message}\n`)
}

const release = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      sha256: { type: 'string' },
      changelog: { type: 'string', default: 'CHANGELOG.md' },
      'dry-run': { type: 'boolean' }
    }
  })
  const [tarball, ...extra] = positionals
  if (tarball === undefined || extra.length > 0 || values.sha256 === undefined || !/^[\da-f]{64}$/u.test(values.sha256)) {
    throw new ReleaseError('usage: node scripts/publish-package.ts <tarball> --sha256 <hex> [--changelog <file>] [--dry-run]')
  }
  if (!existsSync(tarball)) {
    throw new ReleaseError(`${tarball} does not exist`)
  }
  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  if (digest !== values.sha256) {
    throw new ReleaseError(`${tarball} has the SHA-256 ${digest}, not ${values.sha256} of the tested tarball`)
  }

  const manifest = manifestOf(tarball)
  const name = textProperty(manifest, 'name')
  if (name !== packageName) {
    throw new ReleaseError(`the tarball holds ${String(name)}, not ${packageName}`)
  }
  const version = textProperty(manifest, 'version') ?? ''
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new ReleaseError(`${packageName}@${version} is no stable version; a prerelease needs a dist-tag policy first`)
  }
  const label = `${packageName}@${version}`
  const changelog = existsSync(values.changelog) ? readFileSync(values.changelog, 'utf8') : ''
  const heading = new RegExp(String.raw`^## \[${version.replaceAll('.', String.raw`\.`)}\] - (\d{4}-\d{2}-\d{2})$`, 'mu').exec(changelog)
  if (heading?.[1] === undefined || Number.isNaN(Date.parse(heading[1]))) {
    throw new ReleaseError(`${values.changelog} has no dated section "## [${version}] - YYYY-MM-DD" for ${label}`)
  }

  const npmVersion = npm(['--version']).output.trim()
  if (!/^\d+\.\d+\.\d+/u.test(npmVersion) || !isAtLeast(npmVersion, minimumNpm)) {
    throw new ReleaseError(`trusted publishing needs npm ${minimumNpm.join('.')} or later, found ${npmVersion === '' ? 'none' : npmVersion}`)
  }

  const versions = publishedVersions()
  if (versions.includes(version)) {
    notice(`${label} is on npm already; nothing to publish.`)
    return
  }
  if (values['dry-run'] === true) {
    notice(`${label} is not on npm yet; the publish job on master publishes ${path.basename(tarball)} (SHA-256 ${digest}) with npm ${npmVersion}.`)
    return
  }
  if (process.env['GITHUB_ACTIONS'] !== 'true' || process.env['GITHUB_REF'] !== 'refs/heads/master') {
    throw new ReleaseError(`${label} is published only by the publish job on refs/heads/master, not from ${process.env['GITHUB_REF'] ?? 'outside GitHub Actions'}`)
  }

  process.stdout.write(`Publishing ${label} from ${path.basename(tarball)} (SHA-256 ${digest}) with npm ${npmVersion}\n`)
  const published = npm(['publish', tarball, '--access', 'public', '--provenance', '--tag', 'latest'], true)
  if (published.code !== 0) {
    throw new ReleaseError(`npm publish of ${label} failed with exit code ${String(published.code)}. Check npm view ${packageName} versions before running this job again; a version on npm is skipped then.`)
  }
  // The publication succeeded; a registry that is slow to list it, or a failed lookup, only earns a warning now.
  for (let attempt = 1; attempt <= confirmationAttempts; attempt += 1) {
    let isListed = false
    try {
      isListed = publishedVersions().includes(version)
    } catch (error) {
      if (!(error instanceof ReleaseError)) {
        throw error
      }
    }
    if (isListed) {
      notice(`${label} is on npm.`)
      return
    }
    await delay(confirmationDelay)
  }
  process.stdout.write(`${label} was published, but the registry did not list it within a minute; check npm view ${label}.\n`)
}

try {
  await release()
} catch (error) {
  if (!(error instanceof ReleaseError)) {
    throw error
  }
  process.stderr.write(`${process.env['GITHUB_ACTIONS'] === 'true' ? '::error::' : ''}publish-package: ${error.message}\n`)
  process.exitCode = 1
}
