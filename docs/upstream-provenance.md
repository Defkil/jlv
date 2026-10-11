# Upstream provenance

jlv 2 is a fork of [json-log-viewer](https://github.com/gistia/json-log-viewer), the
terminal JSON log viewer by Felipe Coury and contributors, published by Gistia. This
file records where imported and adopted code comes from: the source repository, the
original commit and author, the affected behavior and the local commit. Add a row
whenever a patch from upstream or a fork is adopted.

## Imported histories

Both imports are non-squashed `git subtree add` merges. The original commit objects,
with their SHAs, authors and dates, are ancestors of this repository's history, and each
imported tree was byte-identical to its source tree at import time.

| Source | Pinned commit | Local path | Local import commit | Authors | License |
| --- | --- | --- | --- | --- | --- |
| [gistia/json-log-viewer](https://github.com/gistia/json-log-viewer/tree/b8aa924544ffe484de51460c06cbc4a115ec3928) | `b8aa924544ffe484de51460c06cbc4a115ec3928` (2018-09-23, "package updates (#11)"), tree `17b3ecd4b5f99f31bff6f7ed97c4396850f93c3b` | `packages/jlv` | `2199057` chore(repo): import json-log-viewer history | Felipe Coury (55 commits); Peter W (2 commits, merged by Vinícius Oliveira) | MIT, declared by the manifest's `license` field and the README. The repository has no LICENSE file and states no copyright line or year. |
| [Defkil/jlv-pino](https://github.com/Defkil/jlv-pino/tree/7edcd81b3545cbe0614550e2a9d8335959b707cf) | `7edcd81b3545cbe0614550e2a9d8335959b707cf` (2020-08-12), tree `dcb801aa32253485127be03538b667fd17d69c31` | `packages/jlv-pino`, temporary until its fixtures move to `packages/format-fixtures` and its runtime is retired | `3cde839` chore(repo): import jlv-pino history | Oliver Grüttner (8 commits) | MIT, LICENSE "Copyright (c) 2020 Oliver Grüttner" |

The v1 wrapper history of this repository (`Defkil/jlv`, last v1 commit
`f9d702d8b48c45dd3d251df12fbc5daf796fc764`) continues unchanged; its code stays at the
repository root until it is retired.

## Adopted patches

| Source item | Original commit and author | Affected behavior | Local commit |
| --- | --- | --- | --- |
| [gistia/json-log-viewer PR #13](https://github.com/gistia/json-log-viewer/pull/13), "Fix memory leak / performance degradation" | `e29eb7e7e5542e29e321f7b256b93194d808ac22`, Dima Sabanin, 2018-12-04; applied unchanged with `git am --directory=packages/jlv`, original author and author date kept | `MainPanel.update()` removes the panel's children before it appends the new row element, so renders no longer accumulate row elements. Side effects, recorded by the characterization: the border label with file name and position disappears, each render removes only every second child, and a second resize detaches an open prompt that keeps reading keys. The persistent row widget of plan §8 phase 4 supersedes this cleanup. | `bffe9f4` fix(tui): apply upstream render leak patch |

## Candidates

Plan §3.5 and §7 list the fork commits and upstream items that later phases evaluate,
including the farolanf fixes and the danielannan17 persistent row element. They are not
part of the code until a row above names a local commit. PR #20 by Philipp (wmnnd) is
superseded rather than merged; its installability report is acknowledged here.

## License notices

- `LICENSE` and `packages/jlv/LICENSE` carry the full MIT text with two copyright lines:
  the existing "Copyright (c) 2020 Oliver Grüttner" and "Copyright (c) Felipe Coury and
  json-log-viewer contributors". The upstream line has no year because upstream states
  none.
- Gistia is credited as the upstream project, not as a copyright holder.
- `packages/jlv/NOTICE.md` repeats the attribution inside the published package.
- No fork code has been copied yet. Before adopting a fork patch, check its license
  notice and copy any notice into this file and into `packages/jlv/NOTICE.md`.
