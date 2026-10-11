# jlv 2 phase 4 results

Measured on 2026-10-11 for plan §8 phase 4: the dependency and backend swap, the lifecycle
and performance fix, the fork-derived fixes and the cleanup. The decisions that later phases
must apply are summarized in plan §0.12. Scratch scripts and downloads lived in a temporary
directory outside the repository and were deleted afterwards.

## Environment

- Windows 11 Home on ARM64, 12 logical processors, 16 GiB RAM.
- Node 26.10.0 installed locally; Node 22.9.0, 22.23.3 and 24.21.0 from the official
  `win-arm64` zips, each checked against its `SHASUMS256.txt`.
- pnpm 12.9.1, typescript 6.0.3, eslint 10.12.0.

## Backend parity

The emitted tree of the dependency commit (`eb8fe8b`) ran twice: once as built, on
neo-blessed 0.2.0, and once with the emitted boundary importing blessed 0.1.81 instead. A
probe confirmed which library each run loaded: with `NCURSES_FORCE_UNICODE=0` and
`forceUnicode: true`, neo-blessed reports no Unicode and blessed reports Unicode.

| Check | blessed 0.1.81 | neo-blessed 0.2.0 |
| --- | --- | --- |
| Test suite at that commit | 124 of 124 passed | 124 of 124 passed |
| Logical screens (attribute and character of every cell) after each step of five key scripts: the characterization fixture through navigation, go-to-line, search, sort, filters, details, resizes, wrap and pickers (38 steps); the upstream workflow-engine fixture (6); the empty log (2); numeric levels (2); wide characters, emoji and markup (4) | 52 screens | identical, 52 of 52 |
| Bytes written to the terminal per key script | 5 streams | identical, 5 of 5 |

The message of `eb8fe8b` counts these 52 screens and 5 byte streams together as 57.

## Dependencies and advisories

| Graph | Before (`a323467`, phase 3) | After |
| --- | --- | --- |
| Runtime dependencies of `packages/jlv` | blessed 0.1.81, blessed-contrib 4.8.6, ini 1.3.5, lodash 4.17.11, minimist 1.2.0 and the graph of blessed-contrib | ini 6.0.0, neo-blessed 0.2.0; no transitive packages |
| `pnpm audit --prod` | 23 advisories: 3 critical, 7 high, 12 moderate, 1 low | none |
| `pnpm audit` (whole workspace) | | none |
| Native code or install scripts in the runtime graph | | none: no `binding.gyp`, `.node`, `gypfile` or install, prepare or gyp scripts; the workspace install needs no build approval |

The critical and high advisories before included the prototype pollution of minimist below
1.2.6, of ini below 1.3.6 and of lodash, whose `omit` the log reader called. Two of them
were reproduced before the swap: `--__proto__.polluted yes` reached `Object.prototype`
through minimist 1.2.0, and so did a `[__proto__]` section through ini 1.3.5. Both are
regression tests now. neo-blessed declares a `bin` (`tput`), so installing jlv links a
`tput` script into a consumer's `node_modules/.bin`; phase 8 checks the packed package.

## Lifecycle bounds

`viewer-lifecycle.test.ts` with `JLV_LIFECYCLE_CYCLES=10000`. One cycle sends real key
sequences: three arrows, PageDown, PageUp, `$`, `0`, `G`, `A`; Enter, `j`, PageDown and
Escape in the details; the sort picker and the level picker, each closed with Escape; a
search without a match and its message; go-to-line cancelled; then a resize to 100x30 and
back to 80x24. After two warm-up cycles, which fill blessed's focus history to its cap of
ten, the census below must be unchanged after the 10,000 cycles.

| Census entry | Value before and after 10,000 cycles |
| --- | --- |
| Main panel children | the row element and the border label |
| Screen children | the main panel and the status line |
| Nodes in the screen tree | 5 |
| Keyable / clickable elements | 1 / 0 |
| Focus history | 10 (blessed's cap) |
| Listeners on all nodes / on the program / on both streams | 25 / 7 / 5 |

| Runtime | 10,000 cycles | 2 x 10,000 cursor moves, then paging, details and sort/filter changes |
| --- | --- | --- |
| 26.10.0 | passed, 228.7 s | passed, 13.2 s |
| 24.21.0 | passed, 251.3 s | passed, 13.7 s |
| 22.23.3 | passed, 258.6 s | passed, 13.6 s |
| 22.9.0 | passed, 265.0 s | passed, 12.1 s |

All four ran on the final tree, the three older runtimes at the same time; an earlier run on
26.10.0 at the lifecycle commit (`385427b`) passed in 362.7 s and 16.8 s. The order test
computed no order for any cursor move or paging key and exactly one for each sort change,
filter change and load.

The same key script against the phase 3 tree (`a323467`), printed by a scratch probe: the
screen's keyable list grew from 17 entries after 2 cycles to 177 after 22, and its clickable
list from 12 to 132, because every closed prompt and message kept its input and buttons in
them, which also kept the dialogs alive. The panel held two row elements and no label.
Upstream before PR #13 appended one element per render (113 panel children after 110
renders); PR #13 then removed every second child per render, the border label and open
prompts included.

## Navigation cost

`navigation-benchmark` on a generated 100,000-record log (17.5 MiB), 120x40 headless
screen, Node 26.10.0, `--expose-gc`, two runs each. Phase 3 is the faithful port at
`a323467`, where every notifying render marked the order stale, so the next access sorted
and filtered all records again.

| Measurement | Phase 3 (`a323467`) | Phase 4 (`385427b`) |
| --- | --- | --- |
| Load (whole-file read, as before) | 3,221 / 3,405 ms | 3,034 / 2,557 ms |
| Cursor move inside the viewport (400 moves) | 1.13 / 1.37 ms | 1.18 / 1.12 ms |
| PageDown (50 pages) | 218.5 / 223.6 ms | 1.82 / 1.79 ms |
| Sort change to level | 38 / 40 ms | 34 / 33 ms |
| Cursor move after the sort change (50 moves) | 9.83 / 9.65 ms | 1.28 / 1.24 ms |
| Order computations for all of the above | not counted | 3: the empty panel, the load and the sort change |
| Heap used after GC / resident set | 81 / 543 MiB | 40 / 171 MiB |

These timings are benchmark evidence for this machine, not test thresholds.

## Test matrix

The final tree ran `node .test-dist/scripts/run-tests.js` with the test build of Node
26.10.0:

| Runtime | Result | Duration |
| --- | --- | --- |
| 22.9.0 | 142 of 142 passed | 5.6 s |
| 22.23.3 | 142 of 142 passed | 6.5 s |
| 24.21.0 | 142 of 142 passed | 6.4 s |
| 26.10.0 | 142 of 142 passed | 6.1 s |

`pnpm run typecheck`, `pnpm run lint` and `pnpm test` passed for every phase 4 commit. The
regression tests of the sort, PageUp, details scrolling, clamping and tag detection fixes
failed when their source change was taken out again; the wrap test does not compile
without it.
