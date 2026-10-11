// The examples of the documentation (plan section 8, phase 6, upstream issue #7): every console block in docs/*.md
// runs its jv commands in docs/examples with an empty home directory and must print what the block shows. A command
// line starts with "$ jv"; the lines after it, up to the next command, are its output. A terminal shows standard
// output and standard error together, so the output may interleave them in any order that keeps the order of each.
// "; echo $?" after a command adds its exit code as the last line.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

// The repository, from the emitted test in .test-dist/packages/jlv/test.
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const documentation = path.join(repository, 'docs')
const examples = path.join(documentation, 'examples')
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))

interface Example {
  readonly command: string
  readonly output: string[]
}

const readDocument = (name: string): string => readFileSync(path.join(documentation, name), 'utf8')

// The commands of a document's console blocks, each with the lines that it prints.
const examplesOf = (text: string): readonly Example[] => {
  const found: Example[] = []
  const blocks = text.matchAll(/^```console\n(.*?)^```$/gmsu)
  for (const [, block = ''] of blocks) {
    let current: Example | undefined
    const lines = block.split('\n').slice(0, -1)
    for (const line of lines) {
      if (line.startsWith('$ ')) {
        current = { command: line.slice(2), output: [] }
        found.push(current)
      } else {
        assert.ok(current, `a console block starts with output instead of a command: ${line}`)
        current.output.push(line)
      }
    }
  }
  return found
}

const exitCodeSuffix = '; echo $?'

const linesOf = (text: string): string[] => text === '' ? [] : text.replace(/\n$/u, '').split('\n')

// Runs a command line of the documentation, which may quote an argument in single quotes, and gives its output lines.
const run = async (command: string): Promise<{ readonly output: readonly string[], readonly errors: readonly string[] }> => {
  const isExitCodeShown = command.endsWith(exitCodeSuffix)
  const line = isExitCodeShown ? command.slice(0, -exitCodeSuffix.length) : command
  const [program, ...parameters] = Array.from(line.matchAll(/'([^']*)'|(\S+)/gu), ([, quoted, plain]) => quoted ?? plain ?? '')
  assert.equal(program, 'jv', `the documentation runs only jv: ${command}`)
  const child = spawn(process.execPath, [cli, ...parameters], { cwd: examples, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  let errors = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errors += chunk })
  const code = await new Promise<number | null>(resolve => {
    child.on('close', exitCode => { resolve(exitCode) })
  })
  return { output: isExitCodeShown ? [...linesOf(output), String(code)] : linesOf(output), errors: linesOf(errors) }
}

// Whether the shown lines are the output and the errors, interleaved in an order that keeps the order of each. Error
// lines start with "jv:", and records never do in the examples, so taking the next line greedily is enough.
const isInterleaving = (shown: readonly string[], output: readonly string[], errors: readonly string[]): boolean => {
  let outputIndex = 0
  let errorIndex = 0
  for (const line of shown) {
    if (line === output[outputIndex]) {
      outputIndex += 1
    } else if (line === errors[errorIndex]) {
      errorIndex += 1
    } else {
      return false
    }
  }
  return outputIndex === output.length && errorIndex === errors.length
}

const documents = readdirSync(documentation).filter(name => name.endsWith('.md') && !name.startsWith('v2-'))

describe('documentation examples', () => {
  it('finds the examples of the format, configuration and migration guides', () => {
    for (const name of ['formats.md', 'configuration.md', 'migration.md']) {
      assert.ok(examplesOf(readDocument(name)).length > 0, name)
    }
  })

  for (const name of documents) {
    const documentExamples = examplesOf(readDocument(name))
    for (const example of documentExamples) {
      it(`${name}: ${example.command}`, async () => {
        const { output, errors } = await run(example.command)
        const printed = [...output, ...errors].join('\n')
        assert.ok(isInterleaving(example.output, output, errors), `${example.command} printed:\n${printed}`)
      })
    }
  }
})
