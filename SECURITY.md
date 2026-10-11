# Security policy

jlv reads logs, which often come from systems and people that you do not control, and shows them in your terminal.
This policy describes what jlv protects, how to use it safely and how to report a vulnerability.

## Supported versions

Security fixes go into the latest release of `jlv` 2. jlv 1, the wrapper around json-log-viewer, receives no fixes;
upgrade to jlv 2.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/Defkil/jlv/security/advisories/new)**. If that is not possible, email
the maintainer at **[mail@olivergruettner.de](mailto:mail@olivergruettner.de)**. Do not open a public issue, pull
request or discussion for it.

A useful report contains:

- the version (`jlv --version`), the Node.js version, the operating system and the terminal;
- the command line and the configuration file, if any;
- the smallest log or input that reproduces the problem, and what an attacker gains.

Replace real data, secrets and tokens in logs before you send them. The maintainer reviews reports as time allows,
keeps you informed privately and agrees on the disclosure with you. There is no bug bounty.

Conduct issues are not security reports; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## What jlv protects

- **Log text cannot act on the terminal.** The viewer, plain output and the messages on standard error remove escape
  sequences of logs, file names and configuration values and show other control characters as JSON escapes, so a log
  cannot color, move or clear the terminal, set its title or write its clipboard. Blessed tags in log text show as
  text. JSON lines and saved records keep the original values and escape the control characters that JSON leaves as
  they are.
- **Configuration is data.** `jlv.config.json` and the legacy `.json-log-viewer` cannot load or run code, and names in
  them such as `__proto__` stay plain keys. jlv reads one configuration file per run and never writes one.
- **Files.** `--save` creates a new file and refuses to replace an existing one without `--overwrite` or to write
  into one of its inputs. `--log` creates a new terminal debug log only when the viewer runs, and refuses existing
  files, input aliases and save-file conflicts. Apart from these explicit outputs, jlv writes no files, and nothing
  into the home directory.
- **Bounded resources.** The viewer keeps at most 50,000 records and 64 MiB of them by default, a line or CSV record
  holds at most 1 MiB, and nesting, entries and value lengths in the details are bounded.
- **The package.** Its runtime dependencies have no install scripts and no native code, and it is published from CI
  with npm provenance.

## What is trusted

- **Plugins are code.** `--plugin` loads a module that runs inside jlv with your rights; jlv checks its shape, but it
  is no sandbox. Load only plugins that you would also run yourself. A malicious plugin is not a vulnerability of jlv.
- **Your terminal.** What a terminal does with the characters that jlv leaves, such as emoji or right-to-left text, is
  up to the terminal.
- **Consumers of JSON lines.** `--output jsonl` and `--save` keep the original values of a log, including text that
  looks like markup or commands; programs that read them must treat them as untrusted data.
