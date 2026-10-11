# Manual terminal checklist

Keyboard input while stdin is a live pipe cannot be proven by headless tests or by
Linux CI. This checklist covers that gap (plan §0.7, §8 phase 0 step 2 and phase 5).
The coordinator runs it with Oliver; implementers do not run it and nothing in the
automated gates waits for it.

There are two parts:

- **Part A, console probe.** Run it now. It answers the phase 0 question with a
  standalone script: can a Node process read keys from the console while its stdin is
  a pipe, on every supported runtime, and does it restore the terminal afterwards?
- **Part B, release gate.** Run it against the viewer itself before the release. Phase
  5 built everything it checks: live pipes, the keyboard from the console, follow, save
  and the plain fallback.

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

## Part B: release gate

Run once per runtime, against the packed package as users install it. In the repository,
pack the tarball and keep the scratch project that the package check installs it into:

```powershell
pnpm run check:package -- --keep
```

The last line names the kept directory; `jlv` is installed in its `project` folder. Set the
variables once:

```powershell
$jlv = "$env:TEMP\jlv-package-check-<suffix>\project\node_modules\jlv\dist\cli.js"
$ticks = "let n = 0; setInterval(() => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'tick ' + n++ })), 500)"
$burst = "for (let n = 0; n < 200000; n++) console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'record ' + n }))"
```

In the steps, `<ticks>` stands for `& $node -e $ticks` and `<viewer>` for
`& $node $jlv`. The status line names what the viewer knows about the input: `live`
while records still arrive, `loading` while files are read, `kept <retained> of <seen>`
once the store evicts, and the numbers of skipped lines and failed inputs.

1. **Keys with a live pipe.** `<ticks> | <viewer>`: records appear before the producer
   ends, newest at the bottom (arrival order). Arrows, PageUp, PageDown, `0`, `$`,
   Enter (details), `j` and Escape in the details, `/` with text and Enter (search),
   `s` and `l` (pickers) all work; resizing the window relayouts the screen while
   records keep arriving. Note which console path the runtime uses; Part A lists them.
2. **Following the newest record.** In step 1, leave the cursor on the last row: it
   moves to each new record. Press Up: the cursor stays on its record while new ones
   arrive below. Press `$`: it follows again.
3. **Ctrl-C.** `<ticks> | <viewer>`, then Ctrl-C: `$LASTEXITCODE` is 130, the
   alternate screen is left, the cursor is visible, and the prompt echoes and edits
   normally (raw mode restored). Repeat with `q`: exit code 0, same terminal state.
4. **Input that ends.** `& $node -e "console.log('{}'); console.log('{}')" | <viewer>`:
   the viewer stays open, `live` disappears from the status line, and `q` ends it.
5. **Eviction.** `& $node -e $burst | <viewer>`: the status line reaches
   `kept 50000 of 200000`; the keys stay responsive while the records arrive; Task
   Manager shows the process well below 256 MiB.
6. **Follow.** Create a log with a few records and run `<viewer> --follow app.log`. In a
   second tab:
   - append records with `Add-Content app.log '{"level":"info","message":"appended"}'`;
   - rotate with `Rename-Item app.log app.log.1`, then `Add-Content app.log.1 '{"message":"late"}'`
     and `Set-Content app.log '{"message":"new file"}'`;
   - truncate with `Clear-Content app.log`, then add a record;
   - delete the file, wait a second, and create it again.

   Each change appears within about half a second; the late record of the renamed file
   appears before the records of the new file. `q` ends the viewer at once.
7. **Save.** `<ticks> | <viewer> --save $env:TEMP\saved.jsonl`, quit after a few records:
   the file holds one JSON line per record shown. Run it again: it fails at once with
   exit code 2 and `the file exists; --overwrite replaces it`; with `--overwrite` it
   runs. `<viewer> app.log --save app.log --overwrite` is refused with exit code 2.
8. **Plain output on a terminal.** `<ticks> | <viewer> --output plain`: one line per
   record as it arrives; Ctrl-C ends with 130 and leaves the prompt intact.
   `<viewer> app.log --output jsonl` writes JSON lines and ends with 0.
9. **No console.** Start the viewer as a detached child, which has no console, with
   piped standard input; it writes plain output and exits, and never waits for a key:

   ```powershell
   & $node -e "const c = require('node:child_process').spawn(process.argv[1], process.argv.slice(2), { detached: true, stdio: 'pipe', windowsHide: true }); c.stdout.pipe(process.stdout); c.stderr.pipe(process.stderr); c.stdin.end(JSON.stringify({ message: 'piped' }) + '\n'); c.on('exit', code => console.log('exit', code))" $node $jlv
   ```

   Expected: `- - piped` and `exit 0` within about a second. With `--output tui` added
   after `$jlv`, the child fails at once with `exit 1` and `the viewer needs a terminal`.
10. **Records typed into the terminal.** `<viewer> -` and type a JSON line, then Ctrl-Z
    and Enter: the line comes back as plain output; `--output tui` refuses with exit
    code 1 because standard input is the terminal.
11. **Linux.** In the Linux terminal repeat steps 1, 3, 6 and 9 with `/dev/tty` as the
    keyboard; `echo '{}' | setsid -w node cli.js` shows the plain fallback without a
    controlling terminal.
12. **Formats and configuration.** In the repository's `docs\examples`, run
    `<viewer> pino.log orders.csv container.log`: the status line shows
    `format: pino, csv, docker`, the level column shows `info` to `fatal` instead of pino's
    numbers, `l` offers the seven levels, and `s` with `level` sorts by severity. With
    `<viewer> -c monolog.config.json monolog.log` the status line shows
    `config: monolog.config.json` and the times show in UTC; `<viewer> broken.log` shows
    `2 skipped | 1 warning`.
13. **Filters, correlation, keys and text.** In `docs\examples`, run
    `<viewer> -c profiles.config.json pino.log`: `f` offers `add a filter` and the profiles
    `problems` and `api-1 errors`; `p` applies `problems`, and the status line shows
    `filters: profile problems`. `f`, `a`, `m`, `slow` and Enter adds a filter; `f` then lists
    `remove ...` for each filter and `clear all filters`. `?` shows the keys, scrolls with
    PageDown and closes with `q`. With
    `<viewer> ..\..\packages\format-fixtures\fixtures\legacy-viewer\characterization.log`
    the identifiers `req-NN` show in colors; `c` on a record shows only that record, `c`
    again shows all, and the cursor stays on the record. Open the search with `/` and press
    Ctrl-C: the viewer ends with exit code 130 and the prompt is restored. Finally
    `& $node -e "console.log(JSON.stringify({ level: 'info', message: '\u001b]0;pwned\u0007\u001b[31mred {bold}x' }))" | <viewer>`:
    the window title stays as it was, and the message shows `red {bold}x` without color.
14. **Wide characters.** The viewer draws CJK in two cells per character, combines
    combining marks with the character before them and shows emoji as `?`; headless
    tests prove that blessed and jlv agree on the cells, and this step proves that the
    terminal agrees too. Write a log with CJK, emoji, decomposed umlauts and a flag:

    ```powershell
    & $node -e "for (const m of ['漢字のログ ok', 'deployed 🚀 ✅ done', 'Grüße und Mäuse', 'flag 🇩🇪 heart ❤️', 'ＡＢＣ 한국어']) console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: m, note: m }))" > wide.log
    ```

    Then `<viewer> wide.log`: the CJK, fullwidth and Hangul characters show as
    themselves, the emoji and the flag as `?`, the heart as a plain `❤`, and `Grüße und
    Mäuse` with its umlauts. In every row the level column starts in the same column
    and the panel's right border stays in the last column, also after resizing the
    window to a narrow width and back; nothing smears when the cursor moves over the
    rows. Enter on a record and `j` show the same text in the details. On Linux, repeat
    with `LANG=C`: the CJK characters show as `??` and the rows still line up.

### Record, Part B

| Runtime | Console path | Keys (1) | Follow newest (2) | Ctrl-C and q (3) | Input ends (4) | Eviction (5) | Follow (6) | Save (7) | Plain (8) | No console (9) | Typed (10) | Formats (12) | Filters (13) | Wide (14) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22.9.0 | | | | | | | | | | | | | | |
| 22.x latest: | | | | | | | | | | | | | | |
| 24.x latest: | | | | | | | | | | | | | | |
| 26.x latest: | | | | | | | | | | | | | | |
| Linux, Node: | | | | | | | | | | | | | | |

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
