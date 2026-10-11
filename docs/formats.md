# Log formats

jlv reads log files and standard input record by record. It chooses a format for each input, reads the records with
that format and normalizes every record into the same model: a timestamp, a level, a message, an optional
correlation identifier and the complete original fields. The viewer, `--level`, the sort orders and the outputs work
on that model, whatever the format was.

The examples on this page run in [examples](examples), and the tests run every one of them. `--output plain` and
`--output jsonl` write as text what the viewer shows in the terminal.

## Built-in formats

| Format | Records | Timestamp | Level | Message |
| --- | --- | --- | --- | --- |
| `jsonl` | one JSON object per line | `timestamp` | `level` | `message` |
| `pino` | one JSON object per line | `time` | `level`: 10 to 60, or a name | `msg` |
| `bunyan` | one JSON object per line | `time` | `level`: 10 to 60 | `msg` |
| `winston` | one JSON object per line | `timestamp` | `level`, with Winston's names | `message` |
| `logfmt` | `key=value` pairs, one record per line | `time` or `timestamp` | `level` | `msg` or `message` |
| `csv` | a header, then one record per row | `timestamp` or `time` | `level` | `message` or `msg` |
| `docker` | Docker's json-file envelopes | the inner record's, else Docker's `time` | the inner record's | the inner record's, else the text |

Every format is part of jlv; no logging library needs to be installed. A
[mapping](configuration.md#mapping) tells jlv where else to find the timestamp, the level, the message and the
correlation identifier, for every format.

## How jlv chooses a format

Without `--format`, jlv chooses a format for each input on its own. It takes a sample of up to 64 KiB and
32 complete lines, and every format scores how well the sample fits, from 0 to 100:

| Format | Score |
| --- | --- |
| `docker` | 98 times the share of the sample's JSON objects that are envelopes with `log`, `stream` and `time` |
| `bunyan` | 95 times the share of bunyan records: `v` 0, a numeric `level`, `name`, `hostname`, `pid`, a text `time` and `msg` |
| `pino` | 90 times the share of pino records: a numeric `level` with a numeric `time` or a text `msg` |
| `logfmt` | 80 times the share of lines with a text `time`, `timestamp`, `level`, `msg` or `message` |
| `csv` | 0 without a valid header that names a message column; else 70 times the share of rows as wide as the header, plus 15 for a `.csv` file |
| `winston` | 0, since Winston's JSON looks like any other; `--format winston` chooses it |
| `jsonl` | 10 when the sample holds a JSON object |

The highest score wins. Of formats with the same score, the one higher in this table wins, and formats from plugins
come after the built-in ones; jlv then warns which format it took and that `--format` chooses another. When no
format scores above 0, jlv reads JSON lines. The chosen format reads the sample again from its start, so no line is
lost, and broken lines at the start of an input do not hide the format of the lines after them. For a pipe or a
followed file, jlv waits at most 200 ms after the first complete line for the rest of the sample.

Each input keeps its own format, so files of different formats can be read together:

```console
$ jv --output plain worker.log orders.csv
2026-10-11T10:00:00.000Z info worker started {"queue":"mail"}
2026-10-11T10:00:02.000Z warn retrying job {"job":"17","attempt":"2"}
2026-10-11T10:00:00.000Z info order placed {"order":"A-17"}
2026-10-11T10:00:05.000Z error payment declined\ncard expired {"order":"A-17"}
```

`--format <format>`, or `format` in the [configuration](configuration.md), reads every input with one format.

## The record

Every record has these parts, whatever its format:

| Part | Value |
| --- | --- |
| `identifier` | `<input>:<record number>`, unique within a run |
| `source` | the input: its identifier and order, and its label, which is the argument as given, the path of a pattern's match or `stdin` |
| `position` | the record's number in its input, and its first and last line |
| `timestamp` | epoch milliseconds, when the record has a time that jlv reads |
| `timestampText` | the original text of a time that jlv cannot read, which the viewer shows instead |
| `level` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `unknown` |
| `message` | text |
| `correlationIdentifier` | text, when the record has one |
| `fields` | the complete original record, including the fields that the parts above came from |

`--output jsonl` and `--save` write records in this form, one JSON object per line:

```console
$ jv --output jsonl --level fatal pino.log
{"identifier":"1:4","source":{"identifier":"1","label":"pino.log","order":0},"position":{"recordNumber":4,"firstLine":4,"lastLine":4},"timestamp":1791712803000,"level":"fatal","message":"shutting down","fields":{"level":60,"time":1791712803000,"pid":4120,"hostname":"api-1","msg":"shutting down"}}
```

`--output plain` writes one line per record: the timestamp in UTC, the level, the message and the other fields as
one JSON object. For a level that jlv does not know, the viewer and `--output plain` show the original level; for a
time that jlv cannot read, its original text; and `-` for what a record lacks.

The viewer, `--output plain` and the messages on standard error show the text of records as text, so that a log can
neither color nor move nor clear the terminal, set its title or write its clipboard: escape sequences are removed, and
line breaks, tabs and other control characters show as JSON escapes such as `\n`, `\t` or `\u001b`. In the viewer,
blessed tags such as `{red-fg}` show as they are written. `--output jsonl` and `--save` keep the original values; they
also write DEL and the other control characters that JSON leaves as they are as escapes, which read back as the same
values.

## Timestamps

jlv reads these timestamps:

- Numbers, as the time since 1970-01-01 in a unit: milliseconds, unless `--timestamp-unit` or `timestampUnit` in
  the configuration says `seconds`, `microseconds` or `nanoseconds`. jlv never guesses the unit from the number of
  digits.
- Text in the form of RFC 3339 with a zone, such as `2026-10-11T10:00:00Z` or `2026-10-11 12:00:00.253+02:00`, also
  with the zone as `+0200` or `+02`, in lowercase, and with any number of fraction digits. Dates and times that do
  not exist, such as 30 February or 24:00, are no times.
- Text of digits, such as `"1791712800"`, only with an explicit unit from the command line or the configuration.
  jlv reads it exactly, also nanoseconds beyond the precision of a number.

Anything else stays text: the viewer shows it as it is, it sorts after all times in both directions, and jlv warns
once per input. A date without a zone, such as `2026-10-11 10:00:01`, stays text too, since jlv cannot know its zone.
The viewer and `--output plain` show times in UTC, with milliseconds.

`backup.log` holds seconds, which jlv reads as milliseconds until it is told otherwise:

```console
$ jv --output plain backup.log
1970-01-21T17:41:52.800Z info backup started
1970-01-21T17:41:52.861Z warn backup slow
$ jv --output plain --timestamp-unit seconds backup.log
2026-10-11T10:00:00.000Z info backup started
2026-10-11T10:01:01.500Z warn backup slow
```

## Levels

jlv knows seven levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal` and `unknown`. It reads level names in
any case, and `warning`, `err` and `critical` as `warn`, `error` and `fatal`. pino and bunyan write numbers, which
their formats read: 10, 20, 30, 40, 50 and 60 are `trace`, `debug`, `info`, `warn`, `error` and `fatal`. Other JSON
does not get pino's scale, since its numbers may mean something else. The `winston` format also reads Winston's
names: `silly` as `trace`, `verbose` as `debug`, `http` and `notice` as `info`, and `crit`, `alert` and `emerg` as
`fatal`.

Every other level is `unknown`, and the record keeps its original value in its fields, which the viewer shows.
`levels` in the [configuration](configuration.md#levels) names more levels, also numbers.

`--level` and the viewer's level filter take the seven names and the aliases, in any case. Sorting by level sorts by
severity from `trace` to `fatal`, with `unknown` last.

## Correlation identifiers

A record's correlation identifier is the mapped field, or else the first of `correlationId`, `correlation_id`,
`requestId`, `req.id` (the field `id` inside `req`), `trace_id` and `traceId` that the record has. Text and numbers
count, a number as its text, so `0` is an identifier; empty text is none.

Once a record of the input has an identifier, the viewer shows them in a column between the level and the message.
Each identifier has a color that its text alone decides, so the same identifier has the same color in every order
and every run; different identifiers may share a color, and the text tells them apart. `c` shows only the records
with the identifier of the record under the cursor, and a second `c` shows all records again; the cursor stays on its
record. The filter is the clause `{"field":["correlationIdentifier"],"operator":"equals","value":"<identifier>"}`,
which `--where` takes too.

## Diagnostics

jlv skips what it cannot read and says where: the input, the line and the reason. With `--output plain` or
`--output jsonl`, it writes diagnostics to standard error, apart from the records; the viewer counts them in its
status line. A warning, such as one for a timestamp without a zone, shows once per input and kind:

```console
$ jv --output plain broken.log
jv: broken.log:2: skipped a line that is no JSON
jv: broken.log:3: skipped a JSON value that is no object
jv: broken.log:4: warning: the timestamp "2026-10-11 10:00:01" has no zone; it is shown as text and sorts last
2026-10-11T10:00:00.000Z info first
2026-10-11 10:00:01 info no zone
2026-10-11T10:00:02.000Z loud unknown level
```

After ten skipped lines, jlv only counts them and reports the totals at the end. An input that holds no record at
all ends with exit code 1. `--strict` stops at the first record that cannot be read, after writing the records before
it, and ends with exit code 1; warnings do not stop it:

```console
$ jv --output plain --strict broken.log; echo $?
jv: broken.log:2: skipped a line that is no JSON
2026-10-11T10:00:00.000Z info first
jv: --strict stops at the first record that cannot be read
1
```

Every diagnostic has a code, which formats from plugins and programs that use jlv's types see. Errors skip a line
or a record; warnings keep it.

| Code | Kind | Meaning |
| --- | --- | --- |
| `invalid-json` | error | a line of a JSON format is no JSON |
| `not-an-object` | error | a JSON value is no object, such as an array or a number |
| `number-out-of-range` | error | a record holds a number beyond the range of doubles |
| `too-deep` | error | a record is nested deeper than 64 levels |
| `not-json` | error | a record holds a value that JSON cannot hold |
| `record-too-large` | error | a line or a CSV record is longer than 1 MiB |
| `logfmt-syntax` | error | a line is no logfmt |
| `logfmt-duplicate-key` | warning | a logfmt key appears twice; the last value wins |
| `csv-header` | error | the CSV header is missing a name or has one twice, so no row can be read |
| `csv-row-width` | error | a CSV row has another number of fields than the header |
| `csv-syntax` | error | a CSV row cannot be read, such as one with a quote that is not closed |
| `mapping-missing` | warning | a record lacks a mapped field |
| `timestamp-naive` | warning | a timestamp has no zone |
| `timestamp-invalid` | warning | a timestamp is no time that jlv reads |
| `timestamp-unit` | warning | a timestamp is text of digits, and no unit was given |
| `timestamp-range` | warning | a timestamp is beyond the range of dates |
| `format-tie` | warning | formats fit an input equally well |
| `probe-failure` | warning | a format's probe failed, so it did not take part in the choice |
| `normalize-failure` | error | a format failed to normalize a record |
| `plugin-output` | error | a format from a plugin returned something that is no valid record or event |

## JSON lines

Each line holds one JSON object; jlv reads UTF-8 with or without a byte order mark, and lines that end in LF or CRLF.
A line holds at most 1 MiB. Records keep `null`, `false`, `0` and empty text as values. A JSON value that is no
object, such as `[1, 2, 3]`, is skipped.

JSON that spans several lines, such as pretty-printed JSON, and a file that holds one JSON array are not JSON lines.
Convert them first, for example with `jq -c '.[]' records.json > records.jsonl`.

## pino

pino writes JSON lines with a numeric `level`, the time in epoch milliseconds in `time` and the message in `msg`:

```console
$ jv --output plain pino.log
2026-10-11T10:00:00.000Z info server listening {"pid":4120,"hostname":"api-1","port":8080}
2026-10-11T10:00:01.250Z warn slow request {"pid":4120,"hostname":"api-1","reqId":"req-7","responseTime":1840}
2026-10-11T10:00:02.500Z error upstream failed {"pid":4120,"hostname":"api-1","reqId":"req-8","err":{"type":"Error","message":"connection refused"}}
2026-10-11T10:00:03.000Z fatal shutting down {"pid":4120,"hostname":"api-1"}
```

pino's options can rename these keys and format the time as text; a [mapping](configuration.md#mapping) and
`--format pino` read such records. Custom level numbers go into [`levels`](configuration.md#levels).

## bunyan

bunyan writes the same level numbers as pino, the time as ISO text in `time` and the message in `msg`. jlv takes a
record for bunyan only with all of `v` 0, `name`, `hostname` and `pid`, so JSON that only looks similar stays pino or
JSON lines.

## Winston

`--format winston` reads the JSON of Winston's `json()` format: `timestamp`, `level` and `message`, with Winston's
level names. Winston's text and colorized formats are no JSON and outside this format.

## logfmt

Each line holds `key=value` pairs, separated by spaces or tabs:

- A value is bare, such as `queue=mail` or `url=/a?b=c`, or quoted, such as `msg="worker started"`, where `\"`,
  `\\`, `\n`, `\r`, `\t` and `\uXXXX` are escapes.
- Values stay text, so `job=17` is `"17"`. A key without `=` is a flag and `true`; `key=` and `key=""` are empty text.
- A key that appears twice keeps its last value, with a warning.
- A quote inside a key or a bare value, text right after a closing quote, a quote that is not closed and `=` without a
  key make the line a diagnostic.

```console
$ jv --output plain worker.log
2026-10-11T10:00:00.000Z info worker started {"queue":"mail"}
2026-10-11T10:00:02.000Z warn retrying job {"job":"17","attempt":"2"}
```

## CSV

The first line is the header, which must name every column once; each following row is a record. A comma separates
the fields unless `csv.delimiter` in the [configuration](configuration.md) chooses another ASCII character, such as
`;` or a tab. Double quotes enclose fields with delimiters, line breaks or quotes, which they write as `""`. Values
stay text. A row with another number of fields than the header is skipped, and a record holds at most 1 MiB.

```console
$ jv --output plain orders.csv
2026-10-11T10:00:00.000Z info order placed {"order":"A-17"}
2026-10-11T10:00:05.000Z error payment declined\ncard expired {"order":"A-17"}
```

## Docker

The json-file logging driver writes each line of a container's output into an envelope with the text in `log`, the
stream in `stream` and Docker's time in `time`; these are the files below `/var/lib/docker/containers`. When the text
is one JSON object, jlv reads it as a bunyan, pino or JSON record, by its own fields, and its time wins over Docker's.
Any other text is the message, and Docker's time is the timestamp. The record's fields keep the envelope below
`docker`, or below `_docker` when the inner record has a field `docker`; the viewer's details and `--output plain`
leave out the fields that the timestamp, level and message columns show, so the text appears once:

```console
$ jv --output plain container.log
2026-10-11T10:00:00.000Z info server listening {"docker":{"stream":"stdout","time":"2026-10-11T10:00:00.000000001Z"}}
2026-10-11T10:00:00.500Z - npm warn config production Use --omit=dev instead. {"docker":{"stream":"stderr"}}
```

The output of `docker logs` has no envelopes; it is the container's own lines, which jlv reads in their own format.

## Formats from plugins

A plugin adds formats. jlv loads one only from the command line, with `--plugin <module>`, which may repeat; a
configuration file cannot load code. The module is a file, relative to the working directory or absolute, or a
package that Node's `require.resolve` finds from the working directory; a package that exports its plugin only for
`import` needs the path of its file. A plugin is trusted code that runs inside jlv, with the rights of the user who
runs it, so load only plugins that you would also run yourself.

A plugin is an ECMAScript or CommonJS module whose default export has `apiVersion: 1` and a list of `formats`. A
format has a unique `identifier`, a `probe` that scores a sample from 0 to 100 without input or output, a `read` that
turns the input's bytes into entries and diagnostics with their line numbers, and a `normalize` that turns an entry
into a record. jlv checks what a plugin returns and reports a mistake as a diagnostic of the plugin's format; a plugin
that cannot be loaded, has another `apiVersion` or reuses an identifier ends the run with exit code 1. The format
becomes a choice of `--format` and takes part in the automatic choice.

[text-plugin.mjs](examples/text-plugin.mjs) reads every line of text as a message:

```console
$ jv --output plain --plugin ./text-plugin.mjs notes.txt
- - backup started
- - backup finished in 42 s
```

A plugin may also export `predicates`: functions that take a record, of any format, and say whether to keep it.
`--predicate <name>` applies one, and the viewer's filter manager offers them all; see
[Filters](configuration.md#filters). The predicate `finished` of the same plugin keeps the records that say so:

```console
$ jv --output plain --plugin ./text-plugin.mjs --predicate finished notes.txt
- - backup finished in 42 s
$ jv --output plain --predicate finished notes.txt; echo $?
jv: --predicate finished names no predicate; the predicates of the plugins of --plugin are none
2
```

In TypeScript, the types come from `jlv` and the built-in formats and readers from `jlv/formats`, such as
`readJsonLines` for a format of JSON lines with its own fields. The exports are ECMAScript modules.
