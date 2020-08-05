# JLV ![language](https://img.shields.io/badge/language-javascript-blue.svg)
> wrapper around [json-log-viewer](https://github.com/gistia/json-log-viewer) for easy usage

Adds following features to [json-log-viewer](https://github.com/gistia/json-log-viewer):
- copies .json-log-viewer from the current folder or argument to your HOME path
- merge multiple files to see all at once in [json-log-viewer](https://github.com/gistia/json-log-viewer)
- use a custom log transformer (for supporting log libraries with another output then 
[winston](https://github.com/winstonjs/winston) like :evergreen_tree:[pino](https://github.com/pinojs/pino))
- use an existing log [transformer](#wrench-transformers) from npn
- opens [json-log-viewer](https://github.com/gistia/json-log-viewer) in a new terminal (I have not found another way to start a process and pass the input to [json-log-viewer](https://github.com/gistia/json-log-viewer))

## :books: Table of Contents

- [Installation](#package-installation)
- [Usage](#rocket-usage)
- [Transformers](#wrench-transformers)
- [Support](#hammer_and_wrench-support)
- [Contributing](#memo-contributing)
- [License](#scroll-license)

## :package: Installation

install JLV as dev dependency
```sh
npm i jlv -D
```

if you use another log format then [winston](https://github.com/winstonjs/winston), you need to install a
[transformer](#wrench-transformers).

[json-log-viewer](https://github.com/gistia/json-log-viewer) is not up to date on npm. 
You need to install the new version from the git with:
```sh
npm i gistia/json-log-viewer#master
```
## :rocket: Usage
It will open a new a shell with json-view-logger
//todo

## :wrench: Transformers
List of supported transformers. Default is [winston](https://github.com/winstonjs/winston).

log library| JLV transformer| install with
--- | --- | ---
:evergreen_tree:[pino](https://github.com/pinojs/pino) | [jlv-pino](https://github.com/Defkil/jlv-pino) | npm i jlv-pino -D

See [Contributing](#memo-contributing) if you would like to add your own transformers to the list. You can use
[jlv-pino](https://github.com/Defkil/jlv-pino) as example.

## :hammer_and_wrench: Support

Please [open an issue](https://github.com/Defkil/jlv/issues/new) for support.

## :memo: Contributing

Please contribute using [Github Flow](https://guides.github.com/introduction/flow/). Create a branch, add commits, and [open a pull request](https://github.com/Defkil/jlv/compare/).

## :scroll: License

[MIT](https://github.com/Defkil/jlv/blob/master/LICENSE) © [Oliver Grüttner](https://github.com/Defkil/)
