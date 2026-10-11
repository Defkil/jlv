// Resolves the inputs named on the command line into sources (plan section 6.1): standard input, files named
// literally and files that quoted glob patterns match. Patterns are expanded with tinyglobby on every platform and
// Node version alike. An existing path is always read literally, even when it contains pattern characters; each
// pattern's matches are sorted, the arguments keep their order, and a file reached twice is read once.
import { createReadStream, type BigIntStats } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { glob, isDynamicPattern } from 'tinyglobby'

// The source of a record: identifier and order are its position among the inputs, from 1 and from 0; the label is
// what the viewer shows, the argument as given or, for a pattern match, the path relative to the working directory.
interface SourceInformation {
  readonly identifier: string
  readonly label: string
  readonly order: number
}

// A regular file can be read to its end and followed. A named pipe or a device is read like standard input.
type InputSource =
  | { readonly kind: 'file', readonly path: string, readonly information: SourceInformation }
  | { readonly kind: 'stream', readonly path: string, readonly information: SourceInformation }
  | { readonly kind: 'stdin', readonly information: SourceInformation }

// An input that cannot be used, with the exit code of plan section 6.1: 2 for a usage error, 1 for a file that
// cannot be read.
class InputError extends Error {
  readonly exitCode: 1 | 2

  constructor (message: string, exitCode: 1 | 2) {
    super(message)
    this.name = 'InputError'
    this.exitCode = exitCode
  }
}

interface ResolveOptions {
  readonly workingDirectory: string
  // Standard input is a terminal: without arguments there is nothing to read.
  readonly isStdinTerminal: boolean
  readonly platform?: NodeJS.Platform
  readonly signal?: AbortSignal
}

const stdinLabel = 'stdin'

// The size of the chunks read from a file. Larger chunks need fewer reads through the thread pool.
const fileChunkBytes = 256 * 1024

// Backslashes separate the parts of a Windows path; glob patterns use slashes and reserve the backslash for escapes.
// On Windows, a pattern's backslashes are therefore separators: a pattern character in a file name is matched with
// a class such as [[] instead.
const toPattern = (argument: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? argument.replaceAll('\\', '/') : argument

// The code-unit order of two paths, the same in every locale.
const comparePaths = (left: string, right: string): number => {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

// The errors of a path that names no file. Windows reports a name with * or ? as missing or invalid.
const missingFileCodes: ReadonlySet<unknown> = new Set(['ENOENT', 'ENOTDIR', 'EINVAL'])

const statOrUndefined = async (file: string): Promise<BigIntStats | undefined> => {
  try {
    return await stat(file, { bigint: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && missingFileCodes.has(error.code)) {
      return undefined
    }
    throw error
  }
}

interface Candidate {
  readonly file: string
  readonly label: string
}

// The files an argument names: the path itself when it exists, otherwise the sorted matches of the pattern.
const candidatesOf = async (argument: string, options: ResolveOptions): Promise<Candidate[]> => {
  const { workingDirectory, signal } = options
  const platform = options.platform ?? process.platform
  const literal = path.resolve(workingDirectory, argument)
  if (argument !== '' && await statOrUndefined(literal) !== undefined) {
    return [{ file: literal, label: argument }]
  }
  const pattern = toPattern(argument, platform)
  if (argument === '' || !isDynamicPattern(pattern)) {
    throw new InputError(`cannot read '${argument}': no such file`, 1)
  }
  const matches = await glob(pattern, {
    cwd: workingDirectory,
    absolute: true,
    expandDirectories: false,
    onlyFiles: true,
    caseSensitiveMatch: platform !== 'win32',
    ...(signal && { signal })
  })
  if (matches.length === 0) {
    throw new InputError(`no file matches the pattern '${argument}'`, 1)
  }
  return matches.map(match => path.resolve(match)).toSorted(comparePaths).map(file => ({
    file,
    label: path.relative(workingDirectory, file) || file
  }))
}

// What makes two paths the same file: device and file number where the file system has them, else the real path.
const identityOf = async (file: string, status: BigIntStats): Promise<string> =>
  status.ino === 0n ? await realpath(file) : `${String(status.dev)}:${String(status.ino)}`

const information = (label: string, order: number): SourceInformation => ({ identifier: String(order + 1), label, order })

const resolveInputs = async (inputArguments: readonly string[], options: ResolveOptions): Promise<InputSource[]> => {
  if (inputArguments.length === 0) {
    if (options.isStdinTerminal) {
      throw new InputError('no input: name a log file or pipe records into jlv', 2)
    }
    return [{ kind: 'stdin', information: information(stdinLabel, 0) }]
  }
  const sources: InputSource[] = []
  const identities = new Set<string>()
  let hasStdin = false
  for (const argument of inputArguments) {
    if (argument === '-') {
      if (!hasStdin) {
        sources.push({ kind: 'stdin', information: information(stdinLabel, sources.length) })
        hasStdin = true
      }
      continue
    }
    const candidates = await candidatesOf(argument, options)
    for (const { file, label } of candidates) {
      const status = await stat(file, { bigint: true })
      if (status.isDirectory()) {
        throw new InputError(`cannot read '${label}': it is a directory`, 1)
      }
      const identity = await identityOf(file, status)
      if (identities.has(identity)) {
        continue
      }
      identities.add(identity)
      const kind = status.isFile() ? 'file' : 'stream'
      sources.push({ kind, path: file, information: information(label, sources.length) })
    }
  }
  return sources
}

// Reads a file or a named pipe in chunks; the signal stops the reading and closes the file.
const readFileChunks = (file: string, signal?: AbortSignal): Readable =>
  createReadStream(file, { highWaterMark: fileChunkBytes, ...(signal && { signal }) })

export { InputError, readFileChunks, resolveInputs, stdinLabel }
export type { InputSource, ResolveOptions, SourceInformation }
