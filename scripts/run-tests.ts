// Runs the emitted tests with node:test. Explicit file paths avoid shell glob differences between
// platforms; extra arguments (for example --test-name-pattern) are passed on to node --test.
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const outputRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(outputRoot, '..')
const packagesOutput = path.join(outputRoot, 'packages')

const testFiles = readdirSync(packagesOutput, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.js') && !entry.parentPath.split(path.sep).includes('node_modules'))
  .map(entry => path.join(entry.parentPath, entry.name))
  .toSorted((left, right) => left.localeCompare(right))

const isPresent = (file: string): boolean => lstatSync(file, { throwIfNoEntry: false }) !== undefined

// Emitted code must resolve the same dependencies as its package in the source tree. Each dependency
// gets its own link to its real location: linking the whole node_modules directory is not enough on
// Windows, where pnpm's relative symbolic links do not resolve through a junction.
const linkDependencies = (packageName: string): void => {
  const source = path.join(repositoryRoot, 'packages', packageName, 'node_modules')
  if (!isPresent(source)) {
    return
  }
  const names = readdirSync(source).filter(name => !name.startsWith('.')).flatMap(name =>
    name.startsWith('@') ? readdirSync(path.join(source, name)).map(scoped => path.join(name, scoped)) : name)
  for (const name of names) {
    const link = path.join(packagesOutput, packageName, 'node_modules', name)
    if (isPresent(link)) {
      continue
    }
    mkdirSync(path.dirname(link), { recursive: true })
    symlinkSync(realpathSync(path.join(source, name)), link, 'junction')
  }
}

for (const packageName of readdirSync(packagesOutput)) {
  linkDependencies(packageName)
}

if (testFiles.length === 0) {
  process.stderr.write(`No emitted tests below ${packagesOutput}; run the test build first.\n`)
  process.exitCode = 1
} else {
  // An empty home directory keeps the developer's own ~/.json-log-viewer out of every test.
  const home = mkdtempSync(path.join(tmpdir(), 'jlv-test-home-'))
  try {
    const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...process.argv.slice(2), ...testFiles], {
      stdio: 'inherit',
      env: { ...process.env, HOME: home, USERPROFILE: home }
    })
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
