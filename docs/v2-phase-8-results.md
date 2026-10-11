# jlv 2 phase 8 results

Measured on 2026-10-12 for plan §8 phase 8: the package, the packed-tarball gate, CI with npm trusted publishing, the
documentation, wide characters and the release preparation of jlv 2.0.0. What the coordinator and the reviewer need
is summarized in plan §0.16. Scratch scripts, packed tarballs, scratch projects and the downloaded runtimes lived in a
temporary directory outside the repository and were deleted afterwards. Nothing was published, and no npm or GitHub
setting changed.

## Environment

- Windows 11 Home on ARM64, 12 logical processors, 16 GiB RAM, shared with other work that at times kept every core
  busy.
- Node 26.10.0 installed locally; Node 22.9.0, 22.23.3 and 24.21.0 from the official `win-arm64` zips, each checked
  against its `SHASUMS256.txt`.
- pnpm 12.9.1, typescript 6.0.3, eslint 10.12.0; npm 11.19.1 locally and the npm bundled with each zip.
- CI: `ubuntu-24.04`, Node 24.21.0 with npm 12.2.0 for the quality job; Node 22.9.0 (npm 10.8.3), 22.23.3 (10.9.9),
  24.21.0 and 26.11.1 (11.20.0) for the runtime jobs.

## What phase 8 built

| Path | Role |
| --- | --- |
| `packages/jlv/package.json` | `jlv` 2.0.0: the bin `jlv`, `type: module`, `engines.node >=22.9.0`, the exports `.` and `./formats`, the `files` list, `repository.directory`, `publishConfig` with public access and provenance |
| `scripts/check-package.ts` | The packed-tarball gate of plan §9.2 (`pnpm run check:package`) |
| `scripts/publish-package.ts` | The publish decision and publication of plan §9.3, with tests against a stub npm |
| `.github/workflows/publish.yml` | Quality, runtime matrix and publish jobs of plan §9.1 |
| `src/tui/blessed-boundary.ts` | `fullUnicode` and `drawableText`, the characters on whose cells blessed and terminals agree |
| `packages/jlv/README.md` | The package README, rewritten; its examples and key table are tests |
| `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/release.md` | Project documents |

The command is `jlv` everywhere: in its usage, its help, the prefix of its messages, the documentation examples and
the tests.

## The package

`npm pack` of `packages/jlv` at the end of phase 8:

| Property | Value |
| --- | --- |
| Files | 124: `package.json`, `README.md`, `LICENSE`, `NOTICE.md` and `.js`, `.js.map` (sources inline) and `.d.ts` of the 40 modules of `src` |
| Size | 234,036 bytes packed, 884,663 bytes unpacked |
| SHA-256 | `644b63a36f80df515a629807940c4bab4f5d46737942369cd280146bec7483d3`. npm 11.19.1 on Windows and npm 12.2.0 on Linux pack the same bytes: the tarball of the release commit `a3405ff`, before the last README changes, had `8b506b1abe7339fad3a95d52937a78cf8356a0d6cb3511a7418c9c18e00f6faa` in both |
| Production install | 7 packages: jlv 2.0.0, csv-parse 7.0.3, ini 6.0.0, neo-blessed 0.2.0, tinyglobby 0.2.17, fdir 6.5.0, picomatch 4.0.7; no install script, no native code; `npm audit --omit=dev --audit-level=high` clean |
| Public declarations | `api.d.ts` and `formats/index.d.ts` reach 11 more declaration files of the package and nothing else; none names blessed |

neo-blessed's manifest has `"bin": "./bin/tput.js"`, a string, so its command is named after the package: a project
install links `node_modules/.bin/neo-blessed` (with `.cmd` and `.ps1` on Windows), which prints terminfo capabilities
when someone runs it and does nothing on install. A global install puts only `jlv` on the `PATH`; neo-blessed's command
stays in `jlv/node_modules/.bin`. Phase 4 called the link `tput`; its name is `neo-blessed`. The package check expects
exactly `jlv` and `neo-blessed` in `node_modules/.bin`, and the README says so.

## Package check

`scripts/check-package.ts` checks the tarball itself (exact file list, release manifest, shebang, declarations, source
maps without build paths, the readme's install line and credit), then installs it into an empty project with
production dependencies only and lifecycle scripts disabled (no install scripts or native code, the `.bin` entries,
npm audit), runs the command (version, help, pino, bunyan, CSV, standard input, `-`, a glob, JSON lines, `--save` and
its refusal, exit codes 0, 1 and 2, the `.cmd` shim on Windows, the executable mode on POSIX, an untouched home
directory), compiles a strict consumer of `jlv` and `jlv/formats`, the plugin-author fixture, the README's plugin and a
CommonJS plugin with `skipLibCheck: false`, and runs them: the consumer's imports load no terminal library, add no
signal handler and set no exit code, and jlv runs all three plugins.

| Node | npm | Result for `jlv-2.0.0.tgz` |
| --- | --- | --- |
| 22.9.0 | 10.8.3 | all checks passed |
| 22.23.3 | 10.9.9 | all checks passed |
| 24.21.0 | 11.19.0 | all checks passed |
| 26.10.0 | 11.19.1 | all checks passed |
| CI on Linux, run 38181449879 for the tarball of `a3405ff`: 24.21.0 (quality), 22.9.0, 22.23.3, 24.21.0, 26.11.1 | 12.2.0, 10.8.3, 10.9.9, 11.19.0, 11.20.0 | all checks passed |

A tarball with one more file in `dist` fails the check (`unexpected: dist/extra.txt`).

## CI and the release decision

`publish.yml` runs on pushes to `master` and on manual runs; until the merge it also runs on pushes to this branch
(see the deviations). Top-level permissions are empty; every job has `contents: read`, a timeout of 10 minutes and
`ubuntu-24.04`; checkouts keep no credentials; actions are pinned by commit:

| Action | Version | Commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| pnpm/action-setup | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| actions/download-artifact | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |

All five were the latest releases on 2026-10-11, resolved with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha`.

1. **Quality** installs npm 12.2.0 and the lockfile, runs typecheck, lint, build and the test build, packs and checks
   the package, runs the publish decision as a dry run and uploads the tarball; its SHA-256 and file name are job
   outputs.
2. **Runtime** (22.9.0, 22, 24, 26, `fail-fast: false`) installs and compiles the tests with Node 24, downloads the
   tarball and verifies its SHA-256, then switches to the runtime under test and runs the tests and the package
   check of that tarball.
3. **Publish** runs only on `refs/heads/master`, after both, with `id-token: write`, no `registry-url`, no token, the
   concurrency group `jlv-npm-publish` without cancellation and npm 12.2.0. `scripts/publish-package.ts` verifies the
   SHA-256, the manifest, the dated changelog section and npm 11.5.1 or later, reads `npm view jlv versions --json`
   (npm answers one version as text and several as a list; an error or a malformed answer stops the job), skips a
   published version and otherwise runs `npm publish <tarball> --access public --provenance --tag latest` and waits
   for the registry to list it. It also refuses a real publication outside GitHub Actions on `refs/heads/master`.

Runs on the branch:

| Run | Commit | Result |
| --- | --- | --- |
| [38179248080](https://github.com/Defkil/jlv/actions/runs/38179248080) | `19b6bb0` | quality failed: npm 12 reports `npm pack --json` as an object, fixed in `3a0134c` |
| [38179631342](https://github.com/Defkil/jlv/actions/runs/38179631342) | `3a0134c` | quality passed the package check and stopped at the release decision: no changelog section for 0.1.2 yet, as expected |
| [38181266439](https://github.com/Defkil/jlv/actions/runs/38181266439) | `b7acdd3` | the same, before the release commit |
| [38181449879](https://github.com/Defkil/jlv/actions/runs/38181449879) | `a3405ff`, `chore(release): jlv 2.0.0` | success: quality with the notice `jlv@2.0.0 is not on npm yet; the publish job on master publishes jlv-2.0.0.tgz (SHA-256 8b506b1a…) with npm 12.2.0`, all four runtime jobs, publish skipped |

The publish decision was also run against the registry locally as a dry run: `jlv@2.0.0 is not on npm yet`. The
registry lists `jlv` 1.0.0 and 1.0.1.

## Wide characters

Plan §0.15 left the screen without `fullUnicode`: CJK showed as `??`, emoji as `?`, and combining marks disappeared, so
a decomposed `ü` showed as `u`. blessed's layout and drawing measure text with tables from before Unicode 9 and
disagree with terminals and with each other on some characters:

- Emoji with emoji presentation (`🚀`, also `✅` and `❌` in the Basic Multilingual Plane) are wide since Unicode 9,
  and terminals that follow it draw them in two cells; blessed gives them one. Without `fullUnicode`, blessed already
  passed `✅` and `❌` through in one cell.
- blessed lays out `U+A960` in one cell but draws it as wide and leaves out the next character; `U+3099` and a few
  unassigned code points in CJK blocks are the other way round, and their second cell reaches the terminal as a
  control character.
- Combining marks newer than blessed's table, such as `U+1AB0`, take a cell in blessed and none in terminals.

`fullUnicode` is on now, and `drawableText` prepares all text that the viewer draws, including the details' JSON view:
NFC first, then wide characters only where both of blessed's tables agree, combining marks only where blessed knows
them, `?` for emoji presentation characters (also flags and skin tones), astral characters that blessed does not draw
as wide, and the characters that blessed's tables disagree on, and nothing for variation selectors 15 and 16 and for
marks and format characters that blessed does not know. Such text takes the same cells with `fullUnicode` and without,
which blessed turns off by itself for a terminal without Unicode, so the existing measure stays.

`wide-characters.test.ts` takes 16 samples (CJK, Hangul, fullwidth forms, CJK beyond the Basic Multilingual Plane,
composed and decomposed umlauts, combining marks without a composed form, emoji, emoji of the Basic Multilingual
Plane, a text symbol with the emoji selector, a skin tone, a flag, a joined family, the disagreeing characters, a
mathematical letter and an unknown mark) through the measure, through blessed with and without `fullUnicode`, where
the marker after each sample lands in the measured cell, and through the terminal output, which holds each sample's
text without placeholders or lost characters. A viewer test checks the rows, the label and the details on a
60-column screen. Part B step 14 of the manual checklist checks a real terminal.

The cost, on this machine while it was fully loaded: preparing and measuring a 4,500-character CJK message takes
about 2 ms, against 0.5 ms for ASCII of the same length, and the viewer prepares only the rows it shows. blessed's
drawing with `fullUnicode` checks the width of every cell: a frame of a 120x40 element whose 38 rows all change took
0.79 ms with `fullUnicode` and 0.56 to 0.61 ms without, over 3,000 frames each; the viewer draws at most ten frames a
second while records arrive.

## Lifecycle

The proof with `JLV_LIFECYCLE_CYCLES=10000` passed on Node 26.10.0 with the tree of `32ba486`, which draws with
`fullUnicode`: the census of nodes, keyable and clickable elements, focus history and listeners stayed bounded over
10,000 cycles of navigation, renders, resizes and dialogs (666.8 s), and the order was computed once per data or
query revision, never for a cursor move (28.4 s). Phase 7 recorded 304.1 s and 15.6 s on a quieter machine; this run
shared it with work that kept every core busy. Run side by side under the same load, 300 cycles took 11.4 s with the
phase 7 head `e69871f` and 15.5 s with this tree, the third that `fullUnicode` adds to every frame (see Wide
characters), and the order test 0.66 s and 0.83 s.

## Test matrix

The suite of the last code commit, emitted once with Node 26.10.0 and run with each runtime:

| Node | Tests | Passed | Failed | Skipped | Wall time |
| --- | --- | --- | --- | --- | --- |
| 22.9.0 | 507 | 505 | 0 | 2 | 27 s |
| 22.23.3 | 507 | 505 | 0 | 2 | 29 s |
| 24.21.0 | 507 | 505 | 0 | 2 | 26 s |
| 26.10.0 | 507 | 505 | 0 | 2 | 25 s |
| CI on Linux: 22.9.0, 22.23.3, 24.21.0, 26.11.1 | 507 | 505 | 0 | 2 | |

On Windows the two POSIX-only tests of phase 5 are skipped, on Linux the two Windows-only ones (absolute Windows
patterns and a missing console). Phase 7 had 470 tests; phase 8 added the release script's 9, the 18 of wide
characters, the README's 8 examples and its key table, and the migration guide's new example. `pnpm run typecheck`,
`pnpm run lint` and `pnpm test` passed for every phase 8 commit on Node 26.10.0.

## Deviations from the plan

- **No `scripts/prepare-package.ts`.** The README, the license and the notices are authored in `packages/jlv`, so
  nothing has to be copied before packing.
- **The runtime jobs compile the tests themselves** with Node 24 from the same commit instead of downloading
  `.test-dist`: `tsc` emits the same files, and no hidden directory or linked `node_modules` passes through an
  artifact. Only the tarball is an artifact, verified by its SHA-256 in every later job.
- **npm 12.2.0** packs and publishes, as in mail-debugger; the plan named 11.19.1 or at least 11.5.1, which the script
  asserts. The tarball is byte-identical to npm 11's.
- **The publish job runs `scripts/publish-package.ts` through Node 24's type stripping**, so it needs no dependency
  install; the tests run the compiled script on all four runtimes.
- **The release decision requires a dated changelog section**, and the quality job runs it as a dry run on every
  run, so a release without notes fails before it reaches `master`.
- **`publishConfig.provenance: true`**, so that a publication outside a CI run that can attest it fails.
- **`fullUnicode` is on** instead of documenting the limitation, with the character policy above.
- **A temporary push trigger for this branch.** GitHub answers `workflow_dispatch` with 404 for a workflow that the
  default branch does not have, so the branch could not run it manually. `19b6bb0` added the branch to the push
  trigger; the last phase 8 commit removes it again, and since the workflow is registered now, `gh workflow run
  publish.yml --ref feat/claude-d8f0/jlv-v2` runs the final head.

## Gotchas

- npm 12 prints `npm pack --json` as an object keyed by package name; npm 11 printed a list.
- Node 22.9.0 writes a junction's target with a trailing backslash. Such a junction to pnpm's symbolic link of
  `@types/node` fails `stat`, `readdir` and `realpath` on every Node version, although files inside it open, so
  TypeScript found no Node types on 22.9.0; 22.23.3 and later write the target without the backslash. The package
  check links the real directory now.
- blessed moves the cursor over blank cells instead of writing spaces, so a test that looks for text in its output
  turns the moves into spaces first.
- `npm view jlv@<version>` fails for a missing version; the version list is the reliable lookup.
