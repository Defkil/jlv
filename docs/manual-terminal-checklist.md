# Manual terminal checklist

Keyboard input while stdin is a live pipe cannot be proven by headless tests or by
Linux CI. This checklist covers that gap (plan §0.7, §8 phase 0 step 2 and phase 5).
The coordinator runs it with Oliver; implementers do not run it and nothing in the
automated gates waits for it.

There are two parts:

- **Part A, console probe.** Run it now. It answers the phase 0 question with a
  standalone script: can a Node process read keys from the console while its stdin is
  a pipe, on every supported runtime, and does it restore the terminal afterwards?
- **Part B, release gate.** Run it after phase 5, against `jlv` itself, before the
  release.

Headless results that already exist are recorded in
[v2-phase-0-results.md](v2-phase-0-results.md#02-keyboard-input-with-a-live-pipe).

## Setup

- Windows 11 on ARM64, Windows Terminal, a PowerShell 7 tab. Do not use the legacy
  console host or a terminal inside an IDE.
- Node runtimes: 22.9.0, the latest 22.x, the latest 24.x and the latest 26.x. Download
  the official `win-arm64` zips, check each against the release's `SHASUMS256.txt`, and
  extract them outside the repository, for example to `$env:TEMP\jlv-node\<version>`.
- A Linux terminal for the comparison rows, for example a WSL Ubuntu tab in Windows
  Terminal or any Linux machine with a real terminal.
- Save the probe from the end of this file as `$env:TEMP\jlv-console-probe.mjs`. Keep it
  outside the repository.

In PowerShell, set the runtime under test once per round:

```powershell
$node = "$env:TEMP\jlv-node\22.9.0\node-v22.9.0-win-arm64\node.exe"
$probe = "$env:TEMP\jlv-console-probe.mjs"
```

## Part A: console probe

Run every step with each of the four runtimes.

1. **Keys with a live pipe.** The producer writes a line every 500 ms, so the pipe stays
   open while you type:

   ```powershell
   & $node -e "let n = 0; setInterval(() => console.log(JSON.stringify({ n: n++, msg: 'tick' })), 500)" | & $node $probe
   ```

   Expected:
   - `console input:` names `\\.\CONIN$` or the fallback
     `\\?\GLOBALROOT\Device\ConDrv\Input`. Note which one.
   - Up, Down, Left, Right, PageUp, PageDown, Home, End, Enter and Escape each print
     their name once, without delay and without stray characters.
   - The `pipe lines so far` counter keeps growing between key presses, so the pipe and
     the keyboard are both live.
   - Resizing the window prints `resize <columns>x<rows>`.
   - `q` prints `RESULT quit; raw mode restored (isRaw=false)` and the process ends.
     `$LASTEXITCODE` is `0`.
2. **Ctrl-C.** Start step 1 again and press Ctrl-C.
   - The probe prints `RESULT Ctrl-C; raw mode restored (isRaw=false)` and ends with
     `$LASTEXITCODE` `130`.
   - Afterwards the prompt behaves normally: typed characters echo, the arrow keys
     recall history, Enter runs a command. This shows that raw mode was restored.
3. **Pipe ends first.** Use a producer that stops after three lines:

   ```powershell
   & $node -e "console.log('{}'); console.log('{}'); console.log('{}')" | & $node $probe
   ```

   - `pipe ended after 3 lines` appears.
   - Keys still print their names after that; `q` ends the probe cleanly.
4. **No console.** The probe starts itself as a detached child, which on Windows has no
   console at all:

   ```powershell
   & $node $probe --detached-check
   ```

   - Both console paths fail, the child prints `RESULT no controlling terminal`, and it
     exits within about one second. Nothing hangs and nothing waits for a key.
5. **Linux comparison.** In the Linux terminal, with a Node 22.9.0 or later binary for
   that system, repeat steps 1 to 3 with the same probe:

   ```sh
   node -e "let n = 0; setInterval(() => console.log(JSON.stringify({ n: n++ })), 500)" | node jlv-console-probe.mjs
   ```

   - `console input:` names `/dev/tty`; keys, resize, Ctrl-C (exit status 130) and `q`
     behave as on Windows.
   - Without a controlling terminal, the probe must report the plain fallback:

     ```sh
     echo '{}' | setsid -w node jlv-console-probe.mjs --auto-exit 3000
     ```

### Record

| Runtime | Console path | Keys (step 1) | Resize | Ctrl-C exit and restored prompt | Pipe ends first | No console |
| --- | --- | --- | --- | --- | --- | --- |
| 22.9.0 | | | | | | |
| 22.x latest: | | | | | | |
| 24.x latest: | | | | | | |
| 26.x latest: | | | | | | |
| Linux, Node: | | | | | | |

A runtime that fails a keyboard row may still ship, but only with the automatic plain
output for piped input on that runtime (plan §8 phase 0 acceptance). Write the decision
into plan §0 and the release notes.

## Part B: release gate (after phase 5)

Run with the packed `jlv` tarball installed globally or in a scratch project, once per
runtime. `<producer>` is the command from Part A step 1.

1. `<producer> | jlv`: records appear before the producer ends; arrows, PageUp,
   PageDown, Home, End, Enter (details), Escape (close details), `/` with typed text and
   Enter (search), and `q` all work; resizing relayouts the screen.
2. `<producer> | jlv`, then Ctrl-C: exit code 130, the cursor is visible, the alternate
   screen is left, and the prompt echoes and edits normally.
3. A producer that ends after a few lines: the viewer stays open with the final count
   and quits normally with `q`.
4. `jlv` started from a process without a console (as in Part A step 4): it chooses plain
   output, writes the records and exits; it never waits for a key.
5. Explicit `--output tui` without a usable console fails at once with a clear error
   message instead of hanging.
6. Repeat 1, 2 and 4 in the Linux terminal.

## Probe

```js
// jlv console probe: keyboard input from the controlling terminal while stdin is a live pipe.
//   <producer> | node jlv-console-probe.mjs [--auto-exit <ms>]
//   node jlv-console-probe.mjs --detached-check     (child process without a console)
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tty from 'node:tty'

const report = message => process.stderr.write(`[probe] ${message}\n`)
const option = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1] ?? ''
}

if (option('--detached-check') !== undefined) {
  const started = Date.now()
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--auto-exit', '3000'], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  child.stdin.end('{"n":1}\n{"n":2}\n')
  child.on('exit', code => {
    process.stderr.write(output)
    report(`detached child exited with ${String(code)} after ${Date.now() - started} ms`)
  })
} else {
  const autoExit = option('--auto-exit')
  const candidates = process.platform === 'win32'
    ? [String.raw`\\.\CONIN$`, String.raw`\\?\GLOBALROOT\Device\ConDrv\Input`]
    : ['/dev/tty']
  const openConsoleInput = () => {
    for (const path of candidates) {
      let descriptor
      try {
        descriptor = openSync(path, 'r+')
      } catch (error) {
        report(`open ${path} failed: ${error.code ?? error.message}`)
        continue
      }
      if (!tty.isatty(descriptor)) {
        closeSync(descriptor)
        report(`${path} opened but is not a TTY`)
        continue
      }
      return { path, descriptor }
    }
    return undefined
  }
  const names = new Map([
    ['\u001B[A', 'up'], ['\u001B[B', 'down'], ['\u001B[C', 'right'], ['\u001B[D', 'left'],
    ['\u001B[5~', 'pageup'], ['\u001B[6~', 'pagedown'], ['\u001B[H', 'home'], ['\u001B[F', 'end'],
    ['\u001B[1~', 'home'], ['\u001B[4~', 'end'], ['\r', 'enter'], ['\u001B', 'escape'], ['\u0003', 'ctrl-c'], ['q', 'q']
  ])

  report(`node ${process.version} ${process.platform}/${process.arch}; stdin isTTY=${String(process.stdin.isTTY ?? false)}, stdout isTTY=${String(process.stdout.isTTY ?? false)}`)
  let lines = 0
  let pipeEnded = false
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { lines += chunk.split('\n').length - 1 })
  process.stdin.on('end', () => {
    pipeEnded = true
    report(`pipe ended after ${lines} lines`)
  })

  const consoleInput = openConsoleInput()
  if (consoleInput === undefined) {
    report('RESULT no controlling terminal: an interactive viewer must fall back to plain output')
    process.stdin.destroy()
  } else {
    report(`console input: ${consoleInput.path}`)
    const input = new tty.ReadStream(consoleInput.descriptor)
    let finished = false
    let status
    const finish = (code, reason) => {
      if (finished) {
        return
      }
      finished = true
      input.setRawMode(false)
      const isRaw = input.isRaw
      input.destroy()
      process.stdin.destroy()
      clearInterval(status)
      report(`RESULT ${reason}; raw mode restored (isRaw=${String(isRaw)}); pipe lines so far=${lines}`)
      process.exitCode = code
    }
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.on('data', key => {
      const name = names.get(key) ?? JSON.stringify(key)
      report(`key ${name} (pipe lines so far: ${lines}${pipeEnded ? ', pipe ended' : ''})`)
      if (name === 'ctrl-c') {
        finish(130, 'Ctrl-C')
      } else if (name === 'q') {
        finish(0, 'quit')
      }
    })
    input.on('error', error => { finish(1, `console input error ${error.code ?? error.message}`) })
    process.stdout.on('resize', () => { report(`resize ${process.stdout.columns}x${process.stdout.rows}`) })
    status = setInterval(() => {
      report(`alive; pipe lines=${lines}; size=${process.stdout.columns ?? '?'}x${process.stdout.rows ?? '?'}`)
    }, 5000)
    report('press arrows, PageUp/PageDown, Home/End, Enter, Escape; resize the window; q quits, Ctrl-C interrupts')
    if (autoExit !== undefined) {
      setTimeout(() => { finish(0, 'auto-exit') }, Number(autoExit))
    }
  }
}
```
