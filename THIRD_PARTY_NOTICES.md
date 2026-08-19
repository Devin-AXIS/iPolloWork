# Third Party Notices

This file records the third-party license compliance posture for the
iPolloWork repository. It is intended to make the GitHub repository easier to
review and to provide a maintained starting point for release checks.

This repository is source-available under the iPolloWork Source Available
License 1.0. Third-party components remain governed by their own license
terms.

## Current Dependency License Snapshot

Snapshot source: `pnpm licenses list --json --long` from the repository root.

Snapshot date: 2026-08-19.

Snapshot environment: Windows development checkout with installed workspace
dependencies. Release builds should regenerate this snapshot on the relevant
release platform because optional native packages can vary by operating system
and CPU architecture.

| License expression | Package entries |
| --- | ---: |
| MIT | 866 |
| ISC | 68 |
| Apache-2.0 | 38 |
| BSD-3-Clause | 14 |
| BSD-2-Clause | 13 |
| BlueOak-1.0.0 | 10 |
| MPL-2.0 | 3 |
| LGPL-2.1 | 2 |
| Apache-2.0 AND LGPL-3.0-or-later | 2 |
| OFL-1.1 | 2 |
| MIT-0 | 2 |
| GPLv3 | 1 |
| GPL-3.0 | 1 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| (MIT OR WTFPL) | 1 |
| Unlicense | 1 |
| (AFL-2.1 OR BSD-3-Clause) | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| CC0-1.0 | 1 |
| MIT AND Apache-2.0 | 1 |
| (MIT AND Zlib) | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| WTFPL OR ISC | 1 |
| WTFPL | 1 |
| 0BSD | 1 |
| (MIT OR CC0-1.0) | 1 |
| (WTFPL OR MIT) | 1 |

## Items Requiring Maintainer Review

The following dependency license expressions should be reviewed before public
release packaging or redistribution. Listing them here does not grant
additional rights and does not represent legal approval.

| Component | Version | License expression | Source |
| --- | --- | --- | --- |
| `@ffmpeg-installer/ffmpeg` | 1.1.0 | LGPL-2.1 | https://github.com/kribblo/node-ffmpeg-installer |
| `@ffprobe-installer/ffprobe` | 2.1.2 | LGPL-2.1 | https://github.com/SavageCore/node-ffprobe-installer |
| `@ffmpeg-installer/win32-x64` | 4.1.0 | GPLv3 | https://ffmpeg.zeranoe.com/builds/win64/static/ |
| `@ffprobe-installer/win32-x64` | 5.1.0 | GPL-3.0 | https://www.gyan.dev/ffmpeg/builds/ |
| `@img/sharp-win32-arm64` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | https://sharp.pixelplumbing.com |
| `@img/sharp-win32-x64` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later | https://sharp.pixelplumbing.com |
| `jszip` | 3.10.1 | MIT OR GPL-3.0-or-later | https://github.com/Stuk/jszip |

## Regeneration

To refresh the dependency license snapshot:

```bash
pnpm install --frozen-lockfile
pnpm licenses list --json --long
```

For a release, store the generated output or an SPDX/CycloneDX SBOM under the
release artifacts and update this file if the license families or review
items changed.

## Vendored And Template Materials

The repository includes vendored source and bundled templates under paths such
as `vendor/` and `apps/server/bundled-templates/`. Keep their included
`LICENSE` and `NOTICE` files with the relevant source or template, and include
material license changes in release review.
