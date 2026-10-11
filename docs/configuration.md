# Configuration

jlv needs no configuration. A configuration file tells it where to find the parts of a record, how to read numeric
timestamps and levels, which format to use and how many records the viewer keeps. jlv reads one file per run, once,
and never writes one. The examples on this page run in [examples](examples), and the tests run every one of them.

## Which file

- `--config <file>`, or `-c <file>`, reads that file, which must exist.
- Without `--config`, jlv reads the first of these files that exists: `jlv.config.json` in the working directory,
  `.json-log-viewer` in the working directory, `jlv.config.json` in the home directory and `.json-log-viewer` in the
  home directory. It reads only that one; a file in the home directory never adds to a file in the working directory.
- `--no-config` reads none.

A file is JSON when its name ends in `.json` or its text starts with `{`; any other file is the legacy INI form of
`.json-log-viewer`. The viewer's status line names the file that it read. Options on the command line win over the
file: `--format`, `--timestamp-unit`, `--max-records` and `--max-bytes`.

A configuration that jlv cannot use ends the run with exit code 2 before jlv reads a record or opens its screen, and
the message names the file and the place of the problem:

```console
$ jv --output plain -c misspelled.config.json backup.log; echo $?
jv: misspelled.config.json: the configuration has the unknown key "timestampUnits" (did you mean timestampUnit?). Known keys: $schema, version, format, mapping, timestampUnit, levels, csv, maxRecords, maxBytes, profiles
2
```

## jlv.config.json

Monolog writes the time in `datetime`, the level name in `level_name` and levels that jlv does not know.
[monolog.config.json](examples/monolog.config.json) maps them:

```json
{
  "version": 1,
  "mapping": {
    "timestamp": ["datetime"],
    "level": ["level_name"]
  },
  "levels": {
    "NOTICE": "info",
    "ALERT": "fatal",
    "EMERGENCY": "fatal"
  }
}
```

```console
$ jv --output plain monolog.log
- 200 Matched route "heartbeat" {"context":{},"level_name":"INFO","channel":"request","datetime":"2026-10-11T12:00:00.253060+02:00","extra":{}}
- 250 Disk usage at 91% {"context":{"disk":"/var"},"level_name":"NOTICE","channel":"monitor","datetime":"2026-10-11T12:00:05.000000+02:00","extra":{}}
- 550 Database unreachable {"context":{},"level_name":"ALERT","channel":"db","datetime":"2026-10-11T12:00:09.500000+02:00","extra":{}}
$ jv --output plain -c monolog.config.json monolog.log
2026-10-11T10:00:00.253Z info Matched route "heartbeat" {"context":{},"level":200,"channel":"request","extra":{}}
2026-10-11T10:00:05.000Z info Disk usage at 91% {"context":{"disk":"/var"},"level":250,"channel":"monitor","extra":{}}
2026-10-11T10:00:09.500Z fatal Database unreachable {"context":{},"level":550,"channel":"db","extra":{}}
```

These are the keys of version 1; jlv refuses any other key and suggests a known key that is spelled almost alike:

| Key | Value |
| --- | --- |
| `version` | `1`, required |
| `$schema` | text, for editors; jlv only checks that it is text |
| `format` | `auto` or a format's identifier, as for `--format`, also a plugin's |
| `mapping` | where the parts of a record are: `timestamp`, `level`, `message` and `correlationIdentifier`, each a [path](#mapping) |
| `timestampUnit` | the unit of numeric timestamps: `seconds`, `milliseconds`, `microseconds` or `nanoseconds` |
| `levels` | more [level names](#levels) |
| `csv` | `{ "delimiter": ";" }`: the delimiter of CSV, one ASCII character other than a double quote |
| `maxRecords` | the records the viewer keeps, a whole number from 1 to 4294967295; 50000 without it |
| `maxBytes` | the bytes of records the viewer keeps, a whole number from 1 to 4294967295; 67108864 without it |
| `profiles` | named [filters](#profiles) |

### Mapping

A path is a list of keys and array indexes, from the record's top: `["datetime"]`, `["context", "request", "id"]`,
`["tags", 0]`, or `["log.level"]` for a key with a dot in it. A mapped part replaces the format's own fields for that
part, and jlv warns once per input when records lack the mapped field. Paths reach only the record's own fields.

### Levels

`levels` adds levels that jlv does not know and changes how it reads others: each key is a level as the records write
it, a name in any case or a number, and each value is one of `trace`, `debug`, `info`, `warn`, `error`, `fatal` and
`unknown`. `{ "NOTICE": "info", "200": "info" }` reads `"notice"` and the number 200 as `info`. These names win over
the names of the format and the [usual names](formats.md#levels).

### Profiles

A profile is a named filter: `mode` is `all` or `any`, and each of its `clauses` has a `field`, an `operator`,
`equals` or `contains`, and a `value`. The field is a path into the record, such as `["message"]` for a normalized
part or `["fields", "route"]` for an original field. `equals` compares JSON values, and `contains` looks for text:

```json
{
  "version": 1,
  "profiles": {
    "slow checkout": {
      "mode": "all",
      "clauses": [
        { "field": ["fields", "route"], "operator": "equals", "value": "/checkout" },
        { "field": ["message"], "operator": "contains", "value": "slow" }
      ]
    }
  }
}
```

jlv checks profiles already, but does not apply them yet.

## The legacy .json-log-viewer

jlv also reads the INI file of json-log-viewer and jlv 1. Its `[transform]` section maps `timestamp`, `level`,
`message` and `correlationId` by paths in lodash's form, such as `datetime.date`, `tags[0]` or `["log.level"]`. Any
other key names a field for the viewer's details and `--output plain`, which then show only these fields; `$` names
the whole record. [monolog.ini](examples/monolog.ini):

```ini
[transform]
timestamp=datetime
level=level_name
message=message
channel=channel
context=context
```

```console
$ jv --output plain -c monolog.ini monolog.log
2026-10-11T10:00:00.253Z info Matched route "heartbeat" {"channel":"request","context":{}}
2026-10-11T10:00:05.000Z NOTICE Disk usage at 91% {"channel":"monitor","context":{"disk":"/var"}}
2026-10-11T10:00:09.500Z ALERT Database unreachable {"channel":"db","context":{}}
```

The extra keys change only what the viewer shows. The records themselves keep all their fields, so `--output jsonl`,
`--save` and programs that use jlv's types get the complete original record. The INI form has no levels, units or
formats; `jlv.config.json` has them.

## Plugins

Configuration files are data; they cannot load code. Plugins load only from the command line, with
`--plugin <module>`; [formats.md](formats.md#formats-from-plugins) describes them.

## Command line

`jv --help` lists every option:

```console
$ jv --help
usage: jv [options] [file | 'glob' | -]...

Shows log records from files, quoted glob patterns or standard input (-) in a terminal viewer, or writes them as
text or JSON lines when there is no terminal.

options:
  -f, --files <glob>     read the files that a pattern matches; repeatable
  --follow               keep reading files that grow, are truncated or replaced
  --format <format>      auto, docker, bunyan, pino, logfmt, csv, winston or jsonl (default: auto)
  --sort <order>         timestamp, level, message or arrival; a leading - sorts descending, as in
                         --sort=-level (default: -timestamp for files, arrival for pipes and --follow)
  -l, --level <level>    show only records of this level: trace, debug, info, warn, error, fatal or unknown
  --timestamp-unit <u>   seconds, milliseconds, microseconds or nanoseconds for numeric timestamps
  --strict               stop with exit code 1 at the first record that cannot be read
  -c, --config <file>    read this configuration file, JSON or legacy INI, instead of discovering one
  --no-config            read no configuration file
  --plugin <module>      load the formats of a plugin, a file or an installed package; repeatable. A plugin is
                         trusted code that runs inside jlv
  --output <mode>        auto, tui, plain or jsonl (default: auto, the viewer when the terminal allows it)
  --max-records <n>      records the viewer keeps (default: 50000)
  --max-bytes <n>        bytes of records the viewer keeps (default: 67108864)
  -s, --save <file>      also write every record that matches -l as a JSON line to a new file
  --overwrite            let --save replace an existing file
  --log <file>           write the terminal library's debug log
  -h, --help             show this help
  --version              show the version

Without --config, the first of these files configures the run: jlv.config.json and then .json-log-viewer in the
working directory, then both in the home directory. Options on the command line win over the file.

Exit codes: 0 done, 1 an input or the output failed, 2 usage error, 130 interrupted.
```
