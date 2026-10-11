# Changelog

All notable changes to the npm package `jlv` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

jlv 2 is the viewer itself. It continues [json-log-viewer](https://github.com/gistia/json-log-viewer) by Felipe Coury
and contributors, whose history it imports, and replaces the jlv 1 wrapper and jlv-pino. Read **Changed** and
**Removed** before upgrading; [Migrating to jlv 2](docs/migration.md) lists every change.

### Added

- The terminal viewer of json-log-viewer as the command `jlv`, ported to strict TypeScript on neo-blessed: records
  sorted by time, level, message or arrival, search, level filter, go to line, and the details of a record as a tree
  or as JSON, which now scroll with PageUp, PageDown, Home and End.
- Inputs: files, quoted glob patterns and standard input (`-`), read record by record as they arrive. With
  `node app.js | jlv`, the viewer reads its keys from the terminal (`/dev/tty`, `\\.\CONIN$` or the console driver);
  without a terminal, jlv writes plain text instead. `--follow` keeps reading files that grow, are truncated or are
  rotated.
- `--output auto|tui|plain|jsonl`: the viewer, text, or JSON lines of the normalized records with all their original
  fields. `--save <file>` also writes the records to a new file; `--overwrite` replaces one.
- Formats: JSON lines, pino, bunyan, Winston JSON, logfmt, CSV and Docker's json-file envelopes, chosen per input by
  their content or with `--format`; no logging library needs to be installed. Every record is normalized to a
  timestamp, one of seven levels, a message and an optional correlation identifier. `--timestamp-unit` reads numeric
  timestamps in seconds, milliseconds, microseconds or nanoseconds; `--strict` stops at the first broken record.
- Diagnostics that name the input, the line and the reason, on standard error or in the viewer's status line.
- `jlv.config.json` (version 1): field mappings, level names, the timestamp unit, the format, the CSV delimiter, the
  viewer's limits and filter profiles, validated with suggestions for misspelled keys. `--config` and `--no-config`
  choose the file.
- Filters that add up: the filter manager on `f`, `--where` with typed JSON clauses, `--profile` with the profiles of
  the configuration (`all` or `any`), and `--predicate` with the predicates of plugins. They apply to the viewer, the
  plain and JSON output and `--save` alike.
- Correlation identifiers in a colored column, and `c` to show only the records of the selected identifier.
- `?` shows the keys.
- Plugins with formats and predicates, loaded only with `--plugin`; the package exports the types as `jlv` and the
  built-in formats as `jlv/formats`.
- Wide characters such as CJK in two cells, and combining marks combined with their character.
- Bounded memory: the viewer keeps the newest 50,000 records and at most 64 MiB of them (`--max-records`,
  `--max-bytes`) and shows `kept <retained> of <seen>`; the plain and JSON output and `--save` get every record.
- `--version`, `--help` and exit codes 0, 1, 2 and 130.
- This changelog, a contributing guide, a code of conduct, a security policy and the documentation of the formats,
  the configuration and the migration, whose examples are tests. The package is built, tested as an installed tarball
  and published by CI with npm provenance.

### Changed

- **Node.js 22.9.0 or later** is required.
- **The package is the viewer.** `npm install --global jlv` installs the command `jlv`; it no longer installs
  json-log-viewer from GitHub or starts it, and json-log-viewer's command `jv` is not installed.
- **ECMAScript modules only.** The package exports types and formats; CommonJS code loads them with `import()`.
- `-s` and `--save` write the normalized records as JSON lines, and only into a new file unless `--overwrite` is
  given; json-log-viewer's `-s` for sorting is `--sort`.
- Configuration is read from the working directory before the home directory, from `jlv.config.json` before
  `.json-log-viewer`, and never written: jlv no longer copies a configuration into the home directory.
- Files sort by time, newest first, and pipes and `--follow` by arrival. Records without a valid time sort last, and
  a timestamp without a zone shows as text.
- Levels are normalized: the level filter, `-l` and sorting ignore case and read pino's and bunyan's numbers, and
  sorting by level follows severity.
- JSON values that are no objects, and lines that are no JSON, are skipped with a diagnostic instead of being shown
  or dropped silently. An input without records ends with exit code 1.
- The text of logs shows as text: blessed tags stay literal, escape sequences are removed, and control characters
  show as JSON escapes, also in plain output and on standard error.
- `f` adds a filter instead of replacing the previous one, and `l` sets only the level.
- Rows always fit the panel, and long messages end with an ellipsis.

### Removed

- The options of jlv 1 `--param`, `--open`, `--reset`, `--backup`, `--transformer` and `--transformer-js`; they end
  with exit code 2 and name what replaces them.
- The CommonJS functions and the transformer interface of jlv 1. jlv-pino is no longer needed: pino is built in.
- json-log-viewer's `w`, which had no visible effect.

### Fixed

- json-log-viewer's memory leak and slow navigation: the viewer keeps one row element, computes the order once per
  change of the data, the sort or the filters, and never reads a whole file at once, so files beyond V8's maximum
  string length open.
- The order is refreshed at once when the sort changes, PageUp reaches the first record from a partial page, and
  empty logs and tiny terminals no longer produce negative widths.
- Reading from a pipe, case-insensitive level filters, correlation identifiers, epoch timestamps, colors and slashes
  in log text, and filters that add up (json-log-viewer issues #12, #14, #15, #16, #18 and #19).

### Security

- Log text cannot act on the terminal: no escape sequence of a log reaches it, and blessed tags in log text stay text.
- The runtime dependencies are neo-blessed, ini 6, tinyglobby and csv-parse, without install scripts or native code,
  replacing minimist, ini 1.3, lodash and blessed-contrib with their prototype pollution advisories.
- A configuration file cannot load code; plugins load only from the command line.

## [1.0.1] - 2020-08-12

### Changed

- The README tells to install jlv globally.

## [1.0.0] - 2020-08-11

### Added

- A wrapper around json-log-viewer: it merged the log files of a glob pattern into one file, applied an optional
  transformer from npm or a file to the records, such as jlv-pino, copied a `.json-log-viewer` mapping into the home
  directory, and started json-log-viewer, installed from its GitHub repository, for the merged file, with `--open` in
  a new terminal. Its manifest declared no command.

[Unreleased]: https://github.com/Defkil/jlv/commits/master
[1.0.1]: https://www.npmjs.com/package/jlv/v/1.0.1
[1.0.0]: https://www.npmjs.com/package/jlv/v/1.0.0
