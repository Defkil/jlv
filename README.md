# JLV 
![language](https://img.shields.io/badge/language-javascript-blue.svg)
[![NPM](https://badgen.net/badge/icon/npm?icon=npm&label)](https://www.npmjs.com/package/jlv)
[![Github](https://badgen.net/badge/icon/github?icon=github&label)](https://github.com/Defkil/jlv)
[![Docs](https://badgen.net/badge/docs/online/blue)](https://defkil.github.io/jlv/master/docs/)
[![Build Status](https://travis-ci.org/Defkil/jlv.svg?branch=master)](https://travis-ci.org/Defkil/jlv)
[![Coverage Status](https://coveralls.io/repos/github/Defkil/jlv/badge.svg?branch=master)](https://coveralls.io/github/Defkil/jlv?branch=master)
[![dependencies Status](https://david-dm.org/defkil/jlv/status.svg)](https://david-dm.org/defkil/jlv)

> wrapper around [json-log-viewer](https://github.com/gistia/json-log-viewer) for easy usage

Adds following features to [json-log-viewer](https://github.com/gistia/json-log-viewer):
- copies .json-log-viewer from the current folder or argument to your HOME path
- merge multiple files to see all at once in [json-log-viewer](https://github.com/gistia/json-log-viewer)
- use a custom log transformer (for supporting log libraries with another output then 
[winston](https://github.com/winstonjs/winston) like :evergreen_tree:[pino](https://github.com/pinojs/pino))
- use an existing log [transformer](#wrench-transformers) from npm
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
npm i jlv -g
```

if you use another log format then [winston](https://github.com/winstonjs/winston), you need to install a
[transformer](#wrench-transformers).

[json-log-viewer](https://github.com/gistia/json-log-viewer) is not up to date on npm. 
You need to install the new version from the git with:
```sh
npm i gistia/json-log-viewer#master
```
## :rocket: Usage
argument| short| description
--- | --- | ---
--param \<param>|-p \<param>|json-log-viewer parameter
--files \<glob>|-f \<glob>|log files to view as glob
--config \<path>|-c \<path>|path to .json-log-viewer config file
--reset|-r|reset .json-log-viewer in HOME folder
--transformer \<name>|-t \<name>|load transformer from a npm module
--transformer-js \<path>|-tjs \<path>|load transformer from a javascript file
--open|-o|open json-log-viewer in a new shell
--save \<path>|-s \<path>|save merged log file to path
--backup \<path>|-b \<path>|backup .json-log-viewer to given path

Example
```sh
jlv -f ./example/**.log -o
```
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
