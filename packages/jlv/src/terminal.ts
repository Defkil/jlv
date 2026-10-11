// Finds a keyboard for the viewer that is independent of standard input (plan section 6.1), so that records can
// arrive through a pipe while the keys come from the terminal: standard input itself when it is a terminal and no
// log source, otherwise the controlling terminal, /dev/tty on POSIX systems and the console input on Windows.
//
// Windows: \\.\CONIN$ is the documented console input. Node 22.9.0 cannot open it (its path handling appends a
// separator) and opens \\?\GLOBALROOT\Device\ConDrv\Input instead, the device behind it. That fallback was observed
// to work on every supported runtime (plan section 3.4, phase 0 results); it is no documented Node guarantee.
import { closeSync, openSync } from 'node:fs'
import tty from 'node:tty'
import type { Readable } from 'node:stream'

// The stream the viewer reads its keys from, and how to give it back.
interface Keyboard {
  readonly stream: Readable
  // The device that was opened, or stdin.
  readonly path: string
  // Leaves raw mode and closes what was opened for the keyboard; standard input stays open.
  readonly close: () => void
}

interface KeyboardOptions {
  readonly stdin: Readable & { readonly isTTY?: boolean }
  // Whether standard input carries records, so that it cannot carry keys as well.
  readonly isStdinSource: boolean
  readonly platform?: NodeJS.Platform
}

const consoleInputPaths: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  win32: [String.raw`\\.\CONIN$`, String.raw`\\?\GLOBALROOT\Device\ConDrv\Input`]
}
const controllingTerminalPaths: readonly string[] = ['/dev/tty']

// The devices that may give the keyboard of this platform, in the order they are tried.
const keyboardPaths = (platform: NodeJS.Platform): readonly string[] => consoleInputPaths[platform] ?? controllingTerminalPaths

const leaveRawMode = (stream: tty.ReadStream): void => {
  if (stream.isRaw) {
    stream.setRawMode(false)
  }
}

// Opens a terminal device for reading keys, or gives undefined when the device is missing or no terminal.
const openDevice = (path: string, platform: NodeJS.Platform): Keyboard | undefined => {
  let descriptor: number
  try {
    descriptor = openSync(path, 'r+')
  } catch {
    return undefined
  }
  if (!tty.isatty(descriptor)) {
    closeSync(descriptor)
    return undefined
  }
  let stream: tty.ReadStream
  try {
    stream = new tty.ReadStream(descriptor)
  } catch {
    closeSync(descriptor)
    return undefined
  }
  const close = (): void => {
    leaveRawMode(stream)
    stream.destroy()
    // On Windows the stream closes the descriptor itself. libuv on POSIX systems reopens a terminal for its stream
    // and keeps the descriptor it got open, so that one is closed here.
    if (platform !== 'win32') {
      try {
        closeSync(descriptor)
      } catch {
        // The stream used the descriptor itself and has closed it.
      }
    }
  }
  return { stream, path, close }
}

// The keyboard for the viewer, or undefined when the process has no terminal to read keys from.
const openKeyboard = (options: KeyboardOptions): Keyboard | undefined => {
  const { stdin } = options
  if (!options.isStdinSource && stdin.isTTY === true) {
    return {
      stream: stdin,
      path: 'stdin',
      // Nothing reads standard input after the viewer. It is destroyed rather than paused: a paused stream may go on
      // reading, as a pipe on Windows does, and keep the process alive.
      close: () => {
        if (stdin instanceof tty.ReadStream) {
          leaveRawMode(stdin)
        }
        stdin.destroy()
      }
    }
  }
  const platform = options.platform ?? process.platform
  for (const path of keyboardPaths(platform)) {
    const keyboard = openDevice(path, platform)
    if (keyboard !== undefined) {
      return keyboard
    }
  }
  return undefined
}

export { keyboardPaths, openKeyboard }
export type { Keyboard, KeyboardOptions }
