# jlv 2 phase 7 results

Measured on 2026-10-11 for plan §8 phase 7: filtering, correlation and terminal text safety.
The decisions that phase 8 must apply are summarized in plan §0.15. Scratch scripts, the
generated fixtures, an export of the phase 6 head for comparison and the downloaded runtimes
lived in a temporary directory outside the repository and were deleted afterwards.

## Environment

- Windows 11 Home on ARM64, 12 logical processors, 16 GiB RAM, shared with other work during
  the measurements.
- Node 26.10.0 installed locally; Node 22.9.0, 22.23.3 and 24.21.0 from the official
  `win-arm64` zips, each checked against its `SHASUMS256.txt`.
- pnpm 12.9.1, typescript 6.0.3, eslint 10.12.0. No dependency changed.

## What phase 7 built

| Module | Role |
| --- | --- |
| `src/filters.ts` | The filter contract: clauses on the parts of a record, profiles with `all` or `any`, the level and the predicates of plugins, all applied together; descriptions for the status line |
| `src/terminal-text.ts` | The one sanitizer: `visibleText` removes escape sequences and shows control characters, the line separators and the bidirectional controls as JSON escapes; `escapeControls` makes JSON text safe without changing its values |
| `src/tui/formatting.ts` | The `markup` tag, which escapes every value; widths in the cells that blessed draws, from its own Unicode patterns; cuts with an ellipsis that never split a character; `layoutRows`, in which no row is wider than the panel. Upstream's `formatRows` helpers and their characterization tests are gone |
| `src/tui/correlation-colors.ts` | FNV-1a over an identifier's text picks one of twelve 256-color numbers; nothing is cached |
| `src/tui/text-dialog.ts` | The scrolling dialog that the details and the key help share |
| `src/tui/key-help.ts` | The key help of `?`, with every key of the records, the details, the pickers and prompts |

`application.ts` applies the filter of the command line to the viewer's first view, to
`--output plain|jsonl` and to `--save`; `cli.ts` reads `--where`, `--profile` and
`--predicate`; `configuration.ts` reads the clauses of `--where` with the validation of
profiles. The record view filters and sorts by sequence: the level comes from the store's
level slot, and only the other parts normalize a record again.

## Behavior that changed

Each change has a named test and is explained in its commit.

- `f` opens a filter manager: add a text filter on the timestamp, the message, the
  correlation identifier or an original field (`other`, with upstream's `path:text`), remove
  any active filter, choose a profile or a predicate, or clear all. The filters add up;
  upstream's `f` replaced the filter or cleared all, and only its last filter decided.
- `l` sets the level only; its `all` clears the level and keeps the other filters.
- `-l`, `--where`, `--profile` and `--predicate` apply together, also to plain output, JSON
  lines and the save file. A clause that does not read and an unknown profile or predicate
  end the run with 2; a predicate that throws leaves its record out, is reported once on
  standard error and ends the run with 1.
- Clause fields must start with a part of the record, and profiles need at least one clause;
  phase 6 accepted any field and empty profiles without applying them.
- The correlation identifier has a column once a record had one, in a color that its text
  picks; `c` shows only the records of the selected record's identifier, and a second `c` all
  of them.
- The cursor stays on its record, in its screen row, when the sort or the filters change; a
  filter that leaves the record out starts at the first record.
- `?` shows the key help. Upstream's undocumented `?` opened the search with the last term;
  `n` searches with it again, and `/` always starts anew.
- The status line fits the width: the hint `? help` and the page height go first, then the
  filters, the formats and the configuration file are cut, the widest first; the counts stay.
- Text of records, files, the configuration and the user shows literally: no escape
  sequence reaches the terminal, blessed tags show as text, and control characters show as
  `\n`, `\t` or `\u001b`, also in plain output, where tabs were raw before, and on standard
  error. A multi-line message shows its line breaks as `\n`; upstream showed its first line.
- Rows fit the panel at every width, and a message keeps up to a third of a narrow row; `w`,
  which wrapped rows wider than the panel, is gone.
- The details show a missing part of their title as `-` (it was `undefined`), empty objects
  and arrays as `{}` and `[]`, nesting below 16 levels as JSON, 1000 entries per object and
  4096 characters per value.
- The details and plain output leave out nested fields that the columns show, so a Docker
  text record shows its text once; `--output jsonl` and `--save` keep every field.
- JSON lines and saved records escape DEL, the C1 controls, the line separators and the
  bidirectional controls; the values read back unchanged.
- A raw level such as `constructor` or `__proto__` is `unknown`; it used to read a member of
  `Object.prototype`, which made `--output plain` fail. Configured level and profile names and
  Docker envelope keys such as `__proto__` stay keys.
- Ctrl-C ends the viewer while a prompt reads text; blessed gave the prompt every key before.

## Proofs of plan §8 phase 7

| Proof | Where |
| --- | --- |
| Multi-clause AND, OR profiles, clear, type-aware comparisons; no earlier clause discarded (#19) | `filters.test.ts` (0, false, null and `"0"`; clause order; profiles; predicates), `viewer-filters.test.ts` (filter manager), `application.test.ts` (level, clause, profile and predicate together, the profile round trip against the same clauses of `--where`, predicate failures, no code from a configuration) |
| Unknown and mixed-case levels (#14) | `filters.test.ts`, `viewer-filters.test.ts`, `record.test.ts` (prototype names), `output.test.ts` |
| Exact identifier and ID 0 filters, no growing lookup cache (#15) | `viewer-correlation.test.ts` (0 as number, text and `req.id`; empty and missing identifiers select nothing; same color in every order; 100,000 identifiers within the fixed palette; selection across new records and eviction), `filters.test.ts` |
| Literal slash, backslash, tag, ANSI/OSC, depth and empty-object regressions at narrow and wide widths (#18) | `viewer-text-safety.test.ts` (40, 80 and 160 columns; the raw terminal output never carries the title, clipboard, 8-bit CSI or bell of the log), `viewer-details.test.ts` (depth, entries, length, key padding), `formatting.test.ts`, `terminal-text.test.ts`, `status-line.test.ts` |
| Snapshots plus logical cells and styles | screen rows and `cellStyle` foreground, background and weight in `viewer-text-safety.test.ts`, `viewer-correlation.test.ts`, `viewer-load.test.ts` and `status-line.test.ts` |
| Abort or quit with an active prompt | `application.test.ts`: Ctrl-C and SIGTERM with the search prompt, the filter manager, a filter prompt and the key help open; `q` as text in a prompt; `--strict` stopping the input under an open prompt. Without `ignoreLocked`, the two Ctrl-C cases with a prompt time out |
| Unchanged original JSONL export values | `cli.test.ts` (`--output jsonl` and `--save` of escape sequences, controls, tags, separators, 0, false, null and an own `__proto__` key read back as the original fields), `output.test.ts` |
| Widget and listener counts with the new dialogs | `viewer-lifecycle.test.ts`: the cycle opens and closes the key help and the filter manager too |

## One million records

The fixture and method of phases 0, 5 and 6, generated again: 1,000,000 JSON lines of 512
bytes with timestamps mostly increasing and up to 5 s of jitter, the last record one hour
newer than all others, and a `requestId` of 997 values in every record, so that phase 7 shows
its correlation column. The real `runApplication()` of the emitted tree shows the file in the
viewer on a headless 120x40 terminal with the default limits and order and quits with `q`.
*First record* is the time until a record's text reaches the terminal, *whole file* until the
newest record, which sorts first only once the file has been read. Three runs per runtime;
the export of the phase 6 head ran on the same fixture right after them.

| Node | Tree | First write | First record | Whole file | Peak RSS | RSS at the end | Heap after GC | Peak heap committed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22.9.0 | phase 7 | 53 to 57 ms | 80 to 87 ms | 2,196 to 2,265 ms | 137.7 to 139.0 MiB | 135.3 to 137.6 MiB | 10.4 to 10.5 MiB | 61.7 to 62.6 MiB |
| 22.9.0 | phase 6 | 52 to 55 ms | 78 to 83 ms | 2,205 to 2,258 ms | 135.6 to 139.9 MiB | 135.4 to 137.2 MiB | 10.4 MiB | 62.1 to 63.0 MiB |
| 22.23.3 | phase 7 | 50 to 51 ms | 83 to 91 ms | 2,311 to 2,382 ms | 134.4 to 140.4 MiB | 124.7 to 140.2 MiB | 10.7 to 10.8 MiB | 57.8 to 63.9 MiB |
| 22.23.3 | phase 6 | 48 to 49 ms | 79 to 81 ms | 2,087 to 2,277 ms | 135.7 to 137.6 MiB | 135.5 to 137.4 MiB | 10.6 to 10.7 MiB | 60.4 to 62.5 MiB |
| 24.21.0 | phase 7 | 47 to 51 ms | 75 to 84 ms | 2,347 to 2,389 ms | 144.1 to 144.3 MiB | 143.8 to 144.0 MiB | 11.2 MiB | 64.2 to 64.7 MiB |
| 24.21.0 | phase 6 | 45 to 48 ms | 72 to 74 ms | 2,047 to 2,127 ms | 139.0 to 141.3 MiB | 134.8 to 141.1 MiB | 11.0 to 11.2 MiB | 56.8 to 61.5 MiB |
| 26.10.0 | phase 7 | 42 to 45 ms | 68 to 71 ms | 1,940 to 1,998 ms | 143.5 to 145.1 MiB | 140.8 to 144.8 MiB | 11.4 to 11.5 MiB | 59.1 to 60.6 MiB |
| 26.10.0 | phase 6 | 43 to 49 ms | 67 to 76 ms | 1,921 to 1,930 ms | 141.1 to 144.3 MiB | 138.7 to 142.4 MiB | 11.3 to 11.4 MiB | 58.2 to 60.5 MiB |

Both targets hold on all four runtimes: peak RSS 134 to 145 MiB against 256 MiB, and the first
record after 68 to 91 ms against 1 s. The phase 6 results document recorded 129 to 182 MiB and
77 to 205 ms on its own fixture.

Memory and the first record are unchanged. The whole file took as long as with phase 6 on
Node 22.9.0 and 26.10.0 and longer on 22.23.3 and 24.21.0. Four alternating runs of both trees
on Node 24.21.0 put phase 7 at 2,444 to 2,747 ms against 2,237 to 2,626 ms, about 7 % slower;
on the same fixture without identifiers, about 3 %, which is within the spread of the runs.
Most of the difference is the colored correlation column, whose cells blessed draws in every
frame while the file loads. Normalization alone measured 342 to 363 ms per million records
against 327 to 347 ms; level names are looked up by own keys now.

Filters over the 50,000 records that the store keeps, timed in the record view on Node
26.10.0 (two runs): no filter 12 to 13 ms, the level 3 ms (it reads the store's level slot;
in phase 6 every level filter normalized every record again), a message clause 88 ms, a
correlation clause 67 to 70 ms, the order by message 88 to 94 ms. The view computes this once
per change of the filters or the sort, never for a cursor move.

## Lifecycle

The proof with `JLV_LIFECYCLE_CYCLES=10000` passed on Node 26.10.0: the census of nodes,
keyable and clickable elements, focus history and listeners was unchanged after 10,000 cycles,
which now also open and close the key help and the filter manager (316.8 s; 356.2 s in
phase 6), and the order was computed once per data or query revision, never for a cursor move
(15.2 s; 22.8 s in phase 6). The focus history settles below blessed's maximum of ten entries,
since closing a dialog takes its entries back out; the test checks that it stays bounded.

## Test matrix

The suite of the last code commit, emitted once and run with each runtime:

| Node | Tests | Passed | Failed | Skipped | Wall time |
| --- | --- | --- | --- | --- | --- |
| 22.9.0 | 470 | 468 | 0 | 2 | 20 s |
| 22.23.3 | 470 | 468 | 0 | 2 | 22 s |
| 24.21.0 | 470 | 468 | 0 | 2 | 21 s |
| 26.10.0 | 470 | 468 | 0 | 2 | 16 s |

The first run of the matrix, with `util.stripVTControlCharacters` in the sanitizer, failed four
tests on both Node 22 releases; see the deviations. The two skipped tests are the POSIX-only
ones of phase 5 (an unreadable file and SIGINT during a live input). `pnpm run typecheck`,
`pnpm run lint` and `pnpm test` passed for every phase 7 commit on Node 26.10.0.

## Deviations from the plan

- No profile is ever written. Plan §8 phase 7 step 2 allows that; `docs/configuration.md`
  says that a filter to keep goes into the file by hand. The profile round trip is proved by
  reading a profile back and applying the same clauses through `--where`.
- `--where` repeats and `--predicate` repeats; `--profile` takes one profile, and the filter
  manager keeps one at a time.
- `contains` on `["timestamp"]` looks into the UTC time that the viewer shows, so the manager's
  timestamp filter still finds `10:1`; any other number is JSON text.
- The correlation column is not toggled by a key: it appears once the input had an
  identifier, so that the columns do not move while records arrive or the cursor moves.
- Bidirectional controls and the line and paragraph separators count as control characters
  next to C0, DEL and C1, since they reorder or break the text around them.
- Upstream's `utils.js` tests (`utilities.test.ts`, `formatting-values.test.ts`) were deleted
  with the helpers they characterized; `formatting.test.ts` tests the replacement.
- `w` is gone, see above. Upstream's `w` changed nothing on screen, phase 4 made it wrap rows
  that were wider than the panel, and such rows no longer exist.
- Ctrl-C under a prompt was a defect of the earlier phases, found by the abort proof and fixed
  here.
- Escape sequences are removed by an ECMA-48 pattern of `terminal-text.ts`, not by
  `util.stripVTControlCharacters` as plan §6.3 says, because that function's result depends on
  the Node version. On 22.9.0 and 22.23.3 it left most of a window title as text, removed the
  text between a color and a following BEL and kept the parameters of a color with colons;
  on every version it left device control strings and application program commands with
  spaces as text. The pattern removes control sequences, operating system commands, strings
  and other ESC sequences, in their 7-bit and 8-bit forms, the same way on every runtime; a
  sequence without its end stays visible with its ESC escaped. `terminal-text.test.ts` holds
  the cases.

## Gotchas for phase 8

- The package is still `json-log-viewer` with the `jv` bin, version 0.1.2 and no `files`
  list, so the tarball holds sources and tests; the documentation examples and their test
  run `jv`; `packages/jlv/README.md` is upstream's text.
- The README must list the keys (`keySections` in `src/tui/key-help.ts`), the filter manager,
  `--where`, `--profile`, `--predicate`, profiles, the correlation column and `c`. It must not
  list `w`.
- The screen runs without blessed's `fullUnicode`: wide characters show as `??` and emoji as
  `?`. The layout matches that exactly; enabling `fullUnicode` needs the widths in
  `blessed-boundary.ts` to change with it and a check in a real terminal.
- `docs/examples/profiles.config.json` and the predicate of `docs/examples/text-plugin.mjs`
  belong to the documentation examples.
- Part B step 13 of the manual terminal checklist covers filters, the key help, `c`, Ctrl-C
  under a prompt and a log line with escape sequences.
- Filters are not part of the public API; only the `FilterClause`, `FilterGroup` and
  `RecordPredicate` types are, as in phase 6.
- The sanitizer must not go back to `util.stripVTControlCharacters`: `terminal-text.test.ts`
  fails with it on Node 22, the oldest runtime that `engines` allows.
