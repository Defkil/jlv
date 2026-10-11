# jlv 2 phase 5 results

Measured on 2026-10-11 for plan §8 phase 5: streaming inputs, the bounded store, standard
input, the keyboard from the terminal, follow and save. The decisions that later phases
must apply are summarized in plan §0.13. Scratch scripts, the generated fixture and the
downloaded runtimes lived in a temporary directory outside the repository and were deleted
afterwards.

## Environment

- Windows 11 Home on ARM64, 12 logical processors, 16 GiB RAM.
- Node 26.10.0 installed locally; Node 22.9.0, 22.23.3 and 24.21.0 from the official
  `win-arm64` zips, each checked against its `SHASUMS256.txt`.
- pnpm 12.9.1, typescript 6.0.3, eslint 10.12.0.

## What phase 5 built

| Module | Role |
| --- | --- |
| `src/input/lines.ts` | Byte framing of records: LF and CRLF, a byte order mark at the start, chunk boundaries anywhere, lines over 1 MiB dropped to the next line feed with one diagnostic |
| `src/input/files.ts` | Literal paths, tinyglobby patterns, `-` and standard input, deduplication by file identity, source identifiers and labels |
| `src/input/follow.ts` | Polling follow every 500 ms: append, truncation, rotation, absent and recreated paths |
| `src/store.ts` | The bounded store: an off-heap byte ring with typed-array slots, 50,000 records and 64 MiB by default |
| `src/tui/record-view.ts` | The visible order, computed once per data and query revision and merged incrementally while records arrive |
| `src/application.ts` | Lanes, merge and backpressure, the viewer and machine output lifecycles, signals and exit codes |
| `src/output.ts` | Plain text and JSON lines, the writer that waits for a slow destination, the save file |
| `src/terminal.ts` | The keyboard independent of standard input: stdin, `/dev/tty`, `\\.\CONIN$`, `\\?\GLOBALROOT\Device\ConDrv\Input` |

`src/log.ts` keeps the legacy rows and the `~/.json-log-viewer` mapping, now read once per
run, and gains `parseLine()`, `parseEntry()` and the transition time key `timeKey()`.
`src/cli.ts` only parses arguments, prints help, version and usage errors, and sets the
exit code that `runApplication()` returns.

## Runtime dependencies

tinyglobby 0.2.17 joins neo-blessed 0.2.0 and ini 6.0.0. Its graph adds fdir 6.5.0 and
picomatch 4.0.7. All three are MIT and have no install, prepare or gyp scripts and no
native code; the lockfile already held the same versions through the development tools.
`pnpm audit --prod` and `pnpm audit` report no advisories. fdir's declarations import
picomatch, which ships none, so @types/picomatch 4.0.3 is a development dependency and
`skipLibCheck` stays off.

## One million records

Fixture as in phase 0: 1,000,000 JSON lines of exactly 512 bytes (512,000,000 bytes),
timestamps mostly increasing with up to 5 s of jitter; the last record is one hour newer
than all others. The real `runApplication()` of the emitted tree shows the file in the
viewer on a headless 120x40 terminal with the default limits and the default order
(`-timestamp`). *First record* is the time until a record's text reaches the terminal,
*whole file* the time until the newest record, which sorts first only once the file has
been read, reaches it. *Peak RSS* is `process.resourceUsage().maxRSS`, *heap* is
`heapUsed` after a forced collection once the file is shown. One run each, with the file
in the operating system's cache; the first run after generating the file took 348 ms to
the first record and 2,619 ms for the whole file on Node 26.10.0.

| Node | First write to the terminal | First record | Whole file | Peak RSS | RSS at the end | Heap after GC | Arena |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22.9.0 | 72 ms | 100 ms | 2,609 ms | 133.1 MiB | 112.9 MiB | 9.5 MiB | 33.5 MiB |
| 22.23.3 | 67 ms | 97 ms | 2,421 ms | 133.9 MiB | 115.6 MiB | 9.8 MiB | 33.5 MiB |
| 24.21.0 | 62 ms | 88 ms | 2,464 ms | 163.9 MiB | 147.7 MiB | 10.1 MiB | 33.7 MiB |
| 26.10.0 | 65 ms | 87 ms | 2,307 ms | 175.9 MiB | 162.2 MiB | 10.3 MiB | 33.7 MiB |
| 26.10.0, two more runs | 50 to 51 ms | 66 to 67 ms | 1,818 to 1,841 ms | 164.3 to 167.1 MiB | 153.9 to 154.7 MiB | 9.2 to 10.2 MiB | 33.7 MiB |

Both targets of plan §8 phase 5 hold on all four runtimes: under 256 MiB peak RSS, and the
first visible update well under 1 s. The store keeps 50,000 of 1,000,000 records (count
limit first; 25.6 MB of record bytes in a 32 MiB ring). For comparison, phase 0 measured
the upstream loader at 2.7 to 3.3 GiB and 30 to 37 s, retaining parsed records at 238 to
277 MiB, and its arena spike at 127 to 131 MiB with 1.35 to 2.38 s for the whole file. The
viewer here does more per record than that spike: the legacy parse and mapping, the time
key, and the ordered view that refreshes ten times per second while the file loads; the
first write includes Windows' `cls` that blessed runs when it enters the screen.

## Slow output and abort

Plain JSON lines of the same fixture into an output that takes about one KiB per
millisecond (each chunk waits `length / 1024` ms), SIGINT after 3 s, with `fs.read`
wrapped to count the bytes the file stream read:

| Node | Read in 3 s | Written in 3 s | Read after SIGINT | Exit code | Return after SIGINT | Active handles after | Peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22.9.0 | 3,407,872 bytes | 3,145,728 bytes | 0 | 130 | 181 ms | none | 52.8 MiB |
| 22.23.3 | 3,407,872 bytes | 3,145,728 bytes | 0 | 130 | 222 ms | none | 53.2 MiB |
| 24.21.0 | 3,407,872 bytes | 3,145,728 bytes | 0 | 130 | 179 ms | none | 61.4 MiB |
| 26.10.0 | 3,407,872 bytes | 3,145,728 bytes | 0 | 130 | 198 ms | none | 69.3 MiB |

The input runs one 256 KiB chunk ahead of the output and stops reading at SIGINT. The
return after SIGINT is the time the slow output needs for the chunk it already took; the
process then ends by itself. The in-process test `reads from a live input only as fast as
a slow output takes the records` shows the same for standard input: a producer offering
64 MiB gets fewer than 2 MiB accepted while the output is slow.

## Test matrix

`node .test-dist/scripts/run-tests.js` with the test build of Node 26.10.0, on the final
tree, twice per runtime. The durations spread because other work shared the machine.

| Runtime | Tests | Passed | Skipped | Failed | Durations |
| --- | --- | --- | --- | --- | --- |
| 22.9.0 | 260 | 258 | 2 | 0 | 13.6 s, 34.0 s |
| 22.23.3 | 260 | 258 | 2 | 0 | 18.2 s, 35.1 s |
| 24.21.0 | 260 | 258 | 2 | 0 | 28.3 s, 17.9 s |
| 26.10.0 | 260 | 258 | 2 | 0 | 26.3 s, 10.4 s |

The two skipped tests are POSIX-only: SIGINT to a spawned command line (Windows has no
signals to send) and an input without read permission (Windows has no permission bits for
it). `pnpm run typecheck`, `pnpm run lint` and `pnpm test` passed for every phase 5 commit
on Node 26.10.0. The matrix found one test that failed only on Node 22.9.0 (a directory
created at the name of a deleted file that was still open; see the gotchas), fixed in the
test.

The lifecycle proof of phase 4 with `JLV_LIFECYCLE_CYCLES=10000` passed on Node 26.10.0
with the store-backed panel: the census of nodes, keyable and clickable elements, focus
history and listeners was unchanged after 10,000 cycles of navigation, renders, resizes and
dialogs (277.8 s; 228.7 s in phase 4, the panel now parses its viewport rows on every
render), and the order was computed once per data or query revision, never for a cursor
move (17.1 s for 2 x 10,000 moves and the sort and filter changes; 13.2 s in phase 4).

## Proofs of plan §8 phase 5

| Proof | Where |
| --- | --- |
| Spawned CLI with delayed input, EOF, Ctrl-C and EPIPE | `cli.test.ts`: standard input before it ends, EOF of a pipe, Ctrl-C with 130 in the viewer, SIGINT with 130 (POSIX), a reader that goes away (50,000 records) and a followed output whose reader goes away |
| No console means plain output, never a hung raw mode | `cli.test.ts`: a detached child (no console on Windows, no controlling terminal on POSIX) falls back to plain output and fails at once for `--output tui` |
| Every byte split of a multibyte/CRLF sample, final line, oversized line | `input-lines.test.ts`: every split into two and three chunks and one-byte chunks; a 5 MiB line without line feeds holds at most 1 MiB |
| Glob, literal, dash, spaced and Windows paths | `input-files.test.ts` |
| Two-file timestamp order in the retained view | `record-view.test.ts` (`merges two sources by time within the retained records`), `application.test.ts` (two files in the viewer) |
| Rotation, truncation and missing paths | `input-follow.test.ts`, `application.test.ts` (follow through an append and a rotation) |
| Slow sink and backpressure | `output.test.ts`, `application.test.ts`, and the measurement above |
| Bounded-store counts and selection by ID | `store.test.ts`, `viewer-live.test.ts` |
| Records before stdin EOF; all resources stop on abort | `application.test.ts` |
| Help, version and config errors without a screen | `cli.test.ts`, `application.test.ts` |
| Save: exclusive creation, input collision, complete export | `application.test.ts`, `cli.test.ts` |
| One million records under 256 MiB and the first update under 1 s | the benchmark above |

## Behavior that changed

Each change has a named test and is explained in its commit.

- Records without a valid time sort last in both directions; equal values keep their
  arrival order in both directions (plan §5). Upstream reversed the stable ascending sort.
  A valid time is a finite number (epoch milliseconds) or RFC 3339 text with a zone; naive
  dates such as Monolog's sort last.
- Missing cells (undefined or null) show as empty. Upstream printed `undefined` after
  measuring it as empty, so such rows wrapped and could push the last record below the
  viewport.
- The status line reports `loading` or `live`, `kept <retained> of <seen>` and the numbers
  of skipped lines and failed inputs; the characterization log shows `3 skipped`.
- The sort picker offers `arrival`; files default to `-timestamp`, pipes and `--follow` to
  `arrival`, and a cursor at the newest end follows new records.
- `q` emits `quit`; Ctrl-C ends with 130 instead of 0; `-s` is `--save`, not sort.
- The mapping file is read once per run; an unreadable one is an error with 2 instead of
  silently dropping every line; a byte order mark no longer costs the first line.
- A long input name is cut at its start in the border label instead of wrapping over the
  first row.

## Gotchas found on the way

- blessed places a border label one cell further left when it creates it than when it
  changes it later; the panel creates its label at once.
- blessed redraws only the cells that change and moves the cursor over blank cells, so
  screen output in tests is compared without spaces and only for text that appears whole.
- A paused piped standard input keeps reading on Windows and keeps the process alive; the
  keyboard destroys standard input when it closes.
- blessed's own SIGINT and SIGTERM handlers call `process.exit` while they are the only
  listeners; the application's listeners keep them quiet.
- Node 22.9.0 deletes with libuv 1.48.0, without POSIX delete semantics: Windows keeps the
  name of a deleted file while a handle is open. A writer that deletes its followed log
  that way cannot create the name again until the next poll has closed jlv's handle.
  libuv 1.51 and later (Node 22.23.3, 24.21.0, 26.10.0) delete with POSIX semantics.
