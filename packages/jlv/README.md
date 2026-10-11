# jlv

> A terminal viewer for JSON logs and other structured logs.

jlv shows log records from files, glob patterns and pipes in an interactive terminal viewer: sort them, search them,
filter them, follow a growing file and open the details of a record. Without a terminal it writes the records as text
or as JSON lines, so it also works in scripts and pipelines. It reads JSON lines, pino, bunyan, Winston, logfmt, CSV
and Docker's json-file logs, recognizes the format of each input by itself and normalizes every record into the same
timestamp, level, message and correlation identifier. Its memory stays bounded, however long the log.

jlv 2 continues [json-log-viewer](https://github.com/gistia/json-log-viewer), the terminal JSON log viewer by Felipe
Coury and contributors. It keeps json-log-viewer's keys and configuration file and replaces jlv 1, the wrapper that
started json-log-viewer, and jlv-pino, whose pino support is built in now.

## Install

jlv needs [Node.js](https://nodejs.org/) 22.9 or later.

```sh
npm install --global jlv
```

`npx jlv app.log` runs it without installing. A global install adds the command `jlv` only; installed into a
project, npm also links `neo-blessed`, the terminfo helper of jlv's terminal library, into `node_modules/.bin`. No
package that jlv installs runs an install script or needs a compiler.

## Quick start

```sh
jlv app.log                     # the viewer, newest records first
jlv app.log 'logs/*.log'        # several files and quoted glob patterns
node app.js | jlv               # a live pipe; the keys come from the terminal
jlv --follow app.log            # keep reading a file that grows, is truncated or rotated
jlv app.log --output plain      # text instead of the viewer
```

Press `?` in the viewer for its keys and `q` to quit. The examples below use the files in
[docs/examples](https://github.com/Defkil/jlv/tree/master/docs/examples), and the tests run every one of them:

```console
$ jlv --output plain pino.log
2026-10-11T10:00:00.000Z info server listening {"pid":4120,"hostname":"api-1","port":8080}
2026-10-11T10:00:01.250Z warn slow request {"pid":4120,"hostname":"api-1","reqId":"req-7","responseTime":1840}
2026-10-11T10:00:02.500Z error upstream failed {"pid":4120,"hostname":"api-1","reqId":"req-8","err":{"type":"Error","message":"connection refused"}}
2026-10-11T10:00:03.000Z fatal shutting down {"pid":4120,"hostname":"api-1"}
$ cat pino.log | jlv --output plain --level error
2026-10-11T10:00:02.500Z error upstream failed {"pid":4120,"hostname":"api-1","reqId":"req-8","err":{"type":"Error","message":"connection refused"}}
```

## Inputs and outputs

jlv reads files, glob patterns and standard input. Name a pattern in quotes, as in `'logs/*.log'`, so that jlv expands
it the same way on every system; `-` is standard input, and without inputs jlv reads standard input when it is a pipe.
Files of different formats can be read together, each in its own format.

`--output` chooses what jlv does with the records:

| Mode | Output |
| --- | --- |
| `auto` | the viewer when standard output is a terminal and jlv can read keys from it; plain text otherwise. The default |
| `tui` | the viewer, or exit code 1 when there is no terminal |
| `plain` | one line per record: the time in UTC, the level, the message and the other fields as JSON |
| `jsonl` | one JSON object per record with its normalized parts and all its original fields |

`--save <file>` also writes the records to a new file as JSON lines; `--overwrite` lets it replace a file. Plain text,
JSON lines and the save file get every record that the filters keep, in the order in which they arrive, while the
viewer keeps only the newest ones (see [Limits](#limits)).

```console
$ jlv --output jsonl --level fatal pino.log
{"identifier":"1:4","source":{"identifier":"1","label":"pino.log","order":0},"position":{"recordNumber":4,"firstLine":4,"lastLine":4},"timestamp":1791712803000,"level":"fatal","message":"shutting down","fields":{"level":60,"time":1791712803000,"pid":4120,"hostname":"api-1","msg":"shutting down"}}
```

The viewer sorts files by time, newest first, and pipes and `--follow` by arrival; `--sort` chooses `timestamp`,
`level`, `message` or `arrival`, with a leading `-` for descending, as in `--sort=-level`.

## Formats

| Format | Records | Recognized by |
| --- | --- | --- |
| `jsonl` | one JSON object per line with `timestamp`, `level` and `message` | any JSON object, as the fallback |
| `pino` | JSON lines with a numeric `level`, `time` in milliseconds and `msg` | its fields |
| `bunyan` | JSON lines with `v: 0`, `name`, `hostname`, `pid`, `time` and `msg` | its fields |
| `winston` | the JSON of Winston's `json()` format with Winston's level names | `--format winston` only |
| `logfmt` | `key=value` pairs, one record per line | its keys |
| `csv` | a header, then one record per row | a header that names a message column |
| `docker` | Docker's json-file envelopes, with JSON or text inside | `log`, `stream` and `time` |

jlv chooses a format for each input from its first 64 KiB, and `--format` chooses one for all inputs. Levels are
normalized to `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `unknown`, in any case and with pino's and bunyan's
numbers; timestamps are numbers in milliseconds, unless `--timestamp-unit` names another unit, or text in RFC 3339 with
a zone. Lines that jlv cannot read are skipped with their input and line on standard error, or counted in the
viewer's status line.

```console
$ jlv --output plain worker.log orders.csv
2026-10-11T10:00:00.000Z info worker started {"queue":"mail"}
2026-10-11T10:00:02.000Z warn retrying job {"job":"17","attempt":"2"}
2026-10-11T10:00:00.000Z info order placed {"order":"A-17"}
2026-10-11T10:00:05.000Z error payment declined\ncard expired {"order":"A-17"}
```

[Log formats](https://github.com/Defkil/jlv/blob/master/docs/formats.md) describes each format, the detection, the
record, timestamps, levels, correlation identifiers and every diagnostic.

## The viewer

The viewer shows one record per row with its time, level, correlation identifier and message, and a status line with
the sort, the filters, the formats, the configuration file and the counts. Enter opens the details of a record as a
tree or as JSON. The text of a log shows as text: escape sequences in it are removed, control characters show as JSON
escapes such as `\n`, and blessed tags such as `{red-fg}` stay literal.

### Keys

`?` shows these keys in the viewer.

#### Records

| Keys | Action |
| --- | --- |
| Up, Down | move the cursor |
| PageUp, PageDown | move by a page |
| 0, $ | go to the first or the last record |
| A, C, G | go to the first, the middle or the last row of the page |
| g | go to a line |
| Enter | show the details of the record |
| / | search the timestamps and the messages, ignoring case |
| n | search again from the next record |
| s | sort by timestamp, level, message or arrival; the same again sorts descending |
| l | show one level, or all levels again |
| f | add a filter, remove one, choose a profile or a predicate, or clear all |
| c | show only the records of the correlation identifier of the record, or all again |
| ? | show these keys |
| q, Ctrl-C | quit |

#### Details

| Keys | Action |
| --- | --- |
| j | show the data as JSON or as a tree |
| Up, Down | scroll by a line |
| PageUp, PageDown | scroll by a page, by five with Shift |
| Home, End | go to the first or the last line |
| Enter, Escape | close |

#### Pickers and prompts

| Keys | Action |
| --- | --- |
| Up, Down, Enter | choose an item |
| a letter | choose the first item that starts with it |
| Escape | close without a choice |

#### The key help

| Keys | Action |
| --- | --- |
| Up, Down, PageUp, PageDown, Home, End | scroll |
| Enter, Escape, q, ? | close |

### Filters

Filters add up: a record shows only when it passes all of them. `l` chooses the level. `f` opens the filter manager,
which adds a text filter on the timestamp, the message, the correlation identifier or an original field (`other`, as
`path:text`, such as `user.name:ann`), removes any filter, chooses a profile of the configuration or a predicate of a
plugin, or clears them all. The status line lists the active filters.

On the command line, `-l` chooses the level, `--where` adds a clause in JSON, `--profile` applies a profile and
`--predicate` a predicate. They start the viewer with these filters and decide what `--output plain`, `--output jsonl`
and `--save` write. A clause names a field of the record as `--output jsonl` writes it, an operator and a value:
`equals` compares JSON values by type, `contains` looks for text without regard to case.

```console
$ jlv --output plain --where '{"field":["fields","reqId"],"operator":"equals","value":"req-7"}' pino.log
2026-10-11T10:00:01.250Z warn slow request {"pid":4120,"hostname":"api-1","reqId":"req-7","responseTime":1840}
$ jlv --output plain -c profiles.config.json --profile problems pino.log
2026-10-11T10:00:02.500Z error upstream failed {"pid":4120,"hostname":"api-1","reqId":"req-8","err":{"type":"Error","message":"connection refused"}}
2026-10-11T10:00:03.000Z fatal shutting down {"pid":4120,"hostname":"api-1"}
```

A profile is a named group of clauses in the configuration file, with `mode` `all` or `any`;
[profiles.config.json](https://github.com/Defkil/jlv/blob/master/docs/examples/profiles.config.json) defines the two of
this example. jlv reads profiles and never writes them.

### Correlation identifiers

A record's correlation identifier is the mapped field, or the first of `correlationId`, `correlation_id`, `requestId`,
`req.id`, `trace_id` and `traceId` that it has. Once a record has one, the viewer shows the identifiers in a column,
each in a color that its text decides, so the same identifier has the same color everywhere. `c` shows only the
records with the identifier of the record under the cursor, and `c` again shows all of them; the cursor stays on its
record.

### Characters

CJK and other wide characters take two cells, and combining marks combine with the character before them, as in a
decomposed `ü`. Emoji show as `?`: terminals draw them in two cells, and the terminal library that jlv uses measures
them in one, which would shift the rest of the row. `--output plain` and `--output jsonl` keep every character.

## Configuration

jlv needs no configuration. A configuration file tells it where to find the parts of a record, how to read numeric
timestamps and levels, which format to use, how many records the viewer keeps and which filter profiles exist. jlv
reads the first of `jlv.config.json` and `.json-log-viewer` in the working directory, then in the home directory;
`--config <file>` names a file, `--no-config` reads none. It reads one file per run and never writes one.

```json
{
  "version": 1,
  "mapping": {
    "timestamp": ["datetime"],
    "level": ["level_name"]
  },
  "levels": {
    "NOTICE": "info",
    "ALERT": "fatal"
  }
}
```

```console
$ jlv --output plain -c monolog.config.json monolog.log
2026-10-11T10:00:00.253Z info Matched route "heartbeat" {"context":{},"level":200,"channel":"request","extra":{}}
2026-10-11T10:00:05.000Z info Disk usage at 91% {"context":{"disk":"/var"},"level":250,"channel":"monitor","extra":{}}
2026-10-11T10:00:09.500Z fatal Database unreachable {"context":{},"level":550,"channel":"db","extra":{}}
```

The legacy `.json-log-viewer` of json-log-viewer and jlv 1, an INI file with a `[transform]` section, still maps
`timestamp`, `level`, `message` and `correlationId`, and its other keys choose the fields that the details and plain
output show. An unknown key in `jlv.config.json` is an error with a suggestion.
[Configuration](https://github.com/Defkil/jlv/blob/master/docs/configuration.md) describes every key, the mapping
paths, levels, profiles, the legacy file and the command line.

## Plugins

A plugin adds formats and predicates. jlv loads one only from the command line, with `--plugin <file-or-package>`;
a configuration file cannot load code. A plugin is trusted code that runs inside jlv with your rights, so load only
plugins that you would also run yourself.

```console
$ jlv --output plain --plugin ./text-plugin.mjs --predicate finished notes.txt
- - backup finished in 42 s
```

A plugin is an ECMAScript or CommonJS module whose default export has `apiVersion: 1`, its `formats` and optional
`predicates`. The types come from `jlv`, and the built-in formats and readers from `jlv/formats`:

```ts
import type { FormatPlugin, LogFormat } from 'jlv'
import { readJsonLines } from 'jlv/formats'

const acme: LogFormat = {
  identifier: 'acme',
  probe: sample => sample.text.includes('"sev":') ? 70 : 0,
  read: readJsonLines,
  normalize: value => ({
    record: { level: value['sev'] === 4 ? 'error' : 'info', message: String(value['text'] ?? ''), fields: value },
    diagnostics: []
  })
}

const plugin: FormatPlugin = { apiVersion: 1, formats: [acme] }
export default plugin
```

Both exports are ECMAScript modules with declarations, which compile with `skipLibCheck` off and need only Node's types
(`@types/node`); importing them has no effects. CommonJS code loads `jlv/formats` with `await import('jlv/formats')`.
[Formats from plugins](https://github.com/Defkil/jlv/blob/master/docs/formats.md#formats-from-plugins) describes the
contract.

## Limits

- The viewer keeps the newest 50,000 records and at most 64 MiB of them; `--max-records` and `--max-bytes`, or
  `maxRecords` and `maxBytes` in the configuration, change that. The status line shows `kept <retained> of <seen>`
  once it drops older records, and sorting and searching work on the records it keeps. `--output plain`,
  `--output jsonl` and `--save` write every record.
- A line or a CSV record holds at most 1 MiB; longer ones are skipped with a diagnostic.
- Pretty-printed JSON, files that hold one JSON array, XML and syslog are no input. Convert JSON to JSON lines first,
  for example with `jq -c '.[]' records.json > records.jsonl`.
- `--follow` checks the files every 500 ms by name, so it follows rotation and truncation; it does not discover new
  files that a pattern would match.

## Windows

jlv works on Windows; its tests run on Windows on ARM64 and on Linux. Quote glob patterns as on other systems, so that
jlv expands them itself; on Windows they may also use backslashes, as in `jlv 'logs\*.log'`. With a pipe such as
`node app.js | jlv`, jlv reads the keys from the console; a process without a console, such as a service, gets plain
output instead of the viewer.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done, or quit with `q` |
| 1 | an input, the output or a plugin failed, an input held no records, `--strict` stopped at a broken record, a predicate failed, or `--output tui` found no terminal |
| 2 | a usage error: an unknown option, an unusable configuration, an unknown profile or predicate, or a save file that exists |
| 130, 143, 129 | ended by Ctrl-C, SIGTERM or SIGHUP |

## Migrating

jlv 2 is a new major version: the viewer itself instead of a wrapper.

- **From jlv 1:** the command is `jlv`, and it needs Node.js 22.9. `-f`, `-c` and `-s` stay; `-s` writes JSON lines of
  the records into a new file. `--param`, `--open`, `--reset`, `--backup`, `--transformer` and `--transformer-js` are
  gone and say what replaces them. jlv never writes into the home directory, and its CommonJS functions are gone; the
  package exports ECMAScript modules.
- **From jlv-pino:** pino is built in. jlv recognizes pino's records by itself, and `--format pino` chooses the format
  explicitly; uninstall jlv-pino and drop `--transformer jlv-pino`.
- **From json-log-viewer:** json-log-viewer's command `jv` stays with that package, so both can be installed. Sort
  with `--sort`, since `-s` saves; levels are normalized, so `-l` takes a level name in any case; `f` adds filters
  instead of replacing them, and `?` shows the keys.

[Migrating to jlv 2](https://github.com/Defkil/jlv/blob/master/docs/migration.md) lists every change.

## Contributing and security

Bug reports and focused changes are welcome; [CONTRIBUTING.md](https://github.com/Defkil/jlv/blob/master/CONTRIBUTING.md)
explains the setup, the checks and the conventions. Report vulnerabilities privately as
[SECURITY.md](https://github.com/Defkil/jlv/blob/master/SECURITY.md) describes, never in a public issue. The
[changelog](https://github.com/Defkil/jlv/blob/master/CHANGELOG.md) lists the changes of each release.

## License

[MIT](https://github.com/Defkil/jlv/blob/master/packages/jlv/LICENSE) © Oliver Grüttner and Felipe Coury and
json-log-viewer contributors. jlv is a fork of [json-log-viewer](https://github.com/gistia/json-log-viewer), published by
Gistia under the MIT license; [NOTICE.md](https://github.com/Defkil/jlv/blob/master/packages/jlv/NOTICE.md) and
[docs/upstream-provenance.md](https://github.com/Defkil/jlv/blob/master/docs/upstream-provenance.md) record its origin
and the adopted changes of other contributors.
