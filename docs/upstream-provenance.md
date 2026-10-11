# Upstream provenance

jlv 2 is a fork of [json-log-viewer](https://github.com/gistia/json-log-viewer), the
terminal JSON log viewer by Felipe Coury and contributors, published by Gistia. This
file records where imported and adopted code comes from: the source repository, the
original commit and author, the affected behavior and the local commit. Add a row
whenever a patch from upstream or a fork is adopted.

## Imported histories

Both imports are non-squashed `git subtree add` merges. The original commit objects,
with their SHAs, authors and dates, are ancestors of this repository's history, and each
imported tree was byte-identical to its source tree at import time.

| Source | Pinned commit | Local path | Local import commit | Authors | License |
| --- | --- | --- | --- | --- | --- |
| [gistia/json-log-viewer](https://github.com/gistia/json-log-viewer/tree/b8aa924544ffe484de51460c06cbc4a115ec3928) | `b8aa924544ffe484de51460c06cbc4a115ec3928` (2018-09-23, "package updates (#11)"), tree `17b3ecd4b5f99f31bff6f7ed97c4396850f93c3b` | `packages/jlv` | `2199057` chore(repo): import json-log-viewer history | Felipe Coury (55 commits); Peter W (2 commits, merged by Vinícius Oliveira) | MIT, declared by the manifest's `license` field and the README. The repository has no LICENSE file and states no copyright line or year. |
| [Defkil/jlv-pino](https://github.com/Defkil/jlv-pino/tree/7edcd81b3545cbe0614550e2a9d8335959b707cf) | `7edcd81b3545cbe0614550e2a9d8335959b707cf` (2020-08-12), tree `dcb801aa32253485127be03538b667fd17d69c31` | `packages/jlv-pino` until phase 4. Its mapping file and level cases moved to `packages/format-fixtures/fixtures/pino` in `7d5d404` test(fixtures): move the jlv-pino fixtures into the fixture workspace; the package was retired in `63eb937` chore(repo): retire the jlv-pino transformer. | `3cde839` chore(repo): import jlv-pino history | Oliver Grüttner (8 commits) | MIT, LICENSE "Copyright (c) 2020 Oliver Grüttner" |

The v1 wrapper history of this repository (`Defkil/jlv`, last v1 commit
`f9d702d8b48c45dd3d251df12fbc5daf796fc764`) continues unchanged; its code was retired in
`d0d1deb` chore(repo): retire the jlv 1 wrapper and its tooling.

## Adopted patches

| Source item | Original commit and author | Affected behavior | Local commit |
| --- | --- | --- | --- |
| [gistia/json-log-viewer PR #13](https://github.com/gistia/json-log-viewer/pull/13), "Fix memory leak / performance degradation" | `e29eb7e7e5542e29e321f7b256b93194d808ac22`, Dima Sabanin, 2018-12-04; applied unchanged with `git am --directory=packages/jlv`, original author and author date kept | `MainPanel.update()` removes the panel's children before it appends the new row element, so renders no longer accumulate row elements. Side effects, recorded by the characterization: the border label with file name and position disappears, each render removes only every second child, and a second resize detaches an open prompt that keeps reading keys. The persistent row element of `385427b` supersedes this cleanup. | `bffe9f4` fix(tui): apply upstream render leak patch |
| [farolanf/json-log-viewer](https://github.com/farolanf/json-log-viewer) "fix not refreshing on sort" | `ae42be28857077f1c0dcb0f298c0ef8d6c6d951f`, Farolan Faisal, 2021-03-28; relocated to the TypeScript port with the original author and author date | `setSort()` marks the cached order stale before it renders, so the rows show the new sort at once instead of after the next render. | `b07ccc6` fix(tui): invalidate the row order when the sort changes |
| [farolanf/json-log-viewer](https://github.com/farolanf/json-log-viewer) "fix page up" | `80eade9fef2b910ae82280de341bfa5473ccd935`, Farolan Faisal, 2021-03-28; relocated likewise | PageUp no longer does nothing while the cursor is less than a page from the first record. | `62181ba` fix(tui): let PageUp reach the first record from a partial page |
| [farolanf/json-log-viewer](https://github.com/farolanf/json-log-viewer) "add log details page scroll", with the PageUp step of "fix scroll offset" | `7758d957fbc02c7a252536b94d0fe6b0576222af` and `9d478af70b88ba6745f9dc1f739bff909f9fbe4d`, Farolan Faisal, 2021-03-28; relocated with the author and author date of 7758d95. The fork's later q, left, right and Ctrl keys stay out. | Home, End, PageUp and PageDown scroll the details dialog; Shift pages five times. | `f53fc17` feat(tui): scroll the details by page and to both ends |
| [danielannan17/json-log-viewer](https://github.com/danielannan17/json-log-viewer) "Fixed performance + memory leak" | `8a1aef16c77ab91b731fdb32b03a73d25ffa3f0a`, Daniel (danielannan17), 2023-04-23; the idea is reimplemented, no code is copied | The main panel keeps one row element and replaces its content on every render. | `385427b` fix(tui): keep one row element and compute the order once per revision |
| [MokkeMeguru/json-log-viewer](https://github.com/MokkeMeguru/json-log-viewer) "Update index.js" | `a999d1b5fa3da68e719de5ca71407ebce6c9f46b`, Mokke Meguru, 2021-12-23; the idea is reimplemented, no code is copied | The screen runs with blessed's `fullUnicode`, so wide characters take two cells and combining marks combine; jlv adds the measure and the replacement of emoji that keep the rows aligned. | `2e15474` feat(viewer): draw wide characters and combining marks |

## Upstream issues and pull requests

Local dispositions of plan §7; they do not close the upstream tickets.

| Upstream item | Disposition | Local commit and proof |
| --- | --- | --- |
| [#6 security issues](https://github.com/gistia/json-log-viewer/issues/6) | The obsolete runtime graph is replaced: neo-blessed and ini 6 are the only runtime dependencies. `pnpm audit --prod` went from 23 advisories (3 critical, 7 high, 12 moderate, 1 low) to none, including the prototype pollution of minimist 1.2.0, ini 1.3.5 and lodash's `omit`. Phase 7 reads level, profile and envelope names from own keys only, and no log text reaches the terminal as markup or as an escape sequence. | `eb8fe8b` build(jlv): move to neo-blessed, ini 6 and Node built-ins; tests for prototype options, `[__proto__]` sections and prototype paths. `4efcd42` fix(record): read level names from own keys only; `9b6c4f0` and `a33a80e` (see #18); record.test.ts, configuration.test.ts, docker.test.ts, output.test.ts, terminal-text.test.ts |
| [#12 read from pipe](https://github.com/gistia/json-log-viewer/issues/12) | Implemented in phase 5: standard input is a live source, the viewer reads its keys from the terminal (`/dev/tty`, `\\.\CONIN$` or its ConDrv fallback), and without a terminal the records go to plain output. The stdin fork of israel-tsadok-silk (`493918a`) was a precedent only; no code is copied. | `8c70033` feat(terminal), `deefc12` feat(cli); cli.test.ts and application.test.ts (records before EOF, EOF, Ctrl-C, EPIPE, no console) and Part B of the manual terminal checklist |
| [PR #13](https://github.com/gistia/json-log-viewer/pull/13) | Integrated with its author in phase 2, then superseded by the persistent row element and deliberately destroyed dialogs. | `bffe9f4`, `385427b`; viewer-lifecycle.test.ts with 10,000 cycles |
| [#14 case-insensitive level filter](https://github.com/gistia/json-log-viewer/issues/14) | Levels are normalized in phase 6, whatever their case or alias, with trace, fatal and unknown; the level filter, `-l` and `equals` clauses on `["level"]` compare the normalized level, and the raw value stays in the fields. | `1098528` feat(api): define the record model and its normalization; `a82dabd` feat(filters), `d18f105` feat(viewer); record.test.ts, filters.test.ts, viewer-filters.test.ts |
| [#15 correlation ID](https://github.com/gistia/json-log-viewer/issues/15) | Correlation identifiers are normalized in phase 6 (0 stays an identifier); the viewer shows them in a column in colors that their text picks from a fixed palette, and `c` shows only the records of the selected identifier, with the selection kept across sorts, filters, new records and eviction. | `24569be` feat(viewer): show correlation identifiers and filter by them with c; `5aa6a1b` feat(viewer): keep the selected record across sorts and filters; viewer-correlation.test.ts, viewer-live.test.ts, filters.test.ts |
| [#18 colors and slash](https://github.com/gistia/json-log-viewer/issues/18) | Log text never acts as blessed markup or as escape sequences: one sanitizer removes escape sequences and shows control characters as JSON escapes, the `markup` tag escapes every value, and the row layout measures and cuts visible text. Slashes, backslashes and tags stay literal text. | `9b6c4f0` fix(output): write records and diagnostics as visible text; `a33a80e` fix(viewer): show log text literally in rows, labels and dialogs; terminal-text.test.ts, formatting.test.ts, viewer-text-safety.test.ts, status-line.test.ts |
| [#19 filter improvements](https://github.com/gistia/json-log-viewer/issues/19) | Filters add up: typed `equals` and `contains` clauses, `all` and `any` profiles from the configuration, the level and the predicates of explicitly loaded plugins apply together, from the command line (`--where`, `--profile`, `--predicate`) and the viewer's filter manager. No closure or expression in a configuration runs. | `a82dabd` feat(filters): evaluate typed clauses, profiles and predicates; `d18f105` feat(viewer): manage filters that add up instead of replacing each other; `54cd0d0` feat(cli): filter with --where, --profile and --predicate; filters.test.ts, viewer-filters.test.ts, application.test.ts |
| [PR #20](https://github.com/gistia/json-log-viewer/pull/20) by Philipp (wmnnd) | Superseded rather than merged: the dependency replacement makes the package installable without its lockfiles. Its installability report is acknowledged here. | `eb8fe8b` |

## Candidates

Plan §3.5 lists further fork commits. They are not part of the code until a row above
names a local commit; among them are farolanf's sorting by other fields (`f03300b`),
danielannan17's periodic reload, the stdin, async loading, watching, array and
process-column changes of other forks.

## License notices

- `LICENSE` and `packages/jlv/LICENSE` carry the full MIT text with two copyright lines:
  the existing "Copyright (c) 2020 Oliver Grüttner" and "Copyright (c) Felipe Coury and
  json-log-viewer contributors". The upstream line has no year because upstream states
  none.
- Gistia is credited as the upstream project, not as a copyright holder.
- `packages/jlv/NOTICE.md` repeats the attribution inside the published package.
- The farolanf, danielannan17 and MokkeMeguru forks have no LICENSE file; their manifests
  keep upstream's MIT declaration (checked at their heads `45bc52fea9344303e6481852e9b41e992956a773`,
  `d864f839b4df0394bc186caa92ebbd7af4304d28` and `27bf050c1c815921420c91cf875008cd5f4ed67c`).
  They carry no notice of their own to copy.
  Before adopting a further fork patch, check its license notice and copy any notice into
  this file and into `packages/jlv/NOTICE.md`.
