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
| None yet. Upstream PR #13 is next (plan §8 phase 2). | | | |

## Candidates

Plan §3.5 and §7 list the fork commits and upstream items that later phases evaluate,
including the farolanf fixes, the danielannan17 persistent row element and upstream PR #13.
They are not part of the code until a row above names a local commit. PR #20 by Philipp
(wmnnd) is superseded rather than merged; its installability report is acknowledged here.

## License notices

- `LICENSE` and `packages/jlv/LICENSE` carry the full MIT text with two copyright lines:
  the existing "Copyright (c) 2020 Oliver Grüttner" and "Copyright (c) Felipe Coury and
  json-log-viewer contributors". The upstream line has no year because upstream states
  none.
- Gistia is credited as the upstream project, not as a copyright holder.
- `packages/jlv/NOTICE.md` repeats the attribution inside the published package.
- No fork code has been copied yet. Before adopting a fork patch, check its license
  notice and copy any notice into this file and into `packages/jlv/NOTICE.md`.
