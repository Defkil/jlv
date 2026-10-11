// Runs the emitted tests with node:test. Explicit file paths avoid shell glob differences between
// platforms; extra arguments (for example --test-name-pattern) are passed on to node --test.
import { spawn } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const outputRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(outputRoot, '..')
const packagesOutput = path.join(outputRoot, 'packages')

// The tests of the packages and of the repository's scripts.
const testFiles = [packagesOutput, path.join(outputRoot, 'scripts')]
  .flatMap(directory => readdirSync(directory, { recursive: true, withFileTypes: true }))
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

// The exit status of a process that a signal ended, as a shell reports it.
const signalNumbers: Readonly<Record<string, number>> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }

// Runs the tests in a child process. The child gets an empty home directory, which keeps the developer's own
// ~/.json-log-viewer out of every test, and a temporary directory of its own: os.tmpdir() in every test file
// points there, so whatever a test creates is removed with the run directory, even when a test process dies
// before its after() hooks run, for example when the run is cut short.
const runTests = async (): Promise<number> => {
  const runDirectory = mkdtempSync(path.join(tmpdir(), 'jlv-test-run-'))
  let signalCode: number | undefined
  try {
    const home = path.join(runDirectory, 'home')
    const temporary = path.join(runDirectory, 'tmp')
    mkdirSync(home)
    mkdirSync(temporary)
    const child = spawn(process.execPath, ['--enable-source-maps', '--test', ...process.argv.slice(2), ...testFiles], {
      stdio: 'inherit',
      env: { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: temporary, TMP: temporary, TEMP: temporary }
    })
    // Ctrl-C reaches the whole process group or console, so the test runner stops by itself; other signals that
    // end this process are passed on. Either way the run directory is removed after the child has exited.
    const stop = (signal: NodeJS.Signals): void => {
      signalCode = 128 + (signalNumbers[signal] ?? 0)
      if (signal !== 'SIGINT') {
        child.kill(signal)
      }
    }
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
    for (const signal of signals) {
      process.on(signal, stop)
    }
    const status = await new Promise<number>(resolve => {
      child.on('exit', (code, signal) => { resolve(code ?? 128 + (signal === null ? 0 : (signalNumbers[signal] ?? 0))) })
      child.on('error', () => { resolve(1) })
    })
    for (const signal of signals) {
      process.off(signal, stop)
    }
    return signalCode ?? status
  } finally {
    rmSync(runDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

for (const packageName of readdirSync(packagesOutput)) {
  linkDependencies(packageName)
}

if (testFiles.length === 0) {
  process.stderr.write(`No emitted tests below ${packagesOutput}; run the test build first.\n`)
  process.exitCode = 1
} else {
  process.exitCode = await runTests()
}
