# jlv 2 phase 6 results

Measured on 2026-10-11 for plan §8 phase 6: the final record model, the built-in formats,
configuration, plugins and diagnostics. The decisions that later phases must apply are
summarized in plan §0.14. Scratch scripts, the generated fixture, the packed tarball and
the downloaded runtimes lived in a temporary directory outside the repository and were
deleted afterwards.

## Environment

- Windows 11 Home on ARM64, 12 logical processors, 16 GiB RAM, shared with other work
  during the measurements (at times a Rust build on four cores).
- Node 26.10.0 installed locally; Node 22.9.0, 22.23.3 and 24.21.0 from the official
  `win-arm64` zips, each checked against its `SHASUMS256.txt`.
- pnpm 12.9.1, typescript 6.0.3, eslint 10.12.0.

## What phase 6 built

| Module | Role |
| --- | --- |
| `src/api.ts` | The public types of plan §5: the record, the format contract, plugins and filters. It has no runtime code. |
| `src/record.ts` | Normalization: levels, timestamps and units, messages, correlation identifiers, JSON checks, field profiles and mapping warnings |
| `src/field-path.ts` | Segment paths for the new configuration, next to lodash's grammar for the legacy mapping |
| `src/formats/*.ts` | `jsonl`, `pino`, `bunyan`, `winston`, `logfmt`, `csv` and `docker`, the registry in detection order, the shared JSON-lines reader and the sample helpers |
| `src/ingestion.ts` | Per-source sampling, format choice and replay; a reader's events in small batches with backpressure; record numbers, diagnostics, counts and `--strict` |
| `src/configuration.ts` | Discovery and precedence, `jlv.config.json` version 1 with validation, the legacy INI mapping |
| `src/plugins.ts` | `--plugin` loading, shape checks and runtime checks of plugin output |
| `src/tui/log-row.ts` | The compatibility row of the widgets: display timestamp, level and message, and the details' fields or legacy extras |

`src/log.ts` and its tests are gone. The store keeps the level and the record's first and
last line in typed-array slots next to the time key, which now comes from the final
timestamp; the viewer normalizes only the rows it shows again, from the stored JSON. The
status line names the formats, the configuration file and the number of warnings.

## Runtime dependencies and public surface

csv-parse 7.0.3 joins neo-blessed 0.2.0, ini 6.0.0 and tinyglobby 0.2.17: MIT, no
dependencies, no install scripts, no native code; `pnpm audit` reports nothing for the
production or the full graph. No logging library is a dependency.

The package exports two entry points, both ECMAScript modules with declarations:

| Export | Content |
| --- | --- |
| `.` | types only: `JsonValue`, `JsonObject`, `FieldPath`, `LogLevel`, `TimestampUnit`, `LinePosition`, `RecordPosition`, `SourceInformation`, `LogDraft`, `LogRecord`, `FieldMapping`, `FormatContext`, `FormatSample`, `ParseDiagnostic`, `ParsedEntry`, `ParseEvent`, `NormalizationResult`, `LogFormat`, `RecordPredicate`, `FormatPlugin`, `FilterClause`, `FilterGroup` |
| `./formats` | `jsonLinesFormat`, `readJsonLines`, `pinoFormat`, `bunyanFormat`, `winstonFormat`, `logfmtFormat`, `csvFormat`, `createCsvFormat` with `CsvOptions`, `dockerFormat`, `builtInFormats` with `BuiltInOptions` |

`plugin-author.test.ts` builds the package with these exports into a temporary directory
and compiles a third-party plugin against it with strict settings and `skipLibCheck: false`;
a plugin that breaks the contract fails to compile.

`npm install jlv` alone makes pino work: `npm pack` of `packages/jlv` (189 files, 357 KB,
including sources and tests until phase 8 sets `files`) installed into an empty project
with `pnpm add <tarball> --offline` brought seven packages, the viewer and its four runtime
dependencies with fdir and picomatch. The installed `jv` printed the pino fixture with its
six levels, and `json-log-viewer/formats` read `pino-structure.log` as info, info, warn,
unknown (level 100), info, debug, error and fatal, the final row.

## Documentation

`docs/formats.md`, `docs/configuration.md` and `docs/migration.md` describe the formats and
their detection, the record and its JSON form, timestamps and units, levels, correlation
identifiers, diagnostics and their codes, plugins, both configuration files and the
changes for users of jlv 1 and json-log-viewer (upstream issue #7). `documentation.test.ts`
runs every console example of these pages in `docs/examples` with an empty home directory
and compares what jv prints, standard output and standard error interleaved, with the page;
19 examples, among them mixed formats in one run, `--strict`, a removed option, a
misspelled configuration key, the legacy INI mapping and a plugin.

## One million records

The fixture and the method of phases 0 and 5: 1,000,000 JSON lines of 512 bytes, the real
`runApplication()` of the emitted tree on a headless 120x40 terminal with the default limits
and order, the file in the operating system's cache. *First record* is the time until a
record's text is on the rendered screen, *whole file* the time until the newest record is
there. Three runs per runtime, as ranges:

| Node | First write | First record | Whole file | Peak RSS | RSS at the end | Heap after GC | Peak heap committed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22.9.0 | 61 to 72 ms | 104 to 138 ms | 2,856 to 3,220 ms | 139.9 to 140.7 MiB | 120.2 to 120.7 MiB | 10.2 to 10.3 MiB | 63 to 64 MiB |
| 22.23.3 | 63 to 66 ms | 101 to 104 ms | 2,871 to 3,150 ms | 129.3 to 141.2 MiB | 117.5 to 120.4 MiB | 9.5 to 10.6 MiB | 53 to 65 MiB |
| 24.21.0 | 52 to 168 ms | 77 to 205 ms | 2,536 to 3,080 ms | 150.5 to 158.1 MiB | 145.3 to 153.0 MiB | 10.9 to 11.1 MiB | 82 to 94 MiB |
| 26.10.0 | 60 to 87 ms | 83 to 123 ms | 2,486 to 3,245 ms | 151.2 to 182.4 MiB | 135.1 to 165.2 MiB | 11.1 to 11.3 MiB | 63 to 89 MiB |

Both targets hold on all four runtimes: under 256 MiB peak RSS and the first visible update
well under 1 s. Memory stays about where phase 5 left it (133 to 176 MiB peak). The whole
file takes longer, 2.5 to 3.2 s against 1.8 to 2.6 s in phase 5, spread by the shared
machine: every record is now normalized completely (timestamp, level, message, correlation
identifier and a JSON check) instead of mapped and keyed. Runs while other work used four
cores took up to 6 s.

Two measurements changed the code. Normalization first took 6.1 to 7.0 s for the whole file:
the RFC 3339 regular expression, a closure and a result object per field lookup and copies
in the JSON check. The usual timestamp form of `toISOString()` is now read character by
character and one-segment paths are looked up directly. Then Node 24.21.0 peaked at 216 to
269 MiB with 167 MiB of committed heap: the reader's events went over in one batch per
256 KiB chunk, about 500 parsed records alive at every young-generation collection, and V8
grows the young generation with the bytes that survive. Batches of at most 64 events brought
the committed heap back to 82 to 94 MiB without costing time.

## Test matrix

`node .test-dist/scripts/run-tests.js` with the test build of Node 26.10.0, on the final
tree, twice per runtime (four times on 24.21.0 and 26.10.0, since the first summary of
their runs was lost to the reporter's format).

| Runtime | Tests | Passed | Skipped | Failed | Durations |
| --- | --- | --- | --- | --- | --- |
| 22.9.0 | 392 | 390 | 2 | 0 | 21 s, 19 s |
| 22.23.3 | 392 | 390 | 2 | 0 | 20 s, 19 s |
| 24.21.0 | 392 | 390 | 2 | 0 | 21 s, 25 s, 20 s, 22 s |
| 26.10.0 | 392 | 390 | 2 | 0 | 20 s, 19 s, 19 s, 17 s |

The two skipped tests are the POSIX-only ones of phase 5. `pnpm run typecheck`,
`pnpm run lint` and `pnpm test` passed for every phase 6 commit on Node 26.10.0, each in a
clean export of the commit.

The lifecycle proof with `JLV_LIFECYCLE_CYCLES=10000` passed on Node 26.10.0 with the
compatibility rows: the census of nodes, keyable and clickable elements, focus history and
listeners was unchanged after 10,000 cycles (356.2 s, 277.8 s in phase 5; each render now
normalizes its rows from the stored JSON, and the clean-export checks shared the machine),
and the order was computed once per data or query revision, never for a cursor move
(22.8 s; 17.1 s in phase 5).

## Proofs of plan §8 phase 6

| Proof | Where |
| --- | --- |
| The entire shared corpus on all supported Node versions | `corpus.test.ts`: every fixture whole and in one-byte chunks, with its expected records, skips and diagnostics; the matrix above |
| pino false substitutions, numeric level 100, fatal final row | `pino.test.ts`, `corpus.test.ts` (`pino-structure.log`) |
| CSV quoted multiline, size limit, header cases | `csv.test.ts`, `corpus.test.ts` (CRLF with quoted commas, line breaks and quotes; header only; malformed quotes; semicolons) |
| logfmt grammar | `logfmt.test.ts` |
| Docker plain and JSON envelopes | `docker.test.ts`, `corpus.test.ts` (envelopes and raw `docker logs` output) |
| Seconds, milliseconds, microseconds, nanoseconds; UTC; invalid timestamps | `record.test.ts` |
| Per-source mixed formats | `ingestion.test.ts`, `application.test.ts`, `documentation.test.ts` (`worker.log orders.csv`) |
| Sampling replay, timeout and tie | `ingestion.test.ts` |
| Config precedence with the temporary home unchanged | `configuration.test.ts`, `application.test.ts` |
| Plugin ESM, CJS, version, collision and output-shape failures | `plugins.test.ts` |
| TS compile fixture for third-party plugin authors | `plugin-author.test.ts` with `packages/format-fixtures/fixtures/plugin-author` |
| No XML test labeled as XML support | there is no XML test or fixture |

## Behavior that changed

Each change has a named test and is explained in its commit.

- Levels are normalized: the level column shows `info` for `INFO` and for pino's `30`, the
  level filter offers the seven levels and ignores case, sorting by level follows severity
  with `unknown` last, and `-l` takes names only (`-l 30` is a usage error).
- JSON values that are no objects are diagnostics instead of rows; the characterization log
  now has 31 records and 4 skipped lines. Messages that are objects or arrays show as
  bounded JSON.
- `--output jsonl` and `--save` write the record of plan §5 (identifier, source, position,
  timestamp, timestamp text, level, message, correlation identifier and the complete
  fields), no longer the mapped values. `--output plain` prints `-` for a missing part.
- Configuration comes from the working directory before the home directory, and
  `jlv.config.json` before `.json-log-viewer`; `--config` and `--no-config` choose
  explicitly. A configuration error ends the run with exit code 2 before any screen.
- `--format`, `--timestamp-unit`, `--strict`, `--config`, `--no-config` and `--plugin` are
  new; `--param`, `--open`, `--reset`, `--backup`, `--transformer` and `--transformer-js` fail
  with exit code 2 and say what replaces them.
- Diagnostics name the input and the line; warnings show once per input and kind, errors
  up to ten, then totals. An input without records ends with exit code 1.

## Deviations from the plan

- Parse events and diagnostics carry a `LinePosition` (first and last line). The record
  number is assigned centrally, since a followed name's files each get a new reader while
  the numbers go on.
- `FormatContext.timestampUnit` is optional: absent means the format's own unit, so that an
  explicit `--timestamp-unit` can be told apart from a default. `FormatContext.levels`
  carries the configuration's level names to every format.
- Text of digits is a timestamp with an explicit unit alone; the plan also asked for a
  mapping. The explicit unit is the user's statement, and a mapping would not make the
  guess any safer.
- csv-parse holds back the last character of each chunk, so a followed CSV file would show
  each row only after the next one. jlv frames CSV records itself by csv-parse's quote rules
  and lets csv-parse parse the complete records; the delimiter is one ASCII character.
- `--plugin` resolves a package name with `require.resolve` from the working directory; a
  package that exports only for `import` needs the path of its file.
- The legacy INI paths of the normalized parts are split into segments once (`log.level` is
  `log` then `level`); upstream's lodash tried the whole key first. The extra keys of the
  details keep lodash's behavior.
- `winston` never claims an input by itself (probe 0): its JSON cannot be told from other
  JSON lines. `--format winston` adds Winston's level names.
- logfmt allows `=` inside bare values (`url=/a?b=c`) and keeps unknown escapes as they are.
- The help lists the built-in formats only; a plugin's format is a valid `--format` value
  without appearing there.

## Gotchas for phases 7 and 8

- Filters: `f` still replaces the previous filter (#19). Profiles are validated but not
  applied, `--where`, `--profile` and `--predicate` do not exist yet, and plugin predicates
  are loaded but unused. `docs/configuration.md` documents a profile's field as a path into
  the record (`["message"]`, `["fields", "route"]`), as plan phase 7 describes.
- The correlation identifier is normalized and written by `--output jsonl`, but the viewer
  has no column, palette or `c` shortcut yet.
- Nothing is sanitized for the terminal yet: messages, timestamp texts, original levels,
  logfmt keys, CSV header names, labels and file names reach the rows, the details, the
  status line and standard error as they are; plain output escapes only CR and LF, and the
  `markup` tag inserts values unchanged. Tabs render wider than one cell, which a wrapping
  test relies on.
- The status line is longer (formats, configuration file, warnings) and can overflow a
  narrow terminal.
- The viewer normalizes every shown row again from the stored JSON with the source's
  format, also with a plugin's `normalize`; a failure there falls back to a row from the
  raw fields.
- Keep the readers' batches small: the RSS of the benchmark depends on how many parsed
  records are alive at a young-generation collection.
- Docker plain-text records keep their text in `docker.log` too, so it appears twice in
  plain output and the details.
- Phase 8: the documentation examples run `jv` (the test checks the program name), the
  package has no `files` list and is still called `json-log-viewer`, and
  `packages/jlv/README.md` is upstream's text.
