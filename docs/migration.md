# Migrating to jlv 2

jlv 1 was a wrapper: it merged log files, copied a `.json-log-viewer` file into the home directory and started
json-log-viewer, whose command is `jv`, for the merged file. jlv 2 is the viewer itself; it continues
json-log-viewer and replaces both. Its command is `jlv`; `jv` stays json-log-viewer's, so both can be installed side
by side. These notes list what changes for users of either. The examples on this page run in [examples](examples), and
the tests run every one of them.

jlv 2 needs Node 22.9 or later.

## Installing

```sh
npm install --global jlv        # the command jlv
npm install --save-dev jlv      # in a project, where npx jlv runs it
npm uninstall --global jlv-pino json-log-viewer
```

jlv 1 installed json-log-viewer from its GitHub repository, and its pino support came from jlv-pino; jlv 2 needs
neither, so the last line removes them if nothing else uses them. `jv` stays json-log-viewer's command.

## Reading logs

jlv 2 reads files, quoted glob patterns and standard input itself; it merges nothing into a temporary file. Each input
keeps its own format, and the matches of a pattern are read in the order of their names:

```console
$ jlv --output plain '[pw]*.log' orders.csv
2026-10-11T10:00:00.000Z info server listening {"pid":4120,"hostname":"api-1","port":8080}
2026-10-11T10:00:01.250Z warn slow request {"pid":4120,"hostname":"api-1","reqId":"req-7","responseTime":1840}
2026-10-11T10:00:02.500Z error upstream failed {"pid":4120,"hostname":"api-1","reqId":"req-8","err":{"type":"Error","message":"connection refused"}}
2026-10-11T10:00:03.000Z fatal shutting down {"pid":4120,"hostname":"api-1"}
2026-10-11T10:00:00.000Z info worker started {"queue":"mail"}
2026-10-11T10:00:02.000Z warn retrying job {"job":"17","attempt":"2"}
2026-10-11T10:00:00.000Z info order placed {"order":"A-17"}
2026-10-11T10:00:05.000Z error payment declined\ncard expired {"order":"A-17"}
```

Quote patterns in every shell, so that jlv expands them the same way everywhere. On Windows, patterns may also use
backslashes, as in `jlv 'logs\*.log'` in PowerShell or `jlv "logs\*.log"` in cmd. Pipes and growing files need no
merge step either:

```sh
node app.js | jlv                 # records as they arrive; the keys come from the terminal
node app.js | jlv app.log -       # a file and the pipe together
jlv --follow 'logs/*.log'         # files that grow, are truncated or rotated
```

## Options of jlv 1

| jlv 1 | jlv 2 |
| --- | --- |
| `-f, --files <glob>` | the same; files and quoted patterns also work without it, as in `jlv app.log 'logs/*.log'` |
| `-c, --config <path>` | reads that file directly, JSON or the legacy INI form, and copies nothing |
| `-s, --save <path>` | writes the records as JSON lines of the [record](formats.md#the-record), not the merged lines, and only into a new file unless `--overwrite` is given |
| `-p, --param <param>` | gone: jlv 2 takes the viewer's options directly |
| `-o, --open` | gone: jlv 2 runs in the current terminal |
| `-r, --reset` | gone: jlv 2 never writes into the home directory |
| `-b, --backup <path>` | gone, for the same reason |
| `-t, --transformer <name>` | gone: pino is built in, and other formats come from [plugins](formats.md#formats-from-plugins) |
| `-tjs, --transformer-js <path>` | gone, for the same reason |

A removed option ends the run with exit code 2 and names what replaces it:

```console
$ jlv --transformer jlv-pino pino.log; echo $?
jlv: --transformer is gone in jlv 2: pino is built in (--format pino), and other formats come from plugins (--plugin <file>)
usage: jlv [options] [file | 'glob' | -]...
Run jlv --help for the options.
2
```

jlv recognizes pino's records by itself, so jlv-pino is no longer needed.

## Options of json-log-viewer

- `-s` saves now; sorting is `--sort`. It sorts by `timestamp`, `level`, `message` or `arrival`, with a leading `-`
  for descending, as in `--sort=-level`; other fields are no longer sort keys. Files sort by `-timestamp` and pipes
  and `--follow` by `arrival` unless `--sort` says otherwise. `--output plain` and `--output jsonl` write in arrival
  order only.
- `-l` and `--level` take a level name in any case: `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `unknown`,
  and the aliases of [Levels](formats.md#levels). Since jlv reads pino's numbers as names, replace `-l 30` with `-l info`:

```console
$ jlv --output plain -l 30 pino.log; echo $?
jlv: --level takes trace, debug, info, warn, error, fatal, unknown, not '30'
usage: jlv [options] [file | 'glob' | -]...
Run jlv --help for the options.
2
$ jlv --output plain -l INFO pino.log
2026-10-11T10:00:00.000Z info server listening {"pid":4120,"hostname":"api-1","port":8080}
```

## Configuration

- json-log-viewer read `.json-log-viewer` only from the home directory, and jlv 1 copied it there. jlv 2 reads the
  first of `jlv.config.json` and `.json-log-viewer` in the working directory, then in the home directory, and never
  writes either; see [Which file](configuration.md#which-file).
- The `[transform]` section maps as before, for every format. jlv 2 splits its paths into keys once, so a key that
  contains a dot needs brackets, such as `level=["log.level"]`; lodash tried such a key as a whole first.
- `jlv.config.json` adds what the INI form cannot say: units, level names, the format, the CSV delimiter and the
  viewer's limits; see [jlv.config.json](configuration.md#jlvconfigjson).

## Records

- Levels are one of seven names, whatever the log wrote, so the level filter ignores case and sorting by level
  follows severity. An unknown level keeps its original value in the record, which the viewer shows.
- Numeric timestamps are milliseconds unless `--timestamp-unit` or the configuration names their unit, and text
  needs a zone. A date without a zone shows as its text and sorts last; jlv does not assume a zone for it.
- json-log-viewer showed JSON values that are no objects, such as arrays and numbers, as rows, and dropped `null`,
  `false`, `0` and `""` without a word. jlv 2 skips all of them and reports each line, as described in
  [Diagnostics](formats.md#diagnostics).
- Pretty-printed JSON and files that hold one JSON array are still no input; convert them into JSON lines. XML and
  syslog are no input either.
- `--output jsonl` and `--save` write each record as one JSON object with its identifier, source, position,
  normalized timestamp, level, message and correlation identifier, and the complete original record in `fields`; see
  [The record](formats.md#the-record). jlv 1 saved the merged lines as they were.

## Memory

json-log-viewer read a whole file into memory before it showed anything, and could not open files beyond about
512 MiB. jlv 2 shows records while it reads and keeps the newest 50,000 records and at most 64 MiB of them; the status
line shows `kept <retained> of <seen>` once it drops older ones, and sorting and searching work on the records it
keeps. `--max-records` and `--max-bytes`, or `maxRecords` and `maxBytes` in the configuration, change the limits.
`--output plain`, `--output jsonl` and `--save` write every record, whatever the viewer keeps.

## The viewer

- Filters add up. json-log-viewer's `f` replaced the filter, or cleared all filters when one was active, and only its
  last filter decided. `f` opens a filter manager now: it adds a filter, removes any one of them, chooses
  [profiles and predicates](configuration.md#filters) and clears all. `l` chooses the level, and its `all` clears only
  the level. `--where`, `--profile` and `--predicate` start the viewer with filters.
- `other` in the filter manager reads a field of the original record by the same paths as before, such as
  `user.name:ann`; text filters ignore case and look into the JSON text of numbers and objects.
- Correlation identifiers have a column, and `c` shows only the records of the selected record's identifier; see
  [Correlation identifiers](formats.md#correlation-identifiers). The cursor stays on its record when the sort or the
  filters change.
- `?` shows the keys. json-log-viewer's undocumented `?` opened the search with the last term; `n` searches with it
  again, and `/` starts a new search.
- Text of the records shows as text: blessed tags such as `{red-fg}`, slashes and backslashes stay as they are, colors
  and other escape sequences of a log are removed, and line breaks and other control characters show as `\n`, `\t`
  or `\u001b`. json-log-viewer showed only the first line of a message.

## Programs

jlv 1's CommonJS functions are gone. jlv 2's package exports ECMAScript modules: the types of records and formats
from `jlv`, and the built-in formats and readers from `jlv/formats`. CommonJS code loads them with
`await import('jlv/formats')`. Transformers become formats of a plugin, which [Formats from
plugins](formats.md#formats-from-plugins) describes; the [README](../packages/jlv/README.md#plugins) shows one in
TypeScript, which the package check compiles strictly against the published declarations and runs.
