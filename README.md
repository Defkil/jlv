# JLV

> A terminal viewer for JSON logs

jlv 2 continues [json-log-viewer](https://github.com/gistia/json-log-viewer) in this repository. It replaces the
jlv 1 wrapper, which merged log files and started json-log-viewer for them. The work is in progress: the viewer
lives in `packages/jlv`, its command stays `jv` until the 2.0 release, and [docs/v2-plan.md](docs/v2-plan.md)
describes the remaining steps.

## Documentation

- [Log formats](docs/formats.md): the formats that jlv reads and how it chooses one, the record, timestamps, levels,
  diagnostics and plugins.
- [Configuration](docs/configuration.md): `jlv.config.json`, the legacy `.json-log-viewer`, filters and profiles, and
  the command line.
- [Migrating to jlv 2](docs/migration.md): what changes for users of jlv 1 and json-log-viewer.

## Development

The repository is a pnpm workspace and needs Node 22.9 or later:

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
```

## :hammer_and_wrench: Support

Please [open an issue](https://github.com/Defkil/jlv/issues/new) for support.

## :memo: Contributing

Please contribute using [Github Flow](https://guides.github.com/introduction/flow/). Create a branch, add commits, and [open a pull request](https://github.com/Defkil/jlv/compare/).

## Credits

jlv 2 is a fork of [json-log-viewer](https://github.com/gistia/json-log-viewer), the terminal JSON log viewer by
Felipe Coury and contributors, published by Gistia under the MIT license. Its history is imported unchanged
under `packages/jlv`. [docs/upstream-provenance.md](docs/upstream-provenance.md) records the sources, original
authors and adopted patches.

## :scroll: License

[MIT](https://github.com/Defkil/jlv/blob/master/LICENSE) © [Oliver Grüttner](https://github.com/Defkil/) and
Felipe Coury and json-log-viewer contributors
