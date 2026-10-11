// The keyboard discovery of src/terminal.ts. Opening a real console or /dev/tty is left to the spawned command-line
// tests, which run without a console, and to the manual terminal checklist.
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { keyboardPaths, openKeyboard } from '../src/terminal.js'

const terminalInput = (): PassThrough & { isTTY: boolean } => Object.assign(new PassThrough(), { isTTY: true })

describe('keyboard', () => {
  it('reads keys from standard input when it is a terminal that carries no records, and destroys it when done', () => {
    const stdin = terminalInput()
    const keyboard = openKeyboard({ stdin, isStdinSource: false })
    assert.equal(keyboard?.stream, stdin)
    assert.equal(keyboard.path, 'stdin')
    keyboard.close()
    assert.equal(stdin.destroyed, true)
  })

  it('looks for the console input on Windows, with the device behind it as the fallback, and for /dev/tty elsewhere', () => {
    assert.deepEqual(keyboardPaths('win32'), [String.raw`\\.\CONIN$`, String.raw`\\?\GLOBALROOT\Device\ConDrv\Input`])
    assert.deepEqual(keyboardPaths('linux'), ['/dev/tty'])
    assert.deepEqual(keyboardPaths('darwin'), ['/dev/tty'])
  })

  // Windows has no /dev/tty, so this finds no keyboard without touching the console of the test.
  it('finds no keyboard when no device opens', { skip: process.platform !== 'win32' }, () => {
    assert.equal(openKeyboard({ stdin: terminalInput(), isStdinSource: true, platform: 'linux' }), undefined)
  })
})
