# jlv 2 phase 0 results

Measured on 2026-10-11 for plan §8 phase 0. All spike code ran in a scratch directory
outside the repository; none of it is part of the product. The decisions that later
phases must apply are summarized in plan §0.9.

## Environment

- Windows 11 Home on ARM64, 12 logical processors, 16 GiB RAM.
- Node 22.9.0, 22.23.3 (latest 22) and 24.21.0 (latest 24) from the official `win-arm64`
  zips, each checked against its `SHASUMS256.txt`; Node 26.10.0 installed locally.
- pnpm 12.9.1, typescript 6.0.3, @types/node 22.20.5 (latest 22.x, forced for every
  package with a pnpm override), @types/blessed 0.1.27, blessed 0.1.81, neo-blessed
  0.2.0, eslint 10.12.0, neostandard 0.14.0, typescript-eslint 8.71.1,
  eslint-plugin-unicorn 77.0.0.

## 0.1 Typed widget boundary

What ran:

- A `neo-blessed` declaration shim built on @types/blessed and one boundary module: the
  screen factory, typed factories for element, list, prompt and question, keypress
  normalization, normalized list, prompt and question callbacks, size narrowing, color
  depth and logical screen cells.
- Typed equivalents of BaseWidget, MainPanel, Picker, LogDetails and StatusLine written
  only against that boundary.
- The unchanged upstream widgets (MainPanel and StatusLine, which open LogDetails and
  Picker) on a screen created through the same boundary factory, once on blessed 0.1.81
  and once on neo-blessed 0.2.0.
- Headless terminals: a `PassThrough` input that receives real escape sequences and a
  `Writable` output with `columns`, `rows` and `isTTY`; resize through the output's
  `resize` event.

Results:

- 15 of 15 headless tests passed on 22.9.0, 22.23.3, 24.21.0 and 26.10.0: rendering,
  arrows through the input stream, wide characters, picker selection and Escape, prompt
  submission and Escape, question answers, details with the JSON toggle, resize from
  80x24 to 100x30, a stable child count over 100 renders, and the upstream widgets on
  both backends.
- `tsc` with every §4.2 flag and `skipLibCheck: false` reported zero errors. The
  boundary uses no `any`, no `as any`, no double assertion and no `@ts-ignore`.

Findings:

1. @types/blessed swaps both stream directions in `IScreenOptions`: `input` is declared
   `Writable` and `output` `Readable`. The plan only corrected `output`. Duplex streams
   (TTY streams, `PassThrough`) hide the error; a plain `Readable` input fails with
   TS2345. The shim corrects both.
2. @types/blessed declares no runtime `Box` constructor and no `element()` factory,
   although upstream uses both (`extends blessed.Box`, `blessed.element()`). Its
   `Widgets.BoxElement` class does not exist at runtime. The shim adds
   `Box: typeof blessed.Widgets.BoxElement` and
   `element(options?: blessed.Widgets.BoxOptions): blessed.Widgets.BoxElement`. For the
   faithful port on blessed 0.1.81, a module augmentation of `'blessed'` with the same
   three declarations (`Box`, `element`, a corrected `screen` overload) compiled strictly
   and ran.
3. Declared types that differ from runtime values, normalized in the boundary: the
   prompt callback receives `null` on Escape (declared `string`); `question.ask` passes a
   boolean (declared `string`); keypress `ch` is `undefined` for non-printable keys
   (declared `string`); callback errors are `any`; element and screen `width`/`height`
   are declared `number | string` but are computed numbers at runtime.
4. Once more than one screen exists in a process, blessed binds an element created
   without `screen` or `parent` to the newest screen and throws asynchronously if it is
   not appended at once ("was not appended synchronously after the screen's creation").
   Upstream creates such parentless elements. Tests therefore keep exactly one live
   screen per process (create it in `before`, destroy it in `after`), and ported widgets
   should pass `screen` or `parent` explicitly.
5. The prompt starts listening for keys on the next tick; tests must wait a turn before
   typing.
6. With `fullUnicode: true`, wide characters take two cells and emoji survive. With
   `fullUnicode: false`, emoji are not rendered. Unicode detection depends on the
   environment (`NCURSES_UNICODE` in blessed, `NCURSES_NO_WINDOWS_UNICODE` in neo-blessed,
   `LANG` on POSIX), so tests pass `forceUnicode` explicitly.
7. Color depth comes from the bundled terminfo: `xterm-256color` gives 256 colors and
   `xterm` 8. Tests choose the terminal explicitly.
8. Upstream behaved the same on both backends for every exercised path: newest-first
   initial render, details, level filter, and one more panel child per render.
9. The default ESM import of the CommonJS backend (`import terminalLibrary from
   'neo-blessed'`) works on all four runtimes.

## 0.2 Keyboard input with a live pipe

The interactive check is not run by implementers (plan §0.7); see
[manual-terminal-checklist.md](manual-terminal-checklist.md). Headless evidence from the
console probe in that checklist:

| Runtime | stdin is a live pipe, hidden console present | Detached child, no console |
| --- | --- | --- |
| 22.9.0 | `\\.\CONIN$` fails (`UNKNOWN`); the ConDrv fallback opens, `isatty` holds, raw mode is set and restored | both paths fail (`UNKNOWN`, `EBADF`); plain fallback reported after 95 to 130 ms |
| 22.23.3 | `\\.\CONIN$` opens; raw mode set and restored | both fail with `EBADF`; fallback after 100 ms |
| 24.21.0 | `\\.\CONIN$` opens; raw mode set and restored | both fail with `EBADF`; fallback after 106 ms |
| 26.10.0 | `\\.\CONIN$` opens; raw mode set and restored | both fail with `EBADF`; fallback after 100 to 145 ms |

The research note in plan §3.4 (CONIN$ fails on 22.18) needs one correction for the 22
line: the latest 22 release opens `\\.\CONIN$` directly, while 22.9.0 still needs the
ConDrv fallback. In every case the process ended by itself after the pipe closed.

## 0.3 Bounded retention benchmark

Fixture: 1,000,000 generated JSONL records of exactly 512 bytes each (512,000,000 bytes),
timestamps mostly increasing with up to 5 s of jitter. Headless 120x40 screen. Each
scenario ran in its own process with `--expose-gc`. *Peak RSS* is the operating system's
peak working set (`process.resourceUsage().maxRSS`), which also covers synchronous
phases. *Heap after GC* is `heapUsed` after a forced collection at the end. Ingest times
varied by up to about 30 % between identical runs on this machine; the table shows single
runs.

| Scenario | Node | Input to first render | Full ingest | Peak RSS | Heap after GC | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline: upstream `readLog` and MainPanel on blessed 0.1.81 | 26.10.0 | 29,994 ms | synchronous, included | 3,328 MiB | 1,032 MiB | a cursor move took 120 ms on average over 50 moves; 53 panel children afterwards |
| Baseline | 22.9.0 | 37,096 ms | synchronous, included | 2,679 MiB | 1,031 MiB | 170 ms per cursor move |
| Baseline with 1,100,000 records (563,200,000 bytes) | 26.10.0 | fails | fails | | | `Cannot create a string longer than 0x1fffffe8 characters` |
| Proposed: streamed framing, last-ingested parsed records under 50,000 / 64 MiB, at most 10 redraws per second, one newest-first sort of the retained window at EOF (neo-blessed) | 26.10.0 | 9 to 12 ms | 1,343 to 1,774 ms | 274 to 277 MiB | 37.5 MiB | 50,000 retained (24.4 MiB estimated), 950,000 evicted; final sort 15 to 20 ms |
| Proposed, parsed records | 22.9.0 | 11 ms | 2,134 ms | 238 MiB | 37.2 MiB | final sort 18 ms |
| Proposed, raw line strings instead of parsed records | 26.10.0 | 11 ms | 2,213 ms | 277 MiB | 37.4 MiB | no gain |
| Proposed, off-heap arena: one 64 MiB `Buffer` ring plus a typed-array index; only the viewport is parsed | 26.10.0 | 9 ms | 1,352 ms | 130 MiB | 8.7 MiB | final sort 9 ms |
| Proposed, off-heap arena | 22.9.0 | 18 ms | 2,377 ms | 127 MiB | 8.0 MiB | |
| Proposed, off-heap arena with 1,100,000 records | 26.10.0 | 18 ms | 2,192 ms | 131 MiB | 8.7 MiB | the baseline cannot open this file |
| Proposed, parsed records, cap of 1 / 10,000 records | 26.10.0 | 8 / 10 ms | 1,100 / 1,215 ms | 74 / 129 MiB | 8.5 / 14.6 MiB | an idle process with a neo-blessed screen uses 50 MiB |

Slow output and cancellation (plain JSONL output to a sink that accepts one chunk per
millisecond, aborted after 3 s):

| Scenario | Node | Read in 3 s | Written | Peak RSS | Abort latency | After the abort |
| --- | --- | --- | --- | --- | --- | --- |
| `stream.pipeline(file, framer, sink, { signal })` | 26.10.0 | 458,752 bytes | 34,741 bytes | 41 MiB | 3.8 ms | source destroyed and closed, no active handles, process exits by itself |
| `stream.pipeline(file, framer, sink, { signal })` | 22.9.0 | 393,216 bytes | 32,969 bytes | 37 MiB | 3.2 ms | one pending 1 ms sink timer, then the process exits by itself |
| `write()` results ignored (anti-pattern) | 26.10.0 | 512,000,000 bytes (all) | 200,243 bytes | 379 MiB | 0.8 ms | memory grows with the input |
| Viewer ingestion aborted after 300 ms | 26.10.0 | 138,752 records | | 191 MiB | 2 ms | file stream destroyed; process ended 718 ms after start |

Conclusions:

- Bounded retention shows the first records after 9 to 18 ms instead of 30 to 37 s and
  peaks at 127 to 277 MiB instead of 2.7 to 3.3 GiB. The upstream loader cannot open files
  beyond V8's maximum string length (about 512 MiB) at all.
- With the default limits, retaining parsed records misses the phase 5 target of 256 MiB
  on 26.10.0 (274 to 277 MiB) and meets it on 22.9.0 (238 MiB). The live set is only
  37 MiB; the rest is garbage-collector slack from records that are promoted and evicted
  later. Raw strings do not help. The off-heap arena does (127 to 131 MiB) at the same
  latency. Phase 5 should build the store as an arena or re-measure any alternative with
  this fixture.
- `stream.pipeline` keeps reading within the stream high-water marks against a slow sink
  (at most 448 KiB read in 3 s), and an `AbortSignal` stops file reading within 4 ms
  without leaving handles. Ignoring `write()` reads the whole file within 3 s and reaches
  379 MiB.

## 0.4 Flat ESLint configuration

- `eslint.config.js` per §4.3 with the §0 changes. Node 22 API checks on 22.9.0 and
  22.23.3: `Array.fromAsync` resolved `[1,2]`; iterator `map`/`filter`/`toArray` gave
  `[4,6]`; a `Set` iterator's `toArray()` gave `[1,2]`; `take(2).toArray()` gave `[5,6]`;
  `Promise.withResolvers` resolved. `Promise.try` and `Iterator.zip` are `undefined` on
  both. `Promise.try` exists from 24.21.0; `Iterator.zip` is missing on 24.21.0 and
  26.10.0 as well. Set methods exist on 22; `RegExp.escape` and `Float16Array` do not.
- `--print-config` for the CLI, the boundary, the declaration shim, a test, the test
  runner script and the config itself: the five newer-runtime rules resolve to `error`;
  `prefer-promise-try` and `prefer-iterator-zip` are `off`; `no-null` is off only in the
  boundary, test and fixture scope; `no-top-level-side-effects` is off only for
  `eslint.config.js`; `name-replacements` is on and the deprecated `prevent-abbreviations`
  is not configured; the typed rules (`no-explicit-any`, `no-floating-promises`,
  `no-misused-promises`, `no-unsafe-*`) apply to TypeScript files.
  `no-unsafe-type-assertion` is not part of `strictTypeChecked`.
- Representative files (the §5 API block, a shebang CLI, a library module, the boundary,
  the declaration shim, the typed widgets, a `node:test` file, the test runner script and
  the config itself) lint with zero errors and warnings under `--max-warnings 0` with
  unused-directive reporting on 26.10.0, 24.21.0 and 22.23.3. ESLint cannot start on
  22.9.0 (`ERR_REQUIRE_ESM` inside neostandard, whose engines require ^22.13); `tsc` runs
  there. The first `--fix` pass fixed one padding error; the second and third passes
  changed no file.
- A strict consumer project (TypeScript 6.0.3 and @types/node 22.20.5 only,
  `skipLibCheck: false`, no @types/blessed installed) compiled a custom `LogFormat` and
  `FormatPlugin` and called a public function that uses the terminal boundary
  internally. The compiler loaded only `api.d.ts`, `summary.d.ts` and `index.d.ts` from
  the package, and the compiled consumer rendered through neo-blessed. The internal TUI
  declarations do reference `blessed`, so the package `exports` map must never expose
  them.

Lint findings for the next phases:

1. `@typescript-eslint/no-floating-promises` reports every `describe`, `it`, `before` and
   `after` call of `node:test`. For test files, `allowForKnownSafeCalls` with
   `{ from: 'package', package: 'node:test', name: [...] }` removes all of these reports
   and keeps the rule for real promises. It needs a one-line justification like every
   local rule change.
2. `unicorn/no-incorrect-template-string-interpolation` reports blessed tags such as
   `{bold}` inside template literals. The rule skips tagged templates. Phase 3 chooses
   between a scoped TUI exception with a justification (verified) and a small tagged
   template helper for trusted markup, which phase 7 could extend to escape interpolated
   values.
3. Recommended Unicorn rules the faithful port will meet: `no-exports-in-scripts` (a
   file with a shebang must not export, so `cli.ts` stays export-free),
   `consistent-boolean-name` (boolean names and predicates need prefixes such as `is`,
   `has` or `should`), `consistent-class-member-order` (private members first),
   `prefer-number-coercion` (it rewrites `parseInt(value, 10)`, but upstream's go-to-line
   relies on `parseInt` prefix parsing; keep that behavior with a justified exception or
   a named behavior test), `import-style` (default import of `node:path`),
   `prefer-global-number-constants` and `prefer-unicode-code-point-escapes`.
4. TypeScript `lib` for the Node 22 floor: `["ES2024", "ES2025.Collection",
   "ES2025.Iterator", "ESNext.Array"]` with `target` still `ES2022`. It types exactly the
   APIs that the dropped Unicorn exceptions now ask for and keeps `Promise.try`
   (`es2025.promise`), `RegExp.escape` (`es2025.regexp`) and `Float16Array`
   (`es2025.float16`) out.
