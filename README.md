# jlv

> A terminal viewer for JSON logs and other structured logs.

jlv shows log records from files, glob patterns and pipes in an interactive terminal viewer, and writes them as text
or JSON lines when there is no terminal. It reads JSON lines, pino, bunyan, Winston, logfmt, CSV and Docker's
json-file logs, and it continues [json-log-viewer](https://github.com/gistia/json-log-viewer) by Felipe Coury and
contributors.

```sh
npm install --global jlv
jlv app.log
node app.js | jlv
```

**[The jlv package's README](packages/jlv/README.md)** explains installation, usage, the keys, formats, filters,
configuration, plugins, limits and the migration from jlv 1, jlv-pino and json-log-viewer.

## Documentation

- [jlv](packages/jlv/README.md): what jlv does and how to use it.
- [Log formats](docs/formats.md): the formats, their detection, the record, timestamps, levels, correlation
  identifiers, diagnostics and plugins.
- [Configuration](docs/configuration.md): `jlv.config.json`, the legacy `.json-log-viewer`, filters and profiles, and
  the command line.
- [Migrating to jlv 2](docs/migration.md): what changes for users of jlv 1, jlv-pino and json-log-viewer.
- [Changelog](CHANGELOG.md) and [releasing](docs/release.md).

## Repository

This repository is a pnpm workspace. `packages/jlv` is the published package; `packages/format-fixtures` is a private
package with the log fixtures that the tests share. [CONTRIBUTING.md](CONTRIBUTING.md) explains the setup, the checks
and the conventions. [docs/v2-plan.md](docs/v2-plan.md) and the `docs/v2-phase-*-results.md` files record how jlv 2 was
planned and built, and [docs/upstream-provenance.md](docs/upstream-provenance.md) where its code comes from.

Please follow the [code of conduct](CODE_OF_CONDUCT.md), and report vulnerabilities privately as
[SECURITY.md](SECURITY.md) describes.

## License

[MIT](LICENSE) © Oliver Grüttner and Felipe Coury and json-log-viewer contributors. json-log-viewer's history is
imported unchanged under `packages/jlv`; [docs/upstream-provenance.md](docs/upstream-provenance.md) records the sources,
original authors and adopted patches.
