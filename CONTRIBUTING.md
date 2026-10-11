# Contributing to jlv

Thanks for your interest. Bug reports, focused fixes and well-argued ideas are welcome. Please read the
[code of conduct](CODE_OF_CONDUCT.md) first, and report security problems privately as [SECURITY.md](SECURITY.md)
describes, not in issues.

## Reporting issues

Use the issue forms. A good report names the version (`jlv --version`), the Node.js version, the operating system and
the terminal, the command line, and the smallest log that shows the problem. Logs often hold personal data, tokens or
internal host names: shorten them to the records that matter and replace such values before you paste them.

## Setting up

You need:

- Node.js 24 for development. The ESLint toolchain needs Node.js 22.13 or later; the published package runs on
  Node.js 22.9 or later, and the tests run on it too (see [Node.js versions](#nodejs-versions)).
- pnpm 12.9.1, the version in `package.json#packageManager`: `corepack enable`, or
  `npm install --global pnpm@12.9.1`.
- Git with LF line endings. `.gitattributes` enforces them; on Windows, also set `git config core.autocrlf input` in
  your clone, so that lint, tests and tarballs see the same bytes as on Linux.

```sh
git clone https://github.com/Defkil/jlv.git
cd jlv
pnpm install --frozen-lockfile
```

No dependency runs an install script or needs a compiler.

## Workspace

| Directory | Contents |
| --- | --- |
| `packages/jlv` | The published package: `src` (TypeScript), `test` (node:test), its README, license and notices |
| `packages/format-fixtures` | A private package with the shared log fixtures and their typed catalogue |
| `scripts` | The test runner, the package check, the publication script and their tests |
| `docs` | The guides, their examples in `docs/examples`, the release procedure, the manual terminal checklist, and the plan and results of jlv 2 |

## Commands

| Command | Runs |
| --- | --- |
| `pnpm run typecheck` | TypeScript over the sources, the tests and the scripts, without emitting |
| `pnpm run lint` | ESLint with `--max-warnings 0` |
| `pnpm run build` | `packages/jlv/dist`: JavaScript, declarations and source maps |
| `pnpm test` | compiles the sources, tests and scripts into `.test-dist` and runs every test with node:test |
| `pnpm run check:package` | builds, packs the npm tarball and checks it installed in an empty project: the files, the manifest, the command, a strict TypeScript consumer, plugins and `npm audit` (needs the npm registry) |

`node .test-dist/scripts/run-tests.js --test-name-pattern=<pattern>` runs some tests again after `pnpm test`.
`JLV_LIFECYCLE_CYCLES=10000` makes the lifecycle test of the viewer run 10,000 cycles instead of 200.

## Tests

- Tests are TypeScript in `packages/*/test` and `scripts`, compiled into `.test-dist` and run as JavaScript with
  node:test; there is no test framework or loader. Every test run gets an empty home directory and its own
  temporary directory.
- The viewer is tested headless: a stream sends real key sequences, and the tests read the screen's cells, colors and
  the bytes written to the terminal. Command-line tests spawn `jlv` with pipes, signals and pretended terminals.
- Every `console` block of the README and of `docs/*.md` is a test: its commands run in `docs/examples` and must print
  what the block shows. Change the examples together with the behavior.
- `scripts/check-package.ts` checks the npm tarball as users install it. A change of the published files needs a
  change of its expectations.
- **No browser or UI automation.** Nothing drives a terminal emulator or a browser. What headless tests cannot show,
  such as keys from a real console while standard input is a pipe, is in the
  [manual terminal checklist](docs/manual-terminal-checklist.md), which maintainers run before a release.

### Node.js versions

CI runs the tests and the package check on Node.js 22.9.0, the oldest release that `engines` allows, and on the latest
22, 24 and 26. To run the tests with another Node.js locally, compile them with your development Node.js and run the
emitted runner with the other one:

```sh
pnpm test
/path/to/other/node .test-dist/scripts/run-tests.js
```

### Windows and ARM64

Everything runs on Windows, including Windows on ARM64, without build tools. Two tests are skipped on Windows because
they need POSIX signals or file permissions. The test runner links each package's dependencies into `.test-dist` with
junctions, since pnpm's relative symbolic links do not resolve through a junction. Official Node.js zips for
`win-arm64` serve for other versions; check them against the release's `SHASUMS256.txt`. Node.js 22.9.0 cannot open
`\\.\CONIN$` while standard input is a pipe, so jlv falls back to the console driver there; the
[manual terminal checklist](docs/manual-terminal-checklist.md) covers it.

## Changing code

- Keep a change focused on one problem; unrelated clean-ups belong in their own change.
- Code, comments, documentation and commit messages are in English.
- The code is strict TypeScript with ECMAScript modules, `node:` imports and kebab-case file names. The ESLint
  configuration combines neostandard, typescript-eslint's strict type-checked rules and Unicorn; every local exception
  carries a one-line reason.
- `src/tui/blessed-boundary.ts` is the only module that loads the terminal library. Text from logs reaches the screen
  through `displayText` or the `markup` tag of `src/tui/formatting.ts` only.
- A new runtime dependency needs a reason and the inventory that `docs/v2-phase-4-results.md` shows: license, install
  scripts, native code and advisories. Dependencies are exact pins; there is no update bot.
- Add or change tests with every behavior change, and update the README, `docs/` and the examples when options,
  output or formats change. Note user-visible changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(viewer): ...`,
`fix(cli): ...`, `docs: ...`, `test: ...`, `build: ...`, `ci: ...`. Every commit passes typecheck, lint and tests on its
own. Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.

## Pull requests

Fork the repository, create a branch and open a pull request against `master`. Describe what changes and why, how you
checked it, and what users will notice. Run `pnpm run typecheck`, `pnpm run lint` and `pnpm test` before you open it;
the maintainer runs the CI workflow before merging.

## Releases

Maintainers release; contributors do not change the version. [docs/release.md](docs/release.md) describes the
release and its checks.
