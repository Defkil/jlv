# jlv 2 implementation plan

Research completed: 2026-10-11. Registry/GitHub checks and scratch experiments are dated evidence; implementation and release work remain future steps. This file was saved section by section during research.

## 0. Coordinator decisions (2026-10-11) — these override the sections below

1. **Node floor is 22, not 20.**
   - `engines.node` is `">=22.9.0"`. Node 20 has been end-of-life since 2026-04-30, and 2.0.0 is a new major.
   - CI runtime matrix: 22.9.0, latest 22.x, 24.x, 26.x.
   - Pin `@types/node` to the latest 22.x.
   - Unicorn rule exceptions:
     - Drop the exceptions for `prefer-array-from-async`, `prefer-iterator-helpers`, `prefer-iterator-to-array`, `prefer-iterator-to-array-at-end` and `prefer-promise-with-resolvers`. First verify each API on Node 22.9.0 with a one-liner.
     - Keep `prefer-promise-try` and `prefer-iterator-zip` off, justified by their absence in Node 22.
   - Everything in this plan that exists only for Node 20 is void: the 20.19 test runs, the Node 20 typings and Node-20-only workarounds. The Windows console fallback (§3.4) stays, because `\\.\CONIN$` also failed on 22.18.
2. **Owner questions (§11) go ahead on the plan's defaults.** Oliver may still object.
   - Bounded retention: 50,000 records / 64 MiB.
   - XML is deferred beyond 2.0. Document it as a candidate that needs a real sample.
   - No compatibility layer for the old CommonJS wrapper API, `--transformer`, the `jv` bin or upstream `-s`.
3. **Branch.** All implementation happens on `feat/claude-d8f0/jlv-v2`, created from `master` and pushed after every phase. The coordinator merges it into `master` after the final review and deletes it.
4. **Line endings.** Right after the two history imports, add `.gitattributes` with `* text=auto eol=lf`. Set `git config core.autocrlf input` in the clone, so Windows and Linux see identical bytes for lint, snapshots and tarballs.
5. **ESLint config file.** It is `eslint.config.js` (the root package is `type: module`). The `eslint.config.mjs` reference in §4.3 is a slip.
6. **This plan is tracked.** Commit `docs/v2-plan.md` on the branch early (narrow the `/docs/` ignore). Later phases keep it current only where a decision changes; they do not rewrite the research.
7. **Manual terminal checks.** The coordinator runs the Windows Terminal/PowerShell keyboard-with-pipe checks (§8 phase 0 step 2, phase 5) with Oliver before the release. Implementers do two things instead:
   - write `docs/manual-terminal-checklist.md`;
   - make sure the automatic plain-output fallback is safe, so nothing blocks on a human.
8. **npm and GitHub settings stay with the coordinator.** Implementers never publish, deprecate, archive, close PRs, or change npm or GitHub settings.
9. **Phase 0 results (measured 2026-10-11).** Details are in [v2-phase-0-results.md](v2-phase-0-results.md). They amend §3 and §4:
   - The TypeScript `lib` for the Node 22 floor is `["ES2024", "ES2025.Collection", "ES2025.Iterator", "ESNext.Array"]`; `target` stays `ES2022`.
   - The declaration shim corrects both stream directions of `IScreenOptions` (`input: Readable`, `output: Writable`) and declares the runtime `Box` constructor and `element()` factory that @types/blessed omits. The faithful port on blessed 0.1.81 uses a module augmentation of `'blessed'` with the same three declarations.
   - Test files allow the `node:test` registration calls in `@typescript-eslint/no-floating-promises` through `allowForKnownSafeCalls`, with a one-line justification.
   - Phase 3 decides how blessed markup such as `{bold}` passes `unicorn/no-incorrect-template-string-interpolation`: a scoped, justified exception or a tagged-template helper for trusted markup.
   - Tests keep one live blessed screen per process; ported widgets pass `screen` or `parent` explicitly.
   - Phase 5 builds the bounded store as an off-heap byte arena unless an alternative meets the 256 MiB target on the same fixture. Retaining parsed records peaked at 274 to 277 MiB on Node 26.10.0 (238 MiB on 22.9.0); the arena peaked at 127 to 131 MiB.
   - Node 22.9.0 needs the ConDrv console fallback; the latest 22 release opens `\\.\CONIN$` directly.
10. **Phase 2 results (2026-10-11).** They bind phases 3 and 4:
    - Upstream PR #13 (`bffe9f4`) fixes the per-render element leak but also removes the main panel's border label (file name and position) and only every second child per render; a second resize detaches an open prompt that keeps reading keys. The characterization records this state. Phase 4's persistent row widget must restore the label and must not remove dialogs.
    - Tests run from `.test-dist`: `scripts/prepare-test-tree.ts` mirrors package manifests, not yet ported JavaScript and fixtures, and `scripts/run-tests.ts` links each package's dependencies into the mirror and gives every run an empty home directory. Tests reach upstream modules only through `packages/jlv/test/support/legacy.ts`; the port replaces each loader with an import of the ported module.
    - `packages/jlv/test/package.json` marks the tests as ES modules while `packages/jlv` is CommonJS. Remove it when `packages/jlv` becomes `type: module`. Until then, compiled TypeScript under `packages/jlv/src` is CommonJS too, and the legacy JavaScript still requires it.
    - The temporary ignores in `eslint.config.js` keep legacy JavaScript out of the lint scope; remove each entry as its code is ported or retired.
11. **Phase 3 results (2026-10-11).** They bind phase 4 and supersede the port-related parts of §0.10:
    - The port is complete. `packages/jlv` is `type: module`; `src/cli.ts`, `src/log.ts` and `src/tui/*.ts` replace every upstream module, and the tests import them directly. The loader module, the test package marker and the source mirroring of §0.10 are gone. `pnpm run build` emits `packages/jlv/dist` with declarations; `bin` is `jv` -> `dist/cli.js`, `main` is gone, `engines.node` is `>=22.9.0`, and name and version wait for phase 8.
    - `src/tui/blessed-boundary.ts` is the only runtime import of blessed. `src/types/blessed.d.ts` augments @types/blessed 0.1.27 with `Box`, `element()` and a `screen` overload with corrected streams. Phase 4 swaps the import in the boundary and replaces the augmentation with the neo-blessed declaration; the widgets import only `Widgets` types from `'blessed'`.
    - lodash 4.17.11, minimist 1.2.0 and ini 1.3.5 stay runtime dependencies, typed by @types/lodash 4.17.26, @types/minimist 1.2.5 and @types/ini 1.3.34 (the last declarations for ini 1.3). Lint already replaced `_.last` and `_.cloneDeep` with `.at(-1)` and `structuredClone`; phase 4 replaces the remaining calls (`get` paths, `sortBy`, `reverse`, `pick`, `omit`, `compact`, `isEmpty`, `isObject`, `isFunction`, `chain`).
    - Blessed markup in templates goes through the `markup` tag in `src/tui/formatting.ts`: literal tags are trusted, interpolated values are inserted unchanged. Phase 7 escapes the values there.
    - Error cases that changed have named tests: `--sort` or `--log` without text fail with a TypeError and exit code 1 (upstream: exit 1 or 7 after a crash), a cleared level filter is `undefined` instead of `null`, and explicit TypeErrors replace reads of a missing record, details element or column. `-l` still passes numbers through, so `-l 30` matches pino levels.
    - Kept upstream quirks: `hasColors` tests with a global regular expression; minimist turns numeric arguments into numbers, so `jv 5` reads from file descriptor 5 and `jv 0` reports a missing log file, although @types/minimist declares strings; `w` toggles blessed's own `Element#wrap`, which the panel does not use.
    - The remaining lint ignores cover the v1 wrapper (`src/`, `test/`) and `packages/jlv-pino`, which phase 4 retires instead of porting.
12. **Phase 4 results (2026-10-11).** Evidence is in [v2-phase-4-results.md](v2-phase-4-results.md). They bind phase 5 and later:
    - The runtime dependencies are exactly neo-blessed 0.2.0 and ini 6.0.0: no transitive packages, native code or install scripts, and `pnpm audit` reports nothing for the production or the full graph. lodash, minimist, blessed, blessed-contrib and their types are gone. Adding a runtime dependency needs the same inventory.
    - `src/types/neo-blessed.d.ts` declares the backend; `src/tui/blessed-boundary.ts` stays its only runtime import. Owned dialogs close through its `destroyElement()`, which also drops the subtree from the screen's keyable and clickable lists and moves the focus back when a destroyed descendant had it. Never remove panel children wholesale. blessed sends both `enter` and `return` for one Enter key, and neo-blessed lets `NCURSES_FORCE_UNICODE` override `forceUnicode`.
    - The main panel owns one persistent row element; the border label is back. It computes its visible order once per `dataRevision`/`queryRevision` pair (`orderComputations` counts it), so cursor moves and renders do no sorting work. The phase 5 store must bump the data revision on append and eviction and keep that property; `setUpdated()` only notifies the status line now.
    - `renderLines()` clamps the cursor to a record (row 0 in an empty view) inside the viewport; Enter on an empty view does nothing; page height, page width, the last column and the details page step are never negative.
    - `src/field-path.ts` reads lodash's legacy path grammar with own properties only; phase 6 adds the segment-array mappings there. `src/tui/row-order.ts` reproduces lodash.sortBy for the legacy row until the store and the final model replace it (§5 orders missing times last instead).
    - The CLI parses with strict `node:util.parseArgs`: usage errors go to stderr with exit code 2, values starting with a dash need the `=` form, and positional arguments are text. `-s` still means sort, `-l` keeps minimist's number conversion until phase 6 normalizes levels, and a missing log file still prints to stdout with exit code 1 until phase 5 replaces input handling.
    - Fixed quirks of §0.11: `hasColors` keeps no regular-expression state, and `w` toggles the wrapping of the row element (`isWrappingRows`). Kept defects: the filter reducer (#19), the case-sensitive level filter (#14), the `C` middle row, undefined timestamps that print as text but measure as empty, ANSI bytes that count as visible when rows are cut, and `q` calling `process.exit` inside the panel (phase 5).
    - `viewer-lifecycle.test.ts` runs 200 cycles; `JLV_LIFECYCLE_CYCLES=10000` reproduces the proof (4 to 6 minutes on this machine).
    - The v1 wrapper, its tooling, the upstream lockfiles and lint files, the copied screenshots and `packages/jlv-pino` are gone, and no lint scope exclusion remains. jlv-pino's mapping and level cases live in `packages/format-fixtures/fixtures/pino` (`pinoFixtures` in the catalogue).
    - Phase 8: neo-blessed's `bin` links a `tput` script into a consumer's `node_modules/.bin`; the package README still documents upstream's keys and needs the details keys and `w`.
13. **Phase 5 results (2026-10-11).** Evidence is in [v2-phase-5-results.md](v2-phase-5-results.md). They bind phase 6 and later:
    - Modules: `input/lines.ts` frames bytes (LF/CRLF, BOM at the start, 1 MiB per line), `input/files.ts` resolves inputs (tinyglobby 0.2.17, the third runtime dependency), `input/follow.ts` polls, `store.ts` is the arena, `tui/record-view.ts` orders, `output.ts` writes, `terminal.ts` finds the keyboard, and `application.ts` owns the lifecycle. `runApplication(options, environment)` returns the exit code and takes its streams, signals and keyboard from `environment`; `cli.ts` only parses. Nothing calls `process.exit`.
    - The store keeps record text in a byte ring and per-record slots in typed arrays (offset, length, time key, source, record number); 50,000 records / 64 MiB by default, `--max-records` and `--max-bytes` up to 2^32 − 1. Sequences count stored records in arrival order; a record's identifier is `<source position from 1>:<record number>`, and record numbers go on across follow rotations. Every append bumps `dataRevision`. Phase 6 can keep the arena and must feed its time slot from the final record's timestamp; storing parsed records again would bring back the RSS problem of §0.9.
    - Order: `RecordView` computes the visible order once per data/query revision and merges new records incrementally. Missing values (time NaN, undefined/null fields) sort last in both directions; ties keep arrival order in both directions. `timeKey()` in `log.ts` is the transition rule (finite number = epoch ms, RFC 3339 with a zone, else NaN); phase 6 replaces it with the final timestamp normalization. Files default to `-timestamp`, stdin/FIFOs and `--follow` to `arrival`; the sort picker offers `arrival`. A cursor at the newest end follows new records; any other cursor stays on its record (selection by sequence).
    - The legacy reader: the `~/.json-log-viewer` mapping is read once per run (`readMapping()`); an unreadable file is a usage error (2). `parseLine()` classifies record / blank / skipped (no JSON, or null/false/0/"" as upstream dropped them); skipped and oversized lines are counted. JSON values that are no objects are still rows, as upstream had them; §5 makes them diagnostics in phase 6. `readLog()` remains only for tests.
    - Display: missing cells print empty (`padEnd`), the border label keeps the end of a long name, and the status line shows `loading`/`live`, `kept <retained> of <seen>`, skipped lines and failed inputs. Message escaping and control characters stay with phase 7, also in plain output, which only escapes CR and LF.
    - CLI: inputs (positional, `-f/--files`, `-`) keep their order; `--follow`, `--sort`, `-l`, `--output auto|tui|plain|jsonl`, `--max-records`, `--max-bytes`, `-s/--save`, `--overwrite`, `--log`, `-h/--help`, `--version`. `-s` is save. Exit codes: 0, 1 (input/output/terminal failure, no records), 2 (usage, mapping, save conflicts), 130/143/129 for SIGINT/SIGTERM/SIGHUP. Help, version and all of these errors come before any screen; `--sort` other than `arrival` with explicit plain/jsonl output is a usage error. The bin is still `jv` and the version 0.1.2 until phase 8.
    - Output: `auto` shows the viewer only with a terminal stdout and a keyboard independent of the records (stdin when it is a TTY and no source, else `/dev/tty` or `\\.\CONIN$` then the ConDrv fallback); otherwise plain text. Records typed into the terminal through `-` also get plain output. Plain and JSON lines go out in arrival order with backpressure; EPIPE ends with 0; the first ten skipped lines are reported on stderr, the rest counted. JSON lines and `--save` write the parsed and mapped values, not raw bytes; the save file is created exclusively, refuses inputs (identity or real path) and gets every record that matches `-l` regardless of the viewer's limits.
    - Follow: 500 ms polling by name with identity (dev/ino, else dev/birth time), offset and the unfinished line; truncation ends the unfinished line and restarts at 0; rotation drains the old file first; a path without a regular file is retried. Truncation followed by more writes than the old size between two polls is invisible to polling.
    - Tests: `scripts/run-tests.ts` gives the runner one run directory and points TMPDIR/TMP/TEMP into it, so aborted runs leave nothing behind. Spawned viewer tests pretend a terminal with a `--import` preload, send keys after 300 ms of quiet output, and compare screen output without spaces; tests that need no console spawn `detached`. Unicorn 77's `name-replacements` keeps `application` (plan name) by a justified option.
    - Manual gate: Part B of [manual-terminal-checklist.md](manual-terminal-checklist.md) now lists the live-pipe, follow-newest, eviction, follow, save, plain, no-console and typed-input checks.
14. **Phase 6 results (2026-10-11).** Evidence is in [v2-phase-6-results.md](v2-phase-6-results.md). They bind phase 7 and later:
    - Modules: `api.ts` (types only, the `.` export), `record.ts` (normalization), `field-path.ts` (segment paths and the legacy grammar), `formats/*` (one module per format, `registry.ts` in detection order docker, bunyan, pino, logfmt, csv, winston, jsonl; `formats/index.ts` is the `./formats` export), `ingestion.ts`, `configuration.ts`, `plugins.ts` and `tui/log-row.ts`, the compatibility row of the widgets. `log.ts` is gone. Runtime dependencies: neo-blessed, ini, tinyglobby and csv-parse 7.0.3.
    - The API differs from the §5 block where reality required it: parse events and diagnostics carry a `LinePosition` and the core assigns record numbers; `FormatContext.timestampUnit` is optional (absent: the format's own unit) and `FormatContext.levels` carries configured level names; `ParsedEntry` is a named type. Documentation and phase 8's consumer compile follow `api.ts`, not §5.
    - Records: the store has level and line slots and takes its time key from the final timestamp; the viewer re-normalizes only shown rows from the stored JSON with the source's format. Built-in readers and normalizers attach private symbols (`formats/metadata.ts`) for the stored bytes and the consumed paths; without them, the store keeps `JSON.stringify` of the entry and the details show every field. `--output jsonl` and `--save` write the §5 record with the complete `fields`.
    - Readers hand their events over in batches of at most 64 (`maximumBatchEvents`): larger batches kept parsed records alive across young-generation collections and pushed Node 24's RSS over 256 MiB in the benchmark.
    - Configuration: discovery and precedence of §6.3, `jlv.config.json` version 1 with unknown-key errors, INI `[transform]` for parts and legacy extras. `profiles` are validated (`FilterGroup`) but not applied; phase 7 applies them, adds `--where`, `--profile` and `--predicate`, uses the loaded plugin predicates and keeps the field semantics that `docs/configuration.md` states (`["message"]` for a normalized part, `["fields", …]` for an original field).
    - Display safety stays with phase 7: messages, timestamp texts, original levels, logfmt keys, CSV header names, labels and file names reach rows, details, the status line and standard error unsanitized. The status line now also names the formats, the configuration file and the warning count.
    - Documentation: `docs/formats.md`, `docs/configuration.md` and `docs/migration.md`; `documentation.test.ts` runs every console example in `docs/examples`. Phase 7 and 8 keep the examples green; phase 8 renames `jv` there and in the test, sets the package's `files` list (the tarball still holds sources and tests) and rewrites `packages/jlv/README.md`.
    - Manual gate: Part B step 12 of [manual-terminal-checklist.md](manual-terminal-checklist.md) checks formats, normalized levels and the configuration label in a real terminal.
15. **Phase 7 results (2026-10-11).** Evidence is in [v2-phase-7-results.md](v2-phase-7-results.md). They bind phase 8:
    - Modules: `filters.ts` (clauses, profiles, the level and plugin predicates), `terminal-text.ts` (the one sanitizer: `visibleText` for whatever reaches a terminal, `escapeControls` for JSON text), `tui/formatting.ts` (the `markup` tag escapes every value; widths come from blessed's own Unicode patterns; `layoutRows` replaces upstream's `formatRows`, whose helpers and characterization tests are gone), `tui/correlation-colors.ts`, `tui/text-dialog.ts` (the scrolling dialog of the details and the help) and `tui/key-help.ts`.
    - Filters: a clause's field must start with a part of the record as `--output jsonl` writes it (`identifier` to `fields`), and a profile needs at least one clause. `equals` uses `util.isDeepStrictEqual`; `contains` ignores case and reads other values as JSON text and `["timestamp"]` as the UTC time that the viewer shows. `-l`, `--where`, `--profile` and `--predicate` apply together, also to `--output plain|jsonl` and `--save`; an unreadable clause or an unknown profile or predicate exits with 2, and a predicate that throws drops its record, is reported once and ends the run with 1. Profiles are read only (plan §8 phase 7 step 2).
    - Viewer: `f` is a filter manager (add, remove, profiles, predicates, clear all), `l` sets the level only, `c` toggles an `equals` clause on `["correlationIdentifier"]`, and `?` shows the key help (upstream's `?` searched with the last term; `n` does). The selection stays on its record across sorts and filters. The correlation column appears once a record had an identifier; FNV-1a over the identifier picks one of twelve 256-color numbers, with no cache. The status line fits the width: the help hint and the page height go first, then filters, formats and the configuration name are cut; counts stay. Every row fits the panel, so `w` is gone. Ctrl-C passes through prompts that read text (`ignoreLocked`).
    - Text: rows, labels, details, pickers, prompts, messages, the status line, plain output and standard error show visible text only; JSON lines and saved records escape DEL, C1, U+2028/U+2029 and the bidirectional controls and keep their values. Escape sequences are removed by the ECMA-48 pattern of `terminal-text.ts`, not by `util.stripVTControlCharacters` as §6.3 says: that function's result depends on the Node version, and the sanitizer tests fail with it on Node 22. The screen still runs without `fullUnicode`, so blessed draws wide characters as `??` and other characters beyond the Basic Multilingual Plane, such as emoji, as `?`; the layout measures exactly that.
    - The details and plain output leave out nested fields that the columns show (a Docker text record no longer shows its text twice); `fields` stay complete. Level, profile and envelope tables read own keys only.
    - Phase 8: the README documents the keys (`keySections` in `tui/key-help.ts` is the list), the filters and correlation; Part B step 13 of the [manual terminal checklist](manual-terminal-checklist.md) covers them in a real terminal.
16. **Phase 8 results (2026-10-12).** Evidence is in [v2-phase-8-results.md](v2-phase-8-results.md). For the review, the merge and the release:
    - The package is `jlv` 2.0.0 (`chore(release): jlv 2.0.0`): the bin `jlv` only, `files` = `dist/`, README, LICENSE and NOTICE.md (124 files, 234,036 bytes; npm 11 on Windows and npm 12 on Linux pack the same bytes), `repository.directory`, and `publishConfig` with public access and provenance. A project install also links neo-blessed's command `neo-blessed` (its `bin/tput.js`, not `tput` as §0.12 says) into `node_modules/.bin`; a global install exposes `jlv` only. There is no `scripts/prepare-package.ts`: the README, license and notices are authored in the package.
    - `scripts/check-package.ts` (`pnpm run check:package`) is the gate of §9.2. `scripts/publish-package.ts` is the decision of §9.3; it also requires a dated `CHANGELOG.md` section and npm 11.5.1 or later, and refuses to publish outside the publish job on `refs/heads/master`. Its tests run it against a stub npm.
    - `.github/workflows/publish.yml` ("CI and publish"): quality on Node 24 with npm 12.2.0 and a dry run of the decision; runtime on 22.9.0 and the latest 22, 24 and 26, which compiles the tests with Node 24 and checks the downloaded tarball by its SHA-256; publish on `master` only. The branch push trigger of `19b6bb0` existed because GitHub refuses `workflow_dispatch` for a workflow that the default branch lacks; the last phase 8 commit removes it, and since the workflow is registered, `gh workflow run publish.yml --ref <branch>` checks a branch.
    - The screen runs with `fullUnicode`, and `drawableText` in `tui/blessed-boundary.ts` gives blessed only characters on whose cells blessed and terminals agree: CJK shows itself, emoji show as `?`. Part B of the [manual terminal checklist](manual-terminal-checklist.md) now runs the packed package (`pnpm run check:package -- --keep`) and checks wide characters in step 14.
    - The release: configure the trusted publisher, merge into `master` and push; that push publishes 2.0.0 ([release.md](release.md)). `CHANGELOG.md` dates 2.0.0 2026-10-12; a later release day changes that date in the merge. Deprecating `jlv-pino`, archiving its repository, closing the 14 Dependabot pull requests and removing `gh-pages`/Pages stay with the coordinator after the publication.

## 1. Scope and verified starting point

This is a plan, not an implementation. The only repository change authorized for this research is this document. No source, configuration, dependency, Git history, remote issue, release, or repository setting is changed.

- Keep `Defkil/jlv`, default branch `master`, as the project home and publish `jlv` 2.0.0. Preserve the upstream viewer as the starting implementation, its history, and its contributors.
- The checked-out wrapper is `jlv` 1.0.1. Its published-file list contains `src/cli.js` but its package manifest has no `bin` entry. Its implementation overrides `process.argv.slice`, loads upstream code for side effects, merges byte streams without record framing, and copies configuration into the home directory. These are migration targets, not architectural patterns to retain.
- The upstream reference checkout is clean at `b8aa924544ffe484de51460c06cbc4a115ec3928` (2018-09-23, `package updates (#11)`). Its manifest is `json-log-viewer` 0.1.2 with `jv` as its executable and MIT as its declared license. A repository push date is not evidence of maintained source.
- The local development environment is Windows ARM64, Node 26.10.0, npm 11.19.1, and pnpm 12.9.1. Runtime compatibility and contributor-tool compatibility will be specified separately.
- The existing trusted-publishing reference is `../tcp-proxy/.github/workflows/publish.yml`: SHA-pinned actions, top-level empty permissions, explicit job permissions, timeouts, version-list lookup, and `npm publish` without `registry-url`. Adapt this pattern to a workspace package and a tested tarball, not the old wrapper's manifest.
- Code, documentation, comments, and new commit messages stay in English. New commits use Conventional Commits and contain no AI attribution. Implementation lands on `master` directly or through an implementer-merged short-lived branch; this plan does not propose creating pull requests.

Sources: [jlv](https://github.com/Defkil/jlv), [upstream pinned source](https://github.com/gistia/json-log-viewer/tree/b8aa924544ffe484de51460c06cbc4a115ec3928), local source and publishing workflow inspected on the research date.

## 2. Decisions against the coordinator's draft

| Draft point | Decision | Rationale and correction |
| --- | --- | --- |
| 1. Repository/history | Keep `Defkil/jlv`; import the upstream commit above with a non-squashed subtree at `packages/jlv`. Keep the wrapper's history. | Preserves both histories and original upstream commit IDs without making a new repository or npm name necessary. |
| 1. PR #13 | Apply the original PR patch with preserved author/date and source SHA in a separate integration commit, then replace its cleanup approach with a persistent row widget after the faithful TS port. | The PR proves the leak, but mutating `children` during `forEach` and removing every child can interfere with prompts; it is not the final rendering design. |
| 1. License | Retain Oliver's existing MIT notice; ship full MIT text with upstream attribution in the package and document Felipe Coury/Gistia provenance. | The upstream manifest and README declare MIT but there is no original LICENSE file; do not invent Gistia's copyright ownership or an upstream copyright year. |
| 2. Monorepo | A private pnpm workspace root, one public package `packages/jlv`, and a private `packages/format-fixtures` package. Put all production adapters, including pino, inside `jlv`. | A monorepo is useful for a shared compatibility corpus; publishing separate adapter packages or a new scope adds release coupling without a benefit here. |
| 2. Executables | Publish `jlv` only in 2.0.0; leave `jv` to `json-log-viewer`. | Installing both tools must not overwrite the other package's executable. A `jv` alias can be reconsidered only with an explicit owner decision. |
| 3. TS/order | Import unchanged upstream, establish behavioral characterization, port strictly, then update dependencies/backend and implement features in separate commits. | A TUI or parsing rewrite mixed with the port makes behavioral regressions difficult to locate. |
| 4. TUI | Use `neo-blessed` 0.2.0 behind one typed boundary after the faithful port on blessed 0.1.81. | It is a small compatible delta with Unicode/terminfo fixes, no native dependencies, and reusable blessed typings with one verified correction; no actively maintained blessed replacement checked meets all the constraints. |
| 5. Inputs | Stream records from files, quoted globs, and stdin; use a separate controlling-terminal input for keyboard events. Follow files by name with polling; offer plain output when no terminal exists. | stdin support alone does not make an interactive TUI possible: the log pipe and keyboard must have different streams. |
| 5. Large files | Bound retained records and bytes; render only the viewport. Default finite files sort retained records by descending timestamp. Live mode uses arrival order; exact whole-file sorting is a separately bounded operation. | Virtual rendering does not fix whole-file reads or unbounded record storage, and chronological live merges cannot be guaranteed with arbitrarily late input. |
| 6. Formats | Ship JSONL, pino, bunyan, configurable Winston JSON, logfmt, CSV, and Docker JSON envelopes. Defer generic XML and named GELF/ECS/OTel/syslog adapters. | Common JSON layouts need small structural adapters; XML and syslog need real fixtures and framing semantics, not format names on a checklist. |
| 7. Issues | Explicit dispositions and proof tests are recorded below; supersede PR #20, do not merge it. | #20 moves test tools into production dependencies and carries obsolete lockfiles. |
| 8. Config | Read `jlv.config.json` and legacy INI with deterministic precedence; no implicit writes to the home directory and no auto-executed project config. | Preserves data mapping without the v1 global state and security surprises. |
| 9. Release | Version bump + push to `master`; gates run before publishing the exact tested tarball if the version is absent. Retire `jlv-pino` only after the published replacement passes smoke tests. | Matches the owner flow while preventing premature deprecation or publishing the private workspace root. |

The bounded-file and format choices are deliberate scope corrections to the draft. They make 2.0 implementable without promising unlimited history, arbitrary XML, or total ordering of infinite streams. Owner-specific exceptions are isolated in the questions section.

## 3. Registry and maintenance evidence

Versions and UTC publication dates below were obtained with `npm view` on 2026-10-11. Maintenance checks use the default-branch commit date from the GitHub API, not its `updated_at` or `pushed_at` alone. Exact versions are the initial implementation pins; recheck advisories and registry metadata when implementation begins.

### 3.1 Terminal options

| Package checked | npm publication | Declared Node engine | Maintenance and Windows evidence | Disposition |
| --- | --- | --- | --- | --- |
| `blessed` 0.1.81 | 2015-09-03 | `>=0.8.0` | Default-branch head `eab243fc`, 2016-01-04; pure JS; recognizes `win32`/`windows-ansi`. | Behavior baseline only. |
| `neo-blessed` 0.2.0 | 2018-06-13 | `>=8.0.0` | Repository now `embarklabs/neo-blessed`; head `fa63a5db`, 2020-05-04. Published `lib/` differs from blessed in four files, including terminfo and list-table fixes. Pure JS; preserves the Box API. | Compatible candidate, explicitly stale rather than actively maintained. |
| `reblessed` 0.2.1 | 2023-02-12 | `>=8.10` | Head `10ee745d`, 2024-06-01. Pure JS runtime. Published TS declarations expose a callable returning `any` and omit dynamically exported widgets such as `Box`/`box`/`screen`. | A TypeScript implementation is not a strongly typed consumer API; no automatic preference over neo-blessed. |
| `@unblessed/blessed` 1.0.0-alpha.23 | 2025-12-09 | `>=22.0.0` | `vdeantoni/unblessed` is **archived**; head `d68dcf6e`, 2025-12-09. Its README reports Windows Terminal checks; alpha API, `@unblessed/core` plus optional image peers. | Reject for Node 20 and archive/alpha status. |
| `unblessed` 0.0.1 | 2025-05-18 | None declared | Unrelated package from `daniel-lucas-silva/unblessed`; not the scoped blessed replacement. | Do not confuse the package names. |
| `terminal-kit` 3.1.4 | 2026-07-19 | `>=16.13.0` | Head `c63ebdf8`, 2026-07-19; active. Eight direct dependencies. Open Windows controlling-TTY issue #194 and cross-platform maintainer request #164. | A different widget/input API means a rewrite; not selected for the faithful fork. |
| `ink` 8.0.0 | 2026-10-03 | `>=22` | Active, head `26d2c3f8`, 2026-10-03; React >=19.3, Yoga/WASM layout and a substantially larger dependency graph. | Reject for engine floor and rewrite scope. |
| `blessed-contrib` 4.11.0 | 2022-02-17 | None declared | Large legacy dependency tree. The upstream viewer's `src/` does not import it. | Remove after the port; do not port unused dashboard widgets. |
| `@types/blessed` 0.1.27 | 2025-12-06 | None declared | DefinitelyTyped declarations; depends on `@types/node: *`. No registry `@types/neo-blessed` or `@types/reblessed` package exists. | Pin and constrain resolution to Node 20 types; use a narrow boundary/shim rather than application `any`. |

Source repositories: [blessed](https://github.com/chjj/blessed), [neo-blessed](https://github.com/embarklabs/neo-blessed), [reblessed](https://github.com/kenan238/reblessed), [archived unblessed](https://github.com/vdeantoni/unblessed), [terminal-kit](https://github.com/cronvel/terminal-kit), [Windows input issue](https://github.com/cronvel/terminal-kit/issues/194), [Ink](https://github.com/vadimdemedes/ink), [blessed types](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/blessed). The Windows README claim for unblessed is upstream's claim, not a validation performed for this plan.

### 3.2 Build and lint options

| Package checked | npm publication | Engines / peer range | Decision |
| --- | --- | --- | --- |
| `eslint` 10.12.0 | 2026-10-02 | Node `^20.19.0 || ^22.13.0 || >=24` | Pin; flat ESM config. |
| `@eslint/js` 10.0.1 | 2026-02-06 | Same Node range; ESLint `^10` | Checked as the direct-base alternative. |
| `eslint-plugin-unicorn` 77.0.0 | 2026-10-03 | Node `>=22`; ESLint `>=10.4` | Pin; include `configs.recommended`, scoped to JS/TS. |
| `neostandard` 0.14.0 | 2026-10-08 | Node `^22.13.0 || >=24`; ESLint `^9.22 || ^10` | Owner's preferred style is viable; add typed quality rules rather than assume `ts: true` enables type-aware checks. |
| `typescript-eslint` 8.71.1 | 2026-10-05 | Node `^18.18 || ^20.9 || >=21.1`; ESLint through `^10`; TS `>=4.8.4 <6.1.0` | Pin; use scoped `strictTypeChecked`. |
| `typescript` 6.0.3 | 2026-04-16 | Node `>=14.17` | Choose this JS compiler, `tsc` only, with no bundler. |
| `typescript` 7.0.2 (registry latest) | 2026-07-08 | Node `>=16.20`; platform-specific native compiler packages | Reject initially: outside the parser's supported TS peer range and introduces native tool artifacts. |
| `@types/node` 20.19.43 | 2026-06-10 | No runtime engine | Pin to catch accidental use of Node 22+ APIs even when compiling under Node 24/26. |
| `pnpm` 12.9.1 (installed) / 12.11.2 (latest checked) | 2026-10-03 / 2026-10-09 | Node `>=18.*` in npm metadata | Pin `packageManager: pnpm@12.9.1`; update intentionally later. |
| `npm` 11.19.1 | 2026-08-26 | Node `^20.17 || >=22.9` | Known working publish CLI; explicitly verify npm >=11.5.1 in the release job. |

Use Node 24 LTS for contributor installation, lint, compilation, and trusted publishing. Set published `engines.node` to **`^20.19.0 || >=22.9.0`**: the floor is 20.19.0, and INI 6's engine range excludes Node 21 and early 22.x. Run emitted JS on 20.19.0, latest 20.x, 22.9.0, latest 22.x, 24.x, and 26.x. Node 20 is already EOL as of this research date; it remains a requested compatibility target, not the recommended development runtime. A consumer production install must not pull the lint/TS toolchain into runtime dependencies.

Sources: [Unicorn requirements and presets](https://github.com/sindresorhus/eslint-plugin-unicorn), [neostandard TS option](https://github.com/neostandard/neostandard#options), [typescript-eslint configurations](https://typescript-eslint.io/users/configs/), [TypeScript releases](https://github.com/microsoft/TypeScript/releases), [Node release status](https://nodejs.org/en/about/previous-releases), [npm OIDC requirements](https://docs.npmjs.com/trusted-publishers/).

### 3.3 Input/config/parser options

| Package checked | npm publication | Engine / implementation | Disposition |
| --- | --- | --- | --- |
| `tinyglobby` 0.2.17 | 2026-05-30 | Node `>=12`; TypeScript declarations; `fdir` and `picomatch` dependencies | Use for Windows-compatible glob expansion on every supported Node version. Node 20 has no `fs.glob`; do not build a glob parser or choose different glob semantics by Node version. |
| `fast-glob` 3.3.3 | 2025-01-05 | Node `>=8.6`; five direct dependencies | Valid alternative, but heavier than the required functionality. |
| `ini` 6.0.0 | 2025-10-22 | Node `^20.17 || >=22.9`; no runtime dependencies | Use only for legacy read compatibility, with `@types/ini` 4.1.1 (2024-06-09) and validation from `unknown`. |
| `ini` 7.0.0 (latest) | 2026-05-08 | Node `^22.22.2 || ^24.15 || >=26` | Reject for Node 20; pin 6 rather than pretend latest fits the engine floor. |
| `csv-parse` 7.0.3 | 2026-09-25 | No engine declared; ESM/CJS exports, built-in declarations, no dependencies, streaming API | Use; multiline quoting and CSV error/framing semantics justify the dependency. Compatibility was tested rather than inferred from the absent engine field. |
| `logfmt` 1.4.0 | 2023-12-17 | No engine declared; depends on old `split` 0.2.x and `through` 2.3.x | Reject; implement a small bounded logfmt scanner with documented grammar and fixtures. |
| `saxes` 6.0.0 | 2021-11-07 | Node `>=12.22.7`; streaming SAX, `xmlchars` dependency | Checked, but repository is now archived; not a new default dependency for v2. |
| `fast-xml-parser` 5.11.2 | 2026-09-29 | No engine declared; six direct dependencies | Active alternative to assess for a later XML-specific spike, not a full-file object parser added to v2 speculatively. |

Use `node:util.parseArgs`, `node:fs`, `node:stream/promises`, `node:string_decoder`, `node:tty`, `node:os`, and `AbortController` for the remaining infrastructure. Do not retain commander, minimist, lodash, event-stream, merge-files, tmp, karma, or the obsolete mocha/chai/sinon/coverage/jsdoc graph in the release. The chosen production dependency set is **neo-blessed 0.2.0, tinyglobby 0.2.17, ini 6.0.0, csv-parse 7.0.3**. Keep exact direct pins and a pnpm lockfile; updates are small tested commits.

Sources: [tinyglobby](https://github.com/SuperchupuDev/tinyglobby), [Node 20 fs API](https://nodejs.org/docs/latest-v20.x/api/fs.html), [INI](https://github.com/npm/ini), [CSV streaming API](https://csv.js.org/parse/), [logfmt](https://github.com/csquared/node-logfmt), [archived saxes](https://github.com/lddubeau/saxes), [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser). Registry publication timestamps are from `npm view`, not inferred from these documentation pages.

### 3.4 Small experiments actually performed

All installations, scripts, downloaded runtimes, and Git experiments are outside the source repositories, under `%TEMP%/jlv-v2-plan-20261011`. No commits were created. Downloaded official Windows ARM64 Node executables were checked against their `SHASUMS256.txt` entries.

- **Renderer:** blessed 0.1.81, neo-blessed 0.2.0, and reblessed 0.2.1 each rendered a box 1,000 times to a writable buffer, handled an injected arrow-key sequence, and resized from 80x24 to 100x30 on Node **20.19.0, 22.18.0, 24.15.0, and 26.10.0**. All retained one child and passed the assertions. This validates that small rendering path; it does not validate the complete viewer or actual terminal appearance.
- **Neo-blessed delta:** the installed `lib/` has four changed files against blessed, 56 added / 20 removed lines. Its terminfo implementation adds forced-Unicode handling and fixes the Windows Unicode override. This is the concrete benefit over simply keeping blessed; it remains a stale dependency we must be prepared to patch.
- **Lint composition:** `neostandard({ ts: true, noJsx: true })`, scoped `typescript-eslint.configs.strictTypeChecked` with `projectService: true`, and `unicorn.configs.recommended` compose without plugin registration or peer errors on Node 24.15 and 26.10. The typed sample passes; a deliberately unsafe JSON assignment/member access is rejected by `no-unsafe-assignment` and `no-unsafe-member-access`. Resolved rules retain `no-explicit-any`, `no-floating-promises`, and `no-misused-promises`. `ts: true` by itself is insufficient.
- **Naming:** in Unicorn 77, `prevent-abbreviations` is a deprecated renamed rule; recommended enables **`unicorn/name-replacements`**. Use `message`, `options`, `element`, `error`, and kebab-case files; do not configure the deprecated rule name or relax naming globally. External pino keys such as `msg` remain data keys.
- **TS:** the sample compiled with strict TypeScript 6.0.3 and Node 20 typings under Node 20.19 and 24.15. No runtime TS loader is needed.
- **Final plan examples:** extracted the exact public API block and flat ESLint config into a scratch workspace with the planned file paths. The API, a typed neo-blessed screen/box boundary, and its narrow declaration correction compiled with all planned strict flags and `skipLibCheck: false` on Node 20.19 and 24.15. All four files, including the config itself, linted with zero errors/warnings under the full scoped config on Node 24.15; two consecutive autofix passes changed zero files. This exposed and resolved the config-only top-level-composition exception documented below; it does not claim the entire legacy viewer has already been ported.
- **Parsers:** tinyglobby 0.2.17, ini 6.0.0, and csv-parse 7.0.3 passed the same smoke checks on all four runtimes. CSV input was split into 86 one-byte chunks, including a multibyte UTF-8 character, CRLF inside a quoted field, escaped quotes, and a comma. INI mapping and prototype-key rejection passed. These are compatibility samples, not a replacement for the adapter tests below.
- **Console:** with redirected process streams in this environment, `\\.\CONIN$` opened with `r+` and raw-mode enable/restore worked on Node 24.15 and 26.10. It failed at open on 20.19 and 22.18 because their path handling added a trailing slash. The fallback `\\?\GLOBALROOT\Device\ConDrv\Input` with `r+` worked on all four. This fallback is an observed compatibility workaround, **not a documented cross-version Node guarantee**. Validate it in Windows Terminal/PowerShell on ARM64 before releasing interactive pipe support. Check `isatty(fd)` before constructing a TTY stream; restore raw mode and close only owned descriptors.
- **History patch:** fetched upstream PR #13 into a scratch clone, exported its patch, and verified `git apply --check --directory=packages/jlv` against the imported subtree files. The source author is **Dima Sabanin**, author date 2018-12-04, SHA `e29eb7e7e5542e29e321f7b256b93194d808ac22`. A plain path-unadjusted cherry-pick after a subtree move is not a safe instruction; use an explicitly relocated author-preserving patch.

The Node console documentation now requires read/write access when reopening console input; the related Node fix was documentation, not a blanket implementation fix for all old versions. [Node TTY documentation](https://nodejs.org/api/tty.html#readstreamsetrawmodemode), [Node #63852](https://github.com/nodejs/node/issues/63852), [documentation PR #63856](https://github.com/nodejs/node/pull/63856), [Unicorn naming rule](https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/name-replacements.md).

### 3.5 Notable upstream forks

Compared the default branches of all **29 fork repositories returned by the API** with upstream master: 15 identical, 3 behind, 10 ahead, 1 diverged. The network's advertised fork count can include repositories that the listing does not return. No newer push should be imported wholesale.

| Fork inspected | Useful source / exact commit | Decision |
| --- | --- | --- |
| [farolanf/json-log-viewer](https://github.com/farolanf/json-log-viewer) | Sort cache invalidation `ae42be28857077f1c0dcb0f298c0ef8d6c6d951f`; page-up fix `80eade9fef2b910ae82280de341bfa5473ccd935`; detail scrolling `7758d957fbc02c7a252536b94d0fe6b0576222af`; custom-field sort `f03300b393c9a0cf6d00d571de929e4e7b4f4854`. | Adopt the three defect regressions after the TS port; defer arbitrary-field sorting. Relocate small original patches with author preservation if applicable; otherwise reimplement with explicit credit/provenance. |
| [Townsheriff/json-log-viewer](https://github.com/Townsheriff/json-log-viewer) | `0ec04d5ae3bc2d0b9fbd18c47877088ef3909117`, squashed farolanf changes. | Prefer original farolanf commits rather than losing attribution in this squash. |
| [danielannan17/json-log-viewer](https://github.com/danielannan17/json-log-viewer) | Persistent row element `8a1aef16c77ab91b731fdb32b03a73d25ffa3f0a`; periodic reload/local config `fc250d03f3ea3ac0e7dd7e5a02304c0b904c1d37`. | Adopt persistent-widget idea with credit; reject rereading the entire file every second as the follow implementation. |
| [israel-tsadok-silk/json-log-viewer](https://github.com/israel-tsadok-silk/json-log-viewer) | stdin support `493918a25e562b5902e557c509ab31f2a8cc12e8`. | Useful controlling-TTY precedent, but hard-coded `/dev/tty`/`/dev/stdin`, synchronous whole-stream reading, and console logging break Windows/live input. Reimplement. |
| [fabiankaestner/json-log-liveview](https://github.com/fabiankaestner/json-log-liveview) | Async load `96d3573c321e707a933c46e493d27bb4c022dc08`; watching `f0d15450374c775c1b0431065a60fc4d5afa39c5`; config `95c4115169377d6be3139d9aac95d3461021944a`; MIT notice `4604d35ef9888416791ed7a1268fcf07546e64f7`. | Reference/credit only, no broad formatting/config rewrite import. Its added license names Fabian Kästner and Felipe Coury; it does not establish an original upstream copyright notice. |
| [MokkeMeguru/json-log-viewer](https://github.com/MokkeMeguru/json-log-viewer) | `a999d1b5fa3da68e719de5ca71407ebce6c9f46b`, `fullUnicode: true`. | Carry the intent into the renderer configuration and Unicode tests. |
| [top-5/json-log-viewer](https://github.com/top-5/json-log-viewer) | JSON-array / full-body-message support `9ffba34755f6222dc05609acde78c5fe7dbad744`; latest 2026 commit only changes attribution settings. | Do not import its history/settings. Array implementation reads and rewrites the whole file; defer arrays until a streaming requirement exists. |
| [maragkose/json-log-viewer](https://github.com/maragkose/json-log-viewer) | Process column `640c8aa9a98c94ec9af923c1cd6e7941ebc23bc8`. | Preserve process metadata in fields; defer general configurable columns beyond correlation ID. |
| [wmnnd/json-log-viewer](https://github.com/wmnnd/json-log-viewer) / [pburkett/json-log-viewer](https://github.com/pburkett/json-log-viewer) | Dependency update PR #20 / lockfile-only `991e011f692e4773951fe80557bc23f11264b59d`. | Superseded by the new dependency graph and pnpm lockfile. |

Record every adopted patch in `docs/upstream-provenance.md` with repository, original SHA, original author, affected behavior, and the local commit. Preserve any license notices for copied fork code. Use `Co-authored-by` only for an actual coauthor, not as a substitute for preserving a patch author.

## 4. Target repository and TypeScript quality gates

### 4.1 Workspace layout and published surface

```text
package.json                   private: true; type: module; pnpm scripts/tools
pnpm-workspace.yaml            packages: [packages/*]
pnpm-lock.yaml                 the only active dependency lockfile
eslint.config.js               ESM flat configuration
tsconfig.base.json             strict compiler defaults, Node 20 API target
tsconfig.json                  no-emit project covering source, tests, scripts
tsconfig.test.json             emits source + TS tests into .test-dist/
.github/workflows/publish.yml  checks and conditional OIDC publication
scripts/
  run-tests.ts                 discover emitted .test.js files, run node --test
  check-package.ts             tarball manifest/content/install/API/bin checks
  prepare-package.ts           copy README, LICENSE, attribution into package
packages/
  jlv/
    package.json               jlv@2.0.0; the only public workspace
    tsconfig.json              nearest project for source/test lint service
    tsconfig.build.json        src/ -> dist/; JS, declarations, source maps
    src/
      cli.ts                   shebang; argument parsing and lifecycle only
      api.ts                   public record/format/plugin/filter types
      application.ts           connect sources, adapters, store, output, TUI
      configuration.ts         validated JSON and legacy INI read precedence
      plugins.ts               explicit loading, version/shape validation
      record.ts                timestamp/level/message/correlation normalization
      field-path.ts            safe own-property lookup; no eval/set operations
      filters.ts               typed predicates, AND/OR groups, profiles
      input/{files,lines,follow}.ts
      formats/{index,json-lines,pino,bunyan,winston,logfmt,csv,docker}.ts
      store.ts                 bounded records, revisions, selection identifiers
      output.ts                plain/JSONL streams, explicit save destination
      tui/
        blessed-boundary.ts    sole backend import; typed callback normalization
        base-widget.ts        faithful successor of BaseWidget.js
        main-panel.ts         faithful successor of MainPanel.js
        log-details.ts        faithful successor of LogDetails.js
        picker.ts             faithful successor of Picker.js
        status-line.ts        faithful successor of StatusLine.js
        formatting.ts         successor of utils.js, trusted styling/escaping
      types/neo-blessed.d.ts   compatibility declaration using blessed types
    test/                     TypeScript unit, headless TUI, CLI/integration tests
    README.md, LICENSE, NOTICE.md
  format-fixtures/
    package.json               name: jlv-format-fixtures; private: true
    src/catalog.ts             typed fixture catalogue/expected results
    fixtures/                 UTF-8/CRLF/chunked/malformed/format regression corpus
docs/{formats,migration,configuration,upstream-provenance}.md
```

Use the private fixture workspace as the home for pino migration cases and the common adapter corpus. It is test data, not a second format abstraction or runtime dependency. Import `Defkil/jlv-pino` history into a temporary `packages/jlv-pino` subtree in a separate commit, move its fixtures/provenance into this workspace, and retire its JS transformer/package before release. Built-in pino code lives at `packages/jlv/src/formats/pino.ts`. No `jlv-pino` successor package, npm scope, turbo, Nx, Lerna, Changesets, or release bot is needed.

`jlv/package.json` has `type: "module"`, `engines: { "node": "^20.19.0 || >=22.9.0" }`, `bin: { "jlv": "./dist/cli.js" }`, `types: "./dist/api.d.ts"`, and explicit exports for `.` (API/types) and `./formats` (built-in adapters). `files` includes `dist/`, README, LICENSE, and NOTICE only. Set `repository.directory` to `packages/jlv`. The main API must have no import-time CLI/TUI effects. Public declarations must not expose blessed classes or require consumers to install dev-only typings.

Output is **ESM only**, not dual ESM/CJS. The old wrapper's programmatic CommonJS API is removed in the major version; document the new API and `import()` migration. NodeNext interop permits the CommonJS terminal backend, INI library, and explicitly loaded CommonJS plugins. Use `.js` relative specifiers in TS source, `import type`, `node:` built-in imports, and kebab-case filenames from the beginning. No runtime path aliases or compiler-only module resolution tricks.

### 4.2 Compiler and test execution

Use TypeScript 6.0.3 with `target: ES2022`, `module/moduleResolution: NodeNext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`, and `forceConsistentCasingInFileNames`. Turn on `noEmitOnError`; keep `skipLibCheck: false`. Build declarations and source maps, with inline sources if maps are shipped. Production build includes only `src`; a separate test build preserves the repository-relative source/test/fixture layout under `.test-dist`.

Use `unknown` at JSON, INI, CSV, event, and plugin boundaries; narrow it with real guards. No application `any`, `as any`, double assertions through `unknown`, `@ts-ignore`, or a fake ambient declaration that turns the backend into `any`. Reuse `@types/blessed` in an ESM-compatible neo-blessed declaration: `import type * as blessed from 'blessed'`, declare a default `terminalLibrary` object, and correct only its `screen` factory via `Omit<typeof blessed, 'screen'>`. The checked declarations incorrectly type `IScreenOptions.output` as `Readable`; its actual runtime contract is a writable stream. Define `ScreenOptions = Omit<blessed.Widgets.IScreenOptions, 'output'> & { output?: Writable }` and `screen(options: ScreenOptions): blessed.Widgets.Screen`, importing `Writable` as a type from `node:stream`. This avoids an `export =`/require-style lint exception and unsafe casts. The boundary normalizes loose event payloads and nullable callbacks before they enter application logic. Pin `@types/node` 20.19.43 for all workspace type resolution, including the `@types/blessed` wildcard dependency. Resolve other third-party declaration problems with similarly small documented corrections, not by disabling lib checking globally.

Tests are authored in TS, emitted with `tsc -p tsconfig.test.json`, and run as **JS with `node:test` on every supported Node major**. `scripts/run-tests.ts` discovers emitted files and passes their explicit paths to `node --test`; do not rely on shell glob expansion on Windows or Node 20's test runner. No tsx, ts-node, browser runner, or test bundler. Native type stripping on 22.18+/24/26 is optional for scratch scripts; it is not the repository test strategy. Compiled consumer JS is mandatory because Node refuses TS execution inside `node_modules`. [Node 22 type stripping](https://nodejs.org/docs/latest-v22.x/api/typescript.html), [dependency type stripping restriction](https://nodejs.org/api/typescript.html#type-stripping-in-dependencies).

Quality scripts: `typecheck`, `lint` (`eslint --max-warnings 0`), `build`, `test:build`, `test`, and `check:package`. `test` must compile before executing when run locally; CI can call the emitted-test runner directly after downloading the quality job's build. During a module-by-module port, already-ported files pass these gates on each commit; the final port commit has no legacy JS application modules or skipped legacy behavior tests.

### 4.3 ESLint composition and justified exceptions

Choose **neostandard 0.14.0 + typescript-eslint 8.71.1**, not the direct `@eslint/js` alternative: this preserves Oliver's established style and the checked combination works with ESLint 10.12.0 and Unicorn 77.0.0. Use the installed package's API, not an older copied config snippet:

```js
import { defineConfig } from 'eslint/config'
import { neostandard } from 'neostandard'
import typescriptEslint from 'typescript-eslint'
import unicorn from 'eslint-plugin-unicorn'

const typedFiles = ['packages/**/*.ts', 'scripts/**/*.ts']
const codeFiles = ['**/*.{js,mjs,ts}']

export default defineConfig([
  { ignores: ['**/node_modules/**', '**/dist/**', '.test-dist/**', '.artifacts/**'] },
  ...neostandard({ ts: true, noJsx: true }),
  {
    files: typedFiles,
    extends: [typescriptEslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    }
  },
  { files: codeFiles, extends: [unicorn.configs.recommended] },
  {
    files: codeFiles,
    rules: {
      // Node 20 has no Array.fromAsync; retain bounded async iteration.
      'unicorn/prefer-array-from-async': 'off',
      // Node 20 has no iterator helper methods.
      'unicorn/prefer-iterator-helpers': 'off',
      // Node 20 iterators have no toArray method.
      'unicorn/prefer-iterator-to-array': 'off',
      // Reordering iterator chains would depend on helpers absent from Node 20.
      'unicorn/prefer-iterator-to-array-at-end': 'off',
      // Iterator.zip is outside the supported Node 20 runtime API.
      'unicorn/prefer-iterator-zip': 'off',
      // Promise.try is unavailable on Node 20.
      'unicorn/prefer-promise-try': 'off',
      // Promise.withResolvers is unavailable on Node 20.
      'unicorn/prefer-promise-with-resolvers': 'off'
    }
  },
  {
    files: typedFiles,
    rules: {
      // TSDoc comments must retain their standard layout in public declarations.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off'
    }
  },
  {
    files: ['packages/jlv/src/tui/blessed-boundary.ts', 'packages/**/test/**/*.ts',
      'packages/format-fixtures/src/**/*.ts'],
    rules: {
      // Blessed callbacks and JSON regression fixtures legitimately contain null.
      'unicorn/no-null': 'off'
    }
  },
  {
    files: ['eslint.config.mjs'],
    rules: {
      // ESLint's flat config composes presets when its configuration module loads.
      'unicorn/no-top-level-side-effects': 'off'
    }
  }
])
```

The seven newer-runtime preferences are enabled by the checked recommended preset; leaving them on would encourage Node 22+ APIs despite the declared Node 20 runtime. Node 20 typings and packed-package execution remain the backstop. Keep all other recommended Unicorn rules, including filename-case, name-replacements, prefer-module, prefer-node-protocol, and no-null outside the scopes above. The config-only top-level-side-effects exception permits ESLint preset composition; application modules retain that rule. JSON `null` in a type union does not require a global no-null exception; use `undefined` for absent application values.

Every **local** off/warn/relaxed rule or broadened rule option must carry an adjacent one-line justification in the final ESLint config. Inherited preset adaptations are library-owned, not local exceptions to copy wholesale. Report unused disable directives and descriptions. Treat duplicate replacement rules in config order deliberately: neostandard first, typed rules second, Unicorn third, only documented exceptions last. Check representative source, CLI, tests, declaration shim, and config files with `--print-config`; check two consecutive `--fix` runs produce no competing autofixes. No broad ignore of TUI code and no blanket disable of the unsafe TS rules.

## 5. Internal record, format, plugin, and filter contracts

The faithful port initially preserves upstream's `{ timestamp, level, message, data }` view shape. Introduce this final model only in the subsequent normalization phase; keep a compatibility adapter while migrating widgets so the port remains reviewable.

```ts
export type JsonValue =
  | string | number | boolean | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }
export type JsonObject = { readonly [key: string]: JsonValue }
export type FieldPath = readonly (string | number)[]
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'unknown'
export type TimestampUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'

export interface RecordPosition {
  readonly recordNumber: number
  readonly firstLine: number
  readonly lastLine: number
}
export interface SourceInformation {
  readonly identifier: string
  readonly label: string
  readonly order: number
}
export interface LogDraft {
  readonly timestamp?: number // finite epoch milliseconds
  readonly timestampText?: string // original display text if not parseable
  readonly level: LogLevel
  readonly message: string
  readonly correlationIdentifier?: string
  readonly fields: JsonObject // complete original data, not just consumed extras
}
export interface LogRecord extends LogDraft {
  readonly identifier: string // assigned centrally: source + monotonic record number
  readonly source: SourceInformation
  readonly position: RecordPosition
}
export interface FieldMapping {
  readonly timestamp?: FieldPath
  readonly level?: FieldPath
  readonly message?: FieldPath
  readonly correlationIdentifier?: FieldPath
}
export interface FormatContext {
  readonly signal: AbortSignal
  readonly source: SourceInformation
  readonly maximumRecordSize: number
  readonly mapping: FieldMapping
  readonly timestampUnit: TimestampUnit
}
export interface FormatSample {
  readonly text: string
  readonly extension?: string
}
export interface ParseDiagnostic {
  readonly kind: 'diagnostic'
  readonly severity: 'warning' | 'error'
  readonly code: string
  readonly message: string
  readonly position?: RecordPosition
}
export type ParseEvent =
  | ParseDiagnostic
  | { readonly kind: 'entry'; readonly value: JsonObject; readonly position: RecordPosition }
export interface NormalizationResult {
  readonly record: LogDraft
  readonly diagnostics: readonly ParseDiagnostic[]
}
export interface LogFormat {
  readonly identifier: string
  probe(sample: FormatSample, context: FormatContext): number // 0..100; no I/O
  read(input: AsyncIterable<Uint8Array>, context: FormatContext): AsyncIterable<ParseEvent>
  normalize(value: JsonObject, context: FormatContext): NormalizationResult
}
export type RecordPredicate = (record: LogRecord) => boolean
export interface FormatPlugin {
  readonly apiVersion: 1
  readonly formats: readonly LogFormat[]
  readonly predicates?: Readonly<Record<string, RecordPredicate>>
}
export type FilterClause =
  | { readonly field: FieldPath; readonly operator: 'equals'; readonly value: JsonValue }
  | { readonly field: FieldPath; readonly operator: 'contains'; readonly value: string }
export interface FilterGroup {
  readonly mode: 'all' | 'any'
  readonly clauses: readonly FilterClause[]
}
```

`LogFormat.read` owns framing, so a CSV reader is not incorrectly forced through JSON line splitting. JSONL profiles reuse one reader and differ in `probe`/`normalize`; there is no arbitrary transform pipeline abstraction. Normalization assigns no global identifiers, changes no raw fields, and has no filesystem/config side effects; it returns warnings with its draft. Core adds source/position/identity, validates plugin results, and catches format errors as diagnostic events. Missing optional time/level values are permitted; a missing mapped message becomes an empty string with a warning, rather than `undefined`. Strict mode aborts on error diagnostics, not optional-field warnings. Follow continues record numbering across rotations for a source; IDs never depend on a sorted row index or a random UUID. Construct each built-in adapter with its validated options (such as the CSV delimiter), while keeping per-source parser state inside its reader.

Normalization rules:

- Parse JSON into `unknown`, accept only object records, and validate recursively as JSON values with finite numbers and bounded nesting (default depth 64). Arrays, primitives, and malformed rows are diagnostics in JSONL. Preserve `null`, `false`, zero, empty strings, nested arrays, and original level/time fields.
- Normalize known string levels case-insensitively; accept `warning -> warn`, `err -> error`, `critical -> fatal`. Pino/bunyan map 10/20/30/40/50/60 to trace/debug/info/warn/error/fatal structurally. Unrecognized numeric or text levels remain `unknown` with their original value in `fields`; do not apply the pino scale to every JSON producer.
- Parse RFC3339/ISO timestamps with an explicit zone. Generic numeric timestamps default to **milliseconds**; `--timestamp-unit` or config can select seconds/microseconds/nanoseconds. Numeric strings are accepted only as mapped timestamps with an explicit unit. Pino/bunyan profiles define their own units. Validate range and finiteness; epoch zero is valid. Convert decimal nanosecond strings using BigInt before reducing to milliseconds, preserving original precision in fields. Do not silently guess units by digit count or silently assign a timezone to naive date strings. Unparseable/naive legacy strings remain visible as `timestampText` with one aggregated warning.
- UTC ISO display and numeric timestamp sorting are deterministic; missing/invalid times sort last in both directions. Level sort uses severity order trace/debug/info/warn/error/fatal, with unknown last, rather than alphabetic level names. Equal keys retain source order, then source record number. Treat message strings as text; stringify structured message values using bounded JSON formatting, never `[object Object]`.
- Correlation mapping wins if explicit; otherwise inspect exact known paths such as `correlationId`, `correlation_id`, `requestId`, `req.id`, `trace_id`, and `traceId` in that order. Preserve numeric zero identifiers by converting valid finite scalar IDs to strings. This is correlation display/filtering, not a claim of full ECS/OTel parsing.
- Field lookup uses own properties only; a new JSON mapping path is an array of segments (`["datetime", "date"]` or `["log.level"]`). Legacy dotted/bracketed paths are parsed into segments without eval. Original fields with punctuation stay accessible without ambiguous dot splitting in new configs.

Plugins load only from an explicit `--plugin <file-or-installed-module>` option; resolve module specifiers relative to the invocation directory, local paths through `pathToFileURL`, and import default ESM/CommonJS exports. Require `apiVersion: 1`, unique IDs, callable methods, and a valid output shape. Fail with an actionable source/plugin name on mismatch. No npm auto-install, config-discovered JS, remote URL imports, eval, or executable expressions in JSON/INI. A loaded plugin is trusted application code, not a sandbox; document this once at the CLI/API boundary. A `--predicate <name>` can select a predicate exported by an explicitly loaded plugin. Saved profiles remain declarative and do not serialize closures.

## 6. Inputs, formats, configuration, and user-visible behavior

### 6.1 CLI and stream behavior

Keep CLI handling in `cli.ts` with `util.parseArgs`, a usage string, version output, and errors for unknown/removed options. Supported first-release surface:

```text
jlv [files-or-quoted-globs...] [-] [options]
--files/-f <glob>               repeatable legacy-compatible input alias
--format <auto|jsonl|pino|bunyan|winston|logfmt|csv|docker>
--follow                        file append/truncate/rotation; pipes are already live
--sort <timestamp|-timestamp|level|-level|message|-message|arrival>
--level/-l <level>              normalized, case-insensitive exact level filter
--config/-c <path>              explicit JSON or legacy INI
--no-config                     ignore all discovered config
--timestamp-unit <seconds|milliseconds|microseconds|nanoseconds>
--output <auto|tui|plain|jsonl>  auto chooses TUI only with usable terminal I/O
--max-records <n>               default 50000 retained TUI records; positive integer
--max-bytes <n>                 default 67108864 estimated retained bytes
--strict                        fail on first malformed record
--where <JSON clause>           repeatable typed clause; AND by default
--profile <name>                named declarative filter group from config
--plugin <file-or-module>       repeatable explicitly trusted plugin
--predicate <name>              exported predicate from an explicit plugin
--save/-s <path>                stream normalized matching JSONL to a new file
--overwrite                    required to replace an existing save destination
--help/-h, --version
```

Preserve upstream `-l/--level`; preserve upstream `-s` for sort **only in documented migration examples as `--sort`**, since the wrapper already uses `-s` for save. Reject `--param`, `--open`, `--reset`, `--backup`, `--transformer`, and `--transformer-js` with a specific migration hint; do not silently ignore them. Accept `--sort=-timestamp` reliably with parseArgs. Use `--` for dash-prefixed paths. Do not execute a shell, overwrite `process.argv`, or launch a terminal.

Expand inputs with tinyglobby consistently on all Node versions. An existing literal path wins before treating metacharacters as a pattern. Deduplicate canonical paths, preserve explicit argument order, sort each glob's matches deterministically, and reject unmatched patterns with the pattern in the error. Do not consume piped stdin when explicit files are supplied unless `-` is also specified. No inputs + non-TTY stdin means stdin; no inputs + TTY stdin means usage error. Finite inputs are read record-by-record in deterministic source order; live sources run concurrently with bounded backpressure and source IDs.

Framing uses UTF-8 incremental decoding; support BOM at the start, LF/CRLF, multibyte characters and records crossing arbitrary chunks. At finite EOF, parse a final unterminated line. During follow, hold it until newline or source rotation/closure. The line reader caps a record at 1 MiB before JSON parsing and drains oversize input to the next delimiter with a diagnostic. CSV uses its parser's `max_record_size: 1048576` character limit (not falsely labeled a byte limit), plus normalized retained-byte accounting. No pretty-printed multi-line JSON objects or top-level JSON arrays in 2.0. Document conversion to JSONL instead.

For `node app | jlv`, use stdin only for logs and a separate keyboard stream: POSIX `/dev/tty` opened with `r+`; Windows `\\.\CONIN$` with `r+`, then the observed ConDrv fallback after verifying `isatty`. Reuse process stdin for keys only when it is a TTY and not a log source. Render to TTY stdout. `auto` uses plain stdout if stdout is redirected or console input cannot be acquired; explicit `tui` fails with a useful error instead of hanging. No native node-pty dependency. Route active-TUI parse counts/warnings into status, and machine-mode diagnostics into stderr; never contaminate JSONL stdout. Restore raw mode, cursor, alternate buffer, listeners, timers, and owned descriptors on quit, Ctrl-C, input failure, and broken output pipes. Follow/ingestion use one AbortController; exiting must not leave a busy loop or a pending process.

File follow uses a 500 ms **polling** cycle rather than relying exclusively on unreliable cross-platform `fs.watch` notifications. Track identity (`dev`/`ino` where meaningful), byte offset, and decoder/partial-record state; follow the path across rename/recreate, restart after shrink, retry temporarily absent files, and avoid replaying already-read bytes. Freeze glob membership at startup; do not promise directory-wide discovery. Preserve selection by record identifier when new records arrive. Closed-file incomplete records produce a counted diagnostic if they cannot be parsed. CSV follow must retain its header/quote state and restart it on replacement.

Default finite-file view sorts the retained set by `-timestamp`, preserving upstream's newest-first intent. Default live mode is `arrival`, with follow-to-newest until the user navigates away; `--sort` explicitly overrides. The store retains the last ingested records under both caps, **not the globally newest timestamps**; show retained/seen/evicted counts continuously. Do not imply exact chronological merge while sources remain live. Re-sort/filter on data or query revision, never on each cursor move; cap redraws to 10/second and keep viewport rendering O(terminal height).

The JSONL/plain machine output and `--save` stream all matching entries in arrival/source order and respect backpressure; TUI eviction does not truncate an export. Do not support sorted machine export in 2.0: reject non-arrival `--sort` with explicit machine output, instead of quietly buffering/truncating an unlimited stream. Save uses exclusive file creation by default, verifies the output is not an input, and normalizes records after parsing rather than copying raw byte interleavings. Exact unlimited browsing/external sorting is deferred; an owner requirement for it changes the storage phase.

Exit codes: 0 for normal completion/quit or empty valid input; 1 for I/O, plugin, or strict-record failure; 2 for CLI/config errors; 130 for Ctrl-C. Default malformed records are skipped with source/line diagnostics and an aggregate count; suppress per-line flooding. If nonempty input contains no usable records, return 1 with a sample diagnostic. Treat expected EPIPE from a downstream consumer closing early as normal termination.

### 6.2 Built-in format scope

Detect each source independently, replaying a bounded sample (at most 64 KiB and 32 complete records) into the chosen reader. Do not discard sampling bytes. Begin displaying/waiting immediately; for live input stop waiting for additional sample data after 200 ms from the first complete candidate. A reader is selected once per source and reset only on file replacement. Strong signatures beat generic JSON; ties use a deterministic registry order with a status note and `--format` advice. Invalid leading records do not prevent later valid records from identifying a source. Generic JSONL is the fallback for object lines, not automatic acceptance of arbitrary text.

| Format | 2.0 behavior / detector | Acceptance fixtures |
| --- | --- | --- |
| JSONL | Default object-per-line `timestamp`, `level`, `message`; explicit mappings override. Unknown fields retained. | Existing upstream normal/Monolog fixtures, malformed/missing/null/false/0 values, chunk splits, mapped nested fields. |
| pino | Numeric or recognized text level, `msg`, numeric epoch-ms `time`; support explicit renamed keys/custom levels via mapping. | Six levels, fatal final row, spaces around colons, `level` text inside messages/nested objects, split level tokens, absent time/msg, large error object. |
| bunyan | Strong `v: 0` signature with `name`/`hostname`/`pid`/`msg`; time is ISO or explicit numeric mapping; same six-level numeric scale. | Valid Bunyan records and structurally similar JSON that must remain generic. |
| Winston JSON | Alias/profile for JSONL `timestamp`, `level`, `message`; no detector claiming every customizable Winston transport has one schema. | Modern JSON plus uppercase levels; metadata is preserved; text/colorized transports are outside this adapter. |
| logfmt | Line-oriented key=value scanner; quoted values with escaped quote/backslash, empty values, bare flags, duplicate-key policy last-wins with diagnostic. Common aliases `time`/`timestamp`, `msg`/`message`, `level`. Preserve strings; bare flags become true. | Quoted spaces/equals, escapes, empty values, malformed quotes, duplicates, UTF-8, epoch-unit mapping. No old logfmt dependency. |
| CSV | Header required; comma/double-quote default, configurable one-character delimiter; no implicit data type casts. Auto only when a valid header contains a mapped message column. Validate duplicate/missing headers and inconsistent row widths. | CRLF, BOM, quoted comma/newline/escaped quotes, header-only file, malformed/incomplete quoted record, mapped column names, parser size cap. |
| Docker JSON envelope | Detect `log` string + `stream` stdout/stderr + `time`. Parse a single JSON object embedded in `log` when possible and normalize it; otherwise use the text as message. Preserve envelope metadata in a dedicated field without collisions. | JSON/pino inner message, plain message, escaped newline, fractional timestamp, malformed inner JSON, stderr stream; distinguish Docker file envelopes from raw `docker logs` output. |

Do not depend on pino, bunyan, winston, Docker, or an OpenTelemetry SDK just to parse their output. [Pino record/key options](https://github.com/pinojs/pino/blob/main/docs/api.md), [Bunyan record example](https://github.com/trentm/node-bunyan), [Docker json-file envelope](https://docs.docker.com/engine/logging/drivers/json-file/).

**Deferred:** XML, generic JSON arrays/pretty JSON, syslog RFC3164/5424, GELF numeric-level semantics, ECS-specific mapping presets, and OTLP/OTel batches. ECS-like JSONL can already use field mappings. GELF uses a different numeric severity scale and timestamp unit; OTLP JSON contains nested resource/scope/batch records and nanosecond strings, so neither should be advertised as supported just because JSON.parse succeeds. [OTLP file export framing](https://opentelemetry.io/docs/specs/otel/protocol/file-exporter/).

The first XML targets to consider are **Log4j 1 XMLLayout / log4net XmlLayoutSchemaLog4j** (`log4j:event` fragments), **native log4net XmlLayout** (a different event schema), and **Log4j 2 XmlLayout** (`Event`/`Events` and a different namespace). Log4j 1's own documentation explicitly says it emits fragments rather than a complete XML document; a `.xml` extension cannot identify the event layout or make line splitting correct. Implement a named layout only after obtaining a real fixture, including namespaces, CDATA, exceptions, timestamp units, encoding, and incomplete live fragments. Reject external entities/DOCTYPE processing; choose an event-streaming parser after a bounded-memory spike. `saxes` being archived is a reason to reassess it, not silently assume all SAX alternatives are maintained. Current Log4j guidance favors JSON Template Layout. [Log4j 1 XMLLayout](https://logging.apache.org/log4j/1.x/apidocs/org/apache/log4j/xml/XMLLayout.html), [log4net native source](https://github.com/apache/logging-log4net/blob/master/src/log4net/Layout/XmlLayout.cs), [log4net Log4j source](https://github.com/apache/logging-log4net/blob/master/src/log4net/Layout/XmlLayoutSchemaLog4j.cs), [Log4j layout guidance](https://logging.apache.org/log4j/2.x/manual/layouts.html).

### 6.3 Config, profiles, correlation, and display safety

Precedence: CLI overrides > explicit `--config` file (error if absent/invalid; no discovery) > one selected discovered file > defaults. Discovery order is cwd `jlv.config.json`, cwd `.json-log-viewer`, home `jlv.config.json`, home `.json-log-viewer`; select the first existing file, do not merge hidden home mappings underneath a project file. `--no-config` disables discovery. No ancestor-directory search, JS config loading, generated home config, reset, or backup side effects. Show the selected config path and format in status / `--help` documentation.

JSON config version is 1; validate known keys and reject misspellings. It covers mapping paths, timestamp unit, format override, CSV delimiter, memory limits, and named declarative filter profiles. INI `[transform]` maps timestamp/message/level/correlation IDs and arbitrary extras. Its additional keys and `extra=$` remain in the legacy detail-view adapter, referencing the original object under `extra` without a deep clone; the final record's `fields` remains the complete untouched source object. Document this distinction for consumers of v2's API. Legacy mapping failures warn with the field path, never print `undefined` as a timestamp. Parse/validate once per invocation and pass config explicitly, replacing upstream's process-global `_transform` cache.

All repeated CLI clauses and level filters are ANDed; a profile may explicitly use `all`/`any`. `equals` is type-aware (0/false/null are values); `contains` is literal, case-insensitive text matching. No regex/query-language implementation or executable closure expressions in 2.0 config. TUI `f` becomes an additive filter manager with add/remove/clear and profile selection; preserve `l`, `/`, `n`, sort, paging, details, and quit controls. Add `c` to filter by the selected correlation identifier; add `?` as visible key help, documenting the upstream undocumented `?` search shortcut change. Keep `j` for JSON detail toggle and allow PageUp/PageDown/Home/End in details.

Correlation IDs get an optional list column and a deterministic finite color palette computed without a growing ID-to-color map. Same ID uses the same color across view changes; different IDs may share a color, so text remains the identifier. Mapping, filter state, and selection are independent of color. Handle missing/empty IDs without selecting unrelated records.

Every user-controlled message, path, key, value, filter, and label passes through one display sanitizer: strip terminal escape sequences with `util.stripVTControlCharacters`, make remaining control characters visible, and escape blessed tags before adding trusted color/style wrappers. Bound recursion and display length, handle empty objects, and truncate by display width without splitting surrogate pairs. The slash in issue #18 remains literal text; never use an unescaped log field as blessed markup. Preserve original JSON values in fields and JSONL output; sanitization is for terminal rendering only.

## 7. Upstream issues and pull requests

These are local fork dispositions, not claims that the upstream tickets have been closed. The implementer can resolve equivalents in `Defkil/jlv`; upstream closure requires upstream maintainers. Link the original ticket and resulting commit/test in the provenance document.

| Upstream item | Decision | Phase and proof |
| --- | --- | --- |
| [#4 transform](https://github.com/gistia/json-log-viewer/issues/4) | Implement documented `--config`, read-only legacy INI, explicit mapping paths, help, and format/plugin selection. The issue concerns discovering a mapping file, not necessarily a JS transformer. | Phases 4/6: CLI help/config precedence, absent/invalid path, legacy Monolog/`extra=$`, no-home-write tests. |
| [#6 security issues](https://github.com/gistia/json-log-viewer/issues/6) | Remove the obsolete production/dev graph; review current lockfile advisories and sanitization/prototype boundaries. Do not copy an old `npm audit fix` result or PR #20 lockfiles. | Phase 4: runtime-dependency inventory, advisory review, no karma/native/browser graph; phase 7: malicious markup/ANSI/prototype-key regressions; phase 8: clean tarball install. |
| [#7 logfile documentation](https://github.com/gistia/json-log-viewer/issues/7) | Document JSONL framing, exact schema/default mappings, examples, timestamp units, diagnostics, accepted formats, and unsupported arrays/pretty JSON. | Phase 6/8: executable README examples, all-invalid input error, missing-map warnings, format fixture catalogue. |
| [#12 read from pipe](https://github.com/gistia/json-log-viewer/issues/12) | Implement live stdin and independent controlling-terminal keyboard input; automatic plain fallback without a TTY. Cover PowerShell and Linux. | Phase 5: split input, delayed writes before EOF, EOF/Ctrl-C/EPIPE, no-terminal child-process tests; manual Windows Terminal ARM64 gate. |
| [PR #13 memory/performance](https://github.com/gistia/json-log-viewer/pull/13) | Integrate original patch with author preservation, then supersede the child cleanup with one persistent content widget and explicit query revisions. | Phase 2 patch/characterization; phase 4: stable widget/listener counts after 10,000 navigation/render/detail cycles, no repeated sorting on cursor moves. |
| [#14 case-insensitive level filter](https://github.com/gistia/json-log-viewer/issues/14) | Normalize case and aliases before filtering; add trace/fatal/unknown. | Phases 6/7: INFO/info/mixed-case and numeric pino/bunyan levels, exact level semantics, unknowns preserved. |
| [#15 correlation ID](https://github.com/gistia/json-log-viewer/issues/15) | Implement mapping, optional list column, deterministic bounded color palette, and `c` to filter selected ID. | Phase 7: IDs 0/missing/empty/nested, selection across sorting/append/eviction, same-ID color equality, clear filter. |
| [#16 epoch timestamps](https://github.com/gistia/json-log-viewer/issues/16) | Support explicit epoch units and profile defaults; sort numerical time, preserve raw precision. | Phase 6: seconds/ms/us/ns, zero/negative/range errors, numeric string with explicit unit, fractional ISO, invalid/naive strings remain visible. |
| [#18 colors and slash](https://github.com/gistia/json-log-viewer/issues/18) | Fix with literal text escaping and separation of trusted tags from payloads; test the ticket's slash fields. Do not just change a regex. | Phase 7: slashes, backslashes, literal braces/tags, ANSI CSI/OSC, nested detail keys/values, labels and clipping do not alter row colors. |
| [#19 filter improvements](https://github.com/gistia/json-log-viewer/issues/19) | Implement multiple clauses, explicit AND/OR profile groups, profile selection, and typed trusted predicates via an explicit plugin. Decline serialized/evaluated closures in config. | Phase 7: earlier clauses cannot be discarded (upstream reduce bug), 0/false/null comparisons, profile round-trip, predicate errors, no-config-execution tests. |
| [PR #20 package updates](https://github.com/gistia/json-log-viewer/pull/20) | Superseded; acknowledge Philipp/wmnnd's installability report in provenance. Do not merge a patch adding eslint/karma/mocha/nodemon to runtime dependencies. | Phase 4 dependency replacement and phase 8 package/dependency audit prove the replacement. |

Additional fork-derived regressions: sort changes must invalidate cached order immediately; PageUp from a partial first page must reach the beginning; details scroll and close without accumulating widgets; empty logs and tiny terminal dimensions must never create negative widths/cursors. Keep these separate from the faithful TS port.

## 8. Phased implementation and acceptance criteria

Each phase ends with small Conventional Commits and its listed proof. No pull requests are proposed. New integration/port/feature commits are distinct; original history imported by subtree keeps its historical subjects. The checks below are implementation requirements, not tests already completed by this planning task.

### Phase 0 — settle the remaining boundary spikes in scratch

1. Exercise an upstream MainPanel/LogDetails/Picker/StatusLine together through the intended typed blessed boundary; the current small box spike is only a baseline. Confirm callbacks, dimensions, null cancellation, Unicode, color depth, and type declarations under strict TS. Keep blessed for the first faithful port and neo-blessed for the later backend change.
2. In Windows Terminal + PowerShell on ARM64, verify real keyboard input while stdin is a live pipe on 20.19, 22.9/latest 22, 24, and 26: arrows, Enter/Escape, Ctrl-C, resize, raw-mode restoration, and a child process with no console. Compare Linux `/dev/tty` behavior. No browser or UI automation tooling; headless tests plus a short manual terminal checklist.
3. Prototype bounded record retention with 1 million generated ~512-byte records and compare baseline/proposed memory and input-to-first-render latency. Test slow output backpressure and cancellation. Do not build a disk index unless the owner needs complete-history browsing.
4. Verify the final flat config against representative declarations, tests, CLI, and backend boundary, including the documented Node 20 rule exceptions. Check that a fresh consumer of emitted public types needs no blessed typings.

**Acceptance:** compatibility boundary compiles without unsafe local type escapes; full-widget rendering passes; the console workaround either passes manual verification or the Windows old-runtime pipe mode explicitly falls back to plain output. Record an actual memory/latency result, not an estimate. The defaults remain bounded while owner questions are pending. These spikes are limited to unknown boundaries; do not repeat the already-passed registry/lint/library smoke research.

**Proof:** strict compiler + ESLint; headless widget/resize/key tests; one manual ARM64 checklist; recorded Node/version/backend/benchmark results. If a maintained backend is required as a hard owner condition, stop this choice for reconsideration rather than quietly claim neo-blessed is maintained.

**Results:** steps 1, 3 and 4 are recorded in [v2-phase-0-results.md](v2-phase-0-results.md). Step 2 is the coordinator's [manual terminal checklist](manual-terminal-checklist.md).

### Phase 1 — preserve both upstream histories, unchanged

1. Start from a clean implementer-authorized working tree and record current `jlv` HEAD and upstream SHAs. Import upstream `b8aa924...` at `packages/jlv` with `git subtree add --prefix=packages/jlv ... --message "chore(repo): import json-log-viewer history"`, **without squash**. Fetch the exact source commit, not a moving master at implementation time. Do not mix changes into this import.
2. Import `Defkil/jlv-pino` master at `7edcd81b3545cbe0614550e2a9d8335959b707cf` into temporary `packages/jlv-pino`, also without squash and in its own commit. Later commits retire its runtime, preserving the import in ancestry.
3. Add `docs/upstream-provenance.md`, README fork attribution, full MIT license text and notices in a separate licensing/provenance commit. Keep Oliver's existing copyright notice; add an upstream Felipe Coury/contributors notice without inventing a year. Credit Gistia as the upstream project, not an unsupported assertion of corporate copyright ownership. Copy MIT/license notices associated with any copied fork contribution.

**Acceptance:** both source tips are ancestors of the new `master`; imported subtree trees equal their source trees byte-for-byte before changes; no squashed/rebased upstream history or changed author fields; no new GitHub runtime dependency. Historical assets can be removed only in subsequent cleanup commits.

**Proof:** `git merge-base --is-ancestor` for each imported tip; tree diff between each source commit and its imported subtree; original author log inspection; package/provenance notice inspection. Do not apply the upstream patch until the import is committed and clean.

### Phase 2 — capture behavior and integrate PR #13 separately

1. Create the private workspace root and fixture workspace, the TS test compiler, and a `node:test` characterization harness. Move the active assertions from upstream `test/log.test.js` and `test/utils.test.js` into TS and retain original log/INI fixtures. The already-skipped `browser.test.js` refers to removed browser code; replace its useful expectations with headless widget assertions, do not revive karma.
2. Capture initial file load, details/tree+JSON toggle, paging/arrows/0/$/g, search/n, level/custom filters, sort display, empty logs, config transform, and malformed-row behavior using blessed 0.1.81. Document existing bugs (case sensitivity, invalidation, PageUp, repeated widgets, filter accumulator) as observed behavior; improvements come later.
3. Fetch PR #13 at `e29eb7e7...`, use `git format-patch` to a scratch file, then `git am --directory=packages/jlv` on the clean imported subtree. Amend **only the new integration commit message**, retaining its author/date, to a Conventional Commit such as `fix(tui): apply upstream render leak patch`; include the source SHA and PR URL in its body. The prefix-adjusted patch check succeeded in planning; plain cherry-pick of original root paths should not be the engineer's recipe.
4. Assert the simple repeated-render leak is fixed, preserving other snapshots. Record modal-child cleanup limitations for the persistent-widget phase.

**Acceptance:** the original assertions run under `node:test`, no browser runner is introduced, the baseline behaviors are explicit, and PR integration is visibly distinct from both import and TS port. It is not claimed to fix unbounded file storage.

**Proof:** baseline snapshot/semantic assertions; simple repeated-render child counts before/after PR #13; patch author/date verification. Temporarily use `@types/lodash` **4.17.26** (2026-10-09) and `@types/minimist` **1.2.5** (2023-11-07) if the faithful port needs them; both were registry-checked and are removed with those libraries later. Baseline dependencies are isolated from the release pipeline.

### Phase 3 — faithful strict TypeScript port

Port in this order, with a separate reviewable commit for each group:

1. `src/utils.js -> tui/formatting.ts`: type column keys/formatters/widths and preserve existing formatting behavior.
2. `src/log.js -> log.ts` initially: type the legacy row, reader/config dependencies and mapping results. Preserve JSONL/transform behavior, including visible baseline limitations. Convert `_transform` to typed state while retaining behavior until config modernization.
3. `BaseWidget.js -> base-widget.ts`, `Picker.js -> picker.ts`, and `StatusLine.js -> status-line.ts`: typed options/events/cancellation/dimensions; descriptive identifiers and kebab-case files.
4. `LogDetails.js -> log-details.ts`, then `MainPanel.js -> main-panel.ts`: explicit row selection/cache/sort/filter state and typed callbacks. Avoid combining the internal model redesign, fixes, or streaming with the conversion.
5. `src/index.js -> cli.ts`: ESM, typed argument options and lifecycle boundaries. Separate library imports from CLI startup. Remove `polyfills.js` with a documented Node 20 native-padEnd equivalence check; do not modify platform prototypes.
6. Finish emitted JS/declaration builds and the strict typed lint gates. During the sequence lint only the newly ported modules; remove all temporary legacy scope exclusions before accepting the final port.

**Acceptance:** all viewer application modules/tests are TS; strict compiler settings pass, no application `any`/ignore escapes or renamed-rule lint errors, behavior matches characterization on supported input. Legacy dependency modernization and new formats still have not been mixed into port commits. Compiler-required guards that alter an error case get a named test and explicit commit explanation.

**Proof:** unchanged baseline semantic/snapshot expectations under compiled tests; Node 20.19 and Node 24 execution; complete typecheck/lint/build; inspect public declarations for unsafe or terminal-library types; no hidden skip/todo replacing a behavior assertion. Do not import the CLI to test library functions.

### Phase 4 — modernize dependencies/backend and correct known viewer defects

1. In one dedicated dependency/backend commit, replace blessed with pinned neo-blessed through the typed boundary; replace minimist/commander with parseArgs; replace lodash with small typed native operations; update legacy INI parsing to 6.0.0 with guards. Remove unused blessed-contrib and the old runner/tooling/native/browser graph.
2. In a separate lifecycle/performance fix, allocate one main row content element and update its content. Destroy/detach owned modal widgets/listeners deliberately; do not remove all panel children. Recompute filtered/sorted indexes only when data/query revision changes. Make render navigation independent of sorting work.
3. Apply or reimplement credited farolanf cache invalidation, first-page PageUp, and detail-scroll fixes, each with its regression. Clamp empty/tiny viewport indices and widths. Keep unrelated optional fork features out.
4. Retire root wrapper `src/`/`test/`, upstream lockfiles, root `package-lock.json`, Travis, coveralls, Karma, gendoc/jsdoc/foodoc files, obsolete badges, and copied screenshot artifacts that are no longer useful. Move pino fixtures into the private fixture workspace and remove its legacy transformer runtime/package.
5. Replace the blanket `/docs/` ignore with narrow generated-output ignores. The planning file currently exists on disk under that old ignore; this task deliberately did not change it. Implementation must preserve/track authored docs, including this plan, rather than regenerate over them.

**Acceptance:** only the chosen release runtime dependencies remain; the port baseline passes on neo-blessed except deliberately fixed defects; no delayed require/spawn/global argv mutation remains. Widget/listener counts are bounded and sorting occurs once per relevant revision.

**Proof:** baseline parity on both backends for the backend-only change; 10,000 headless navigation/render and repeated modal-open/close cycles; cache/sort/PageUp/empty/tiny-size tests; runtime lockfile/advisory/native-dependency inventory. Tests are deterministic; timing measurements are benchmark evidence, not fragile tight CI thresholds.

### Phase 5 — streaming inputs, bounded store, stdin and follow

1. Add `input/files.ts`, `input/lines.ts`, `input/follow.ts`, `store.ts`, `application.ts`, and `output.ts`; use literal/glob paths, source IDs, bounded chunk framing, cancellation and backpressure. Connect through the legacy normalized row view first.
2. Add independent terminal input discovery and explicit `auto/tui/plain/jsonl` behavior. Ensure help/version/config errors run without creating a screen. Implement stream/TTY cleanup and errors without process exit calls embedded in widgets.
3. Retain last ingested records under count/estimated-byte caps, expose seen/retained/evicted status, and keep view selection by ID. Finite default sort is descending time after load; follow/live defaults to arrival. Preserve stable ties and include malformed/missing time handling during the normalization transition.
4. Implement polling follow through append, truncation, rotation, absent/recreated path, partial UTF-8, incomplete record, and shutdown. Increment record numbers after replacement rather than reusing IDs. Validate `--save` exclusive creation/input collision checks; stream all export entries independently of TUI eviction.

**Acceptance:** records appear before stdin EOF; files are not read wholly or interleaved by byte chunks; retained count/bytes are bounded, and export count remains complete. No console means plain mode, not a hung raw-mode process. All source resources stop on abort.

**Proof:** actual spawned CLI pipe tests with delayed input and EPIPE; every possible byte split for a multibyte/CRLF sample; final-line EOF; malicious oversized line; glob/literal/dash/spaced/Windows path tests; two-file timestamp order within the retained view; rotation/truncate/missing-path tests with controlled file operations; slow-sink/backpressure test; bounded-store counts/selection tests; manual Windows ARM64 terminal checklist from phase 0. Re-run the million-record benchmark: default limits should reach a steady state; target under 256 MiB RSS for that fixed fixture and a first visible update under 1 second on the recorded machine. Adjust budgets or fix growth if measurement fails, without claiming a universal RSS cap.

### Phase 6 — final model, built-in adapters, config and diagnostics

1. Introduce `api.ts`, `record.ts`, `field-path.ts`, `configuration.ts`, `plugins.ts`, and the final `LogFormat` contract. Adapt widgets from the legacy row via an explicitly tested compatibility view, then retire the old `log.ts` reader. Do not drop raw fields or source IDs during this change.
2. Implement JSONL normalization and pino first, replacing text substitution; then bunyan and Winston JSON profiles, logfmt, CSV, and Docker envelopes. Register per-source probes with replayable bounded sampling and deterministic precedence. Publish adapter/type exports only after the fixtures pass.
3. Implement validated JSON config and legacy read precedence, mapping warnings, epoch units, case-normalized levels, parser diagnostics/strict mode, explicit plugin loading, and the documented old-option errors. Add format/CLI/config/migration docs with runnable examples.

**Acceptance:** all shipped formats normalize to the same typed model; no installed producer SDK is required; config loads once without home writes; malformed data gives useful source/line information without flooding; plugin code only runs after an explicit CLI option. `npm install jlv` alone makes pino work.

**Proof:** entire shared corpus on all supported Node versions, including pino false substitutions/numeric level 100/fatal final row; CSV quoted multiline/size-limit/header cases; logfmt grammar cases; Docker plain/JSON envelope cases; seconds/ms/us/ns and UTC/invalid timestamp tests; per-source mixed format files; sampling replay/timeout/tie tests; config precedence/temp-home unchanged; plugin ESM/CJS/version/collision/output-shape failures; TS compile fixture for third-party plugin authors. No XML test is mislabeled as XML support.

### Phase 7 — filtering, correlation and terminal text safety

1. Implement `filters.ts` and TUI profile/add/remove/clear controls. Evaluate normalized root fields directly and raw extras below `fields` paths; use `util.isDeepStrictEqual` for typed JSON equality. Combine CLI clauses, profiles, level selection, and explicit predicates as documented rather than discarding prior clauses.
2. Add correlation column/palette/mapping/shortcut and stable selection handling. Saved profiles are part of config read support; writing a profile requires a deliberate destination chosen in the UI/CLI and never defaults to silently changing home config. Manual editing documented JSON profiles is sufficient for 2.0; do not add a hidden auto-save feature.
3. Replace unsafe formatting with the single terminal sanitizer; inspect messages, labels, paths, status filters, and detail keys/values. Add visible key help and scrolling/closing controls.

**Acceptance:** issue #19 AND semantics and profiles work; #14/#15/#18 tests pass; log text cannot inject blessed tags or terminal control effects; matching correlation colors have constant metadata memory.

**Proof:** multi-clause AND/OR/profile/clear/type-aware comparisons, unknown/mixed-case levels, exact ID and ID=0 filters, no growing correlation lookup cache; literal slash/backslash/tag/ANSI/OSC and depth/empty-object regressions at narrow/wide widths; snapshots plus logical cells/styles (not only ANSI byte snapshots); abort/quit with active prompt; unchanged original JSONL export values.

### Phase 8 — pack, CI, publish and migration cleanup

Implement the workflow and release procedure below. Finish README, examples, API/config docs, migration table, changelog, provenance, and contributor instructions reflecting English/Conventional Commits/default-branch work. Update the package version to 2.0.0 only after all phase acceptance criteria pass; keep the publish job disabled/unconfigured during the port.

**Acceptance:** quality and runtime gates pass; the clean tarball provides working bins, declarations and formats on Linux and Windows ARM64; the replacement is on npm before `jlv-pino` retirement; no other npm name or private workspace is published.

**Proof:** exact tarball install/consumer compile/CLI examples; trusted-publisher registration verified by coordinator; first OIDC publish with provenance; independent install from npm and pino fixture smoke; existing-version re-run skips publishing; simulated registry failure aborts; documented deprecation/archive/bot-PR/Pages cleanup performed by the coordinator after release.

## 9. CI and trusted-publishing release design

### 9.1 Jobs, permissions and artifacts

Use `.github/workflows/publish.yml`, triggered by push to `master` and `workflow_dispatch`, matching `tcp-proxy`'s flow. Top-level `permissions: {}`. Every job has `timeout-minutes` (quality/runtime 10, publish 10; increase only with measured need). No PR creation or release-token secret.

1. **quality**, Ubuntu, Node 24: `contents: read`; checkout with `persist-credentials: false`; setup pinned pnpm; `pnpm install --frozen-lockfile`; typecheck, lint, build, test compilation, package preparation, tarball creation and `check:package`. Produce one candidate tarball, its SHA-256, manifest version/name, emitted tests and required fixture data. Package checks fail before uploading. No `id-token` permission here.
2. **runtime**, Ubuntu matrix `[20.19.0, 20, 22.9.0, 22, 24, 26]`, `needs: quality`, `fail-fast: false`, `contents: read`: install dev dependencies **under Node 24 first**, then select the target Node and execute only emitted JS tests and packed CLI smoke checks. This avoids trying to load Unicorn or install the development toolchain on Node 20. Download the exact candidate artifact and verify its hash. A fresh temporary tarball install with production dependencies catches accidental reliance on root dev dependencies/hoisting; full emitted tests still run from the built checkout against its declared dependencies. No compile/type stripping happens under matrix runtimes.
3. **publish**, Ubuntu, Node 24, `needs: [quality, runtime]`: `contents: read` and `id-token: write` only. Concurrency group `jlv-npm-publish`, `cancel-in-progress: false`. Download/verify the already-tested tarball, inspect its manifest, and publish that file; never rebuild/repack or run recursive workspace publication here. Pin npm 11.19.1 or assert the available CLI is at least 11.5.1; the trust flow also requires Node >=22.14. No `registry-url` input to setup-node, no `NODE_AUTH_TOKEN`/`NPM_TOKEN`, and no stale token `.npmrc`.

SHA pins checked through the GitHub API on the research date (pin the commit, not an annotated tag object):

| Action | Version checked | Exact commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| pnpm/action-setup | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| actions/download-artifact | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |

The artifact/pnpm actions use a Node 24 action runtime; target Node 20 is only for the test commands. Revalidate pins and action release notes at implementation start. Upload only named build artifacts; emitted files under `.test-dist` require deliberate hidden-file inclusion, not uploading the whole repository or `node_modules`. Preserve the test tree's package type, fixture paths, and Linux bin permissions after download/reinstall. Windows ARM64 gets the headless/unit/CLI suite locally plus the manual terminal gate; GitHub-hosted Linux CI alone cannot prove Windows Terminal behavior.

Sources: [checkout checked release](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node checked release](https://github.com/actions/setup-node/releases/tag/v7.1.0), [pnpm setup](https://github.com/pnpm/action-setup/releases/tag/v6.1.0), [artifact upload](https://github.com/actions/upload-artifact/releases/tag/v7.0.2), [artifact download](https://github.com/actions/download-artifact/releases/tag/v8.0.2), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

### 9.2 Packed-tarball gate

`scripts/check-package.ts` checks the **real tarball**, not merely `files` in the source manifest:

- Name/version/engine/bin/exports/repository/license match the release package; root and fixture packages are private. No `workspace:`/`file:`/GitHub branch dependencies or unresolved private package reference remains.
- Tarball contains executable `dist/cli.js` with shebang, compiled JS and `.d.ts`, README, full MIT license and provenance notices. It excludes tests, raw TS executable source, fixtures, old lockfiles, secrets, temp inputs, native add-ons, generated v1 docs, and the obsolete wrapper/transformer.
- In an empty temporary project install only the tarball + its production dependencies, with package lifecycle scripts disabled. Run `jlv --help`, `--version`, representative plain and JSONL file/pipe commands, glob/save checks, and pino auto detection. No global `jv` or GitHub installation may be needed. Also verify no home configuration mutation.
- Compile a separate ESM consumer and a custom format/predicate plugin against shipped declarations with the selected TS compiler, strict settings and `skipLibCheck: false`; run the plugin JS against the installed package. Importing `jlv` must not open a screen or alter process state. Check an explicitly compiled CommonJS plugin via dynamic import too.
- Review the production dependency/advisory tree. The planning scratch audit reported zero advisories in its installed smoke-test graph on this date; repeat against the **actual release graph** rather than treating that result as a guarantee. High/critical reachable advisories require a fix or an explicit documented risk decision before release.

### 9.3 Version check and coordinator sequence

The package version lives in `packages/jlv/package.json`; the private root's version is irrelevant. The implementer makes a release commit such as `chore(release): jlv 2.0.0` and pushes `master`. There is no tag-trigger requirement, automatic version bump, or manual-publish fallback baked into CI.

Before publishing, read name/version from the verified artifact manifest and call `npm view jlv versions --json`. As in the reference workflow, test membership in the version list; do not interpret any failed `npm view jlv@2.0.0` request as proof the version is missing. A network/auth/registry/JSON error must fail the job, not trigger publication. If already published, exit successfully with an explicit skip. If absent, `npm publish <verified-tarball>` with npm's detected GitHub OIDC identity/provenance. Do not repack from whatever happens to be the latest master. Serializing publish jobs limits races; a duplicate-version publish error still fails visibly and can be rerun after verifying npm state.

Coordinator with Oliver, after implementation is reviewable:

1. Configure npm trusted publishing for **jlv / Defkil/jlv / publish.yml** (and the exact environment name only if one is used). Do npm operations requiring 2FA with Oliver; no repo token secret is introduced. Verify package repository metadata matches the public GitHub repository so provenance can be generated.
2. Let the version bump + push run all checks and publish. From outside the workspace, install `jlv@2.0.0` from npm and verify a pino pipe/file fixture and the CLI bin. Confirm the npm version/provenance record, not only workflow success.
3. Update the `jlv-pino` README with the built-in replacement and a pinned v1 compatibility note. Deprecate all existing npm `jlv-pino` versions with a message such as `Pino support is built into jlv >=2. Use jlv --format pino; jlv-pino is no longer maintained.` Then archive `Defkil/jlv-pino`. Do not unpublish it or ship a fake 2.0 shim for the incompatible old stream API.
4. Close the 14 verified stale Dependabot PRs in `Defkil/jlv` as superseded by the monorepo/dependency migration, with links to the replacement commit/docs. Do not merge their obsolete locks or imply this closes upstream Gistia tickets. Configure future dependency updates for pnpm/workspaces/SHA-pinned actions under the owner's no-PR workflow policy, or simply use periodic direct update commits; do not reintroduce a PR bot by default.
5. Disable the old GitHub Pages publishing setting/workflow after replacement docs are linked from README/npm. Remove Travis/coveralls/david-dm/old Pages badges and obsolete configuration. Keep authored docs in Git; do not delete Git history or published npm versions. Recording a GitHub release/tag is optional bookkeeping after publish, not the trigger.

Migration docs must explicitly cover the executable (`jlv`, no conflicting `jv`), Node/ESM/API changes, built-in pino, old/new config precedence, read-only home handling, removed flags/transformer API, short-option collision (`-s` remains save; use `--sort`), default live/finite ordering, timestamp units, history eviction, raw-field/export shape, and unsupported XML/JSON arrays. Include working examples for global/local installs, quoted Windows globs, file + pipe, follow, CSV, a JSON profile, and a compiled custom plugin.

## 10. Risks, remaining unknowns, and stop conditions

| Risk / unknown | Evidence and impact | Mitigation / first spike |
| --- | --- | --- |
| Terminal dependency is stale | None of the checked blessed replacements is both actively maintained and production-ready with Node 20 compatibility. Neo-blessed is a deliberate compatibility choice. | Phase 0 full-widget/typing/Windows checks; isolate its import; keep a documented route to a pnpm dependency patch or later backend fork. A required renderer patch is reviewed/attributed separately, never a moving Git dependency. |
| Old Windows console path handling | Standard CONIN path failed on tested 20.19/22.18; ConDrv workaround passed, but that path is less stable than the documented console API. | Validate 22.9 and real ARM64 keyboard/resize before release; robust plain fallback. Do not add native node-pty or promise interactive pipe support on an unverified runtime. |
| Complete-history browsing vs bounded retention | Last-ingested retention can evict earlier-file records; sorting a window is not sorting all logs. JS object memory exceeds raw UTF-8 byte estimates. | Owner question 1; million-record benchmark; conspicuous counters; complete streaming export. If complete GB-scale search is mandatory, add a disk spool/index design phase before release, with lossless counts/order tests. |
| Semantics hidden by the faithful port | Legacy tests largely cover utilities/parser; widget tests were skipped. Strict typing and new level/time normalization can accidentally alter behavior. | Characterize real keys/screens before port; keep port, backend change, normalization and feature commits distinct; name every intentional bug fix. |
| Runtime/tool versions diverge | Current Unicorn/neostandard need Node 22+; TS 7 is outside the checked parser peer range; Node 20 cannot strip TS dependencies. | Node 24 quality/install job, TS 6.0.3, compiled matrix tests, Node 20 types, explicit Unicorn newer-API exceptions, tarball consumer gate. |
| License notice provenance | Upstream declares MIT but lacks its own LICENSE; a third-party fork's later copyright year is not proof of upstream's notice. | Preserve metadata/source provenance; add full MIT text with yearless Felipe Coury/contributors attribution and existing Oliver notice; inspect copied patch licenses before importing. Escalate only a concrete contradictory notice, not speculative permission requirements. |
| Detection and timestamp ambiguity | Producer schemas/custom levels are configurable; time numbers can use different units; naive legacy timestamps have no zone. | Strong per-source probes, explicit overrides, preserved raw fields, explicit units, visible aggregated warnings; no universal numeric-level/epoch guessing. |
| XML and OTLP expand scope | XML fragments/layouts/encodings differ; OTLP is nested batch JSON rather than one generic log row. | Owner question 2; defer claims/dependencies. Spike only a named layout with real sanitized fixtures and streaming bounds. |
| Private compatibility consumers are unknown | Low npm dependents/download counts do not rule out private scripts, CommonJS calls or installed custom transformers. | Owner question 3; publish a precise migration table; add a narrowly justified compatibility adapter only for an actual user, not speculative preservation of every wrapper hack. |
| Release/deprecation are externally irreversible | Version publication is immutable; deprecation/archive and old-PR/Pages changes affect existing users. | Coordinator verifies the final tested artifact and npm replacement before retirement; 2FA/trust/access operations stay with coordinator + Oliver. Nothing external was changed during planning. |
| Branch work lacks PR review | House rules land on master or an implementer-merged branch; direct history-import/code-quality changes are large. | Reviewable commits and local/CI gates, short-lived isolation if needed; no sweeping import+port+feature commit. |

First unresolved spike order: **full typed widget boundary → old-runtime Windows pipe console → bounded-store benchmark**. XML follows only if the owner makes it a release requirement. A failed manual console check permits documented plain fallback; a failed bounded-store/no-data-loss export check or public-type gate blocks 2.0 until corrected.

## 11. Questions only Oliver can answer

The defaults above stand unless Oliver changes these product constraints; library, build, lint, engine, workspace, and release-tool choices do not need another preferences round.

1. **Must users search/sort the entire file when it exceeds the retained window, and what are the largest real files/record counts?** Default: retain 50,000 records / 64 MiB estimated data, show evictions, and keep exports complete. Mandatory complete multi-GB history would require disk storage/indexing before 2.0, rather than a hidden memory increase.
2. **Is any XML layout a must-have for 2.0, and which producer/layout/encoding is actually used?** Default: defer XML. A real Log4j/log4net sample (including multiline exception/event structure and live-tail expectations) is needed to choose a bounded reader; generic “XML support” is not a useful acceptance target.
3. **Which private scripts depend on the old CommonJS wrapper exports, `--transformer` API, `jv` command name, or upstream `-s` sort shortcut?** Default: ESM/type API, explicit new plugins, `jlv` bin only, `-s` save and `--sort` spelled out. Only a concrete compatibility consumer justifies expanding that migration surface.

No implementation, commits, pushes, npm package changes, repository setting changes, or messages to maintainers were performed for this plan. The only file written inside the source repository is `docs/v2-plan.md`; the existing `/docs/` ignore was left untouched.
