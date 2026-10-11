// Completes the emitted test tree in .test-dist. tsc emits only TypeScript, so this copies what the
// emitted tests need next to them: package manifests (their module type decides how Node loads the
// emitted files), JavaScript sources that are not ported yet, and fixture files.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

const outputRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(outputRoot, '..')
const packagesOutput = path.join(outputRoot, 'packages')

const isMirrored = (relativePath: string): boolean => {
  const segments = relativePath.split(path.sep)
  const fileName = segments.at(-1) ?? ''
  const isWanted = fileName === 'package.json' || segments.includes('fixtures') || (segments[0] === 'src' && !fileName.endsWith('.ts'))
  return isWanted && !segments.includes('node_modules')
}

let copied = 0
// Only packages with emitted TypeScript take part in the tests.
for (const packageName of readdirSync(packagesOutput)) {
  const packageSource = path.join(repositoryRoot, 'packages', packageName)
  const entries = readdirSync(packageSource, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    const relativePath = path.relative(packageSource, path.join(entry.parentPath, entry.name))
    if (!entry.isFile() || !isMirrored(relativePath)) {
      continue
    }
    const target = path.join(packagesOutput, packageName, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(path.join(packageSource, relativePath), target)
    copied += 1
  }
}
process.stdout.write(`Mirrored ${String(copied)} manifest, source and fixture files into ${path.relative(repositoryRoot, outputRoot)}.\n`)
