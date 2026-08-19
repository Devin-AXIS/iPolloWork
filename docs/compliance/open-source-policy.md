# Open Source And Source-Available Policy

## Scope

This policy applies to this repository, including application code, packages,
vendored source, bundled templates, build tooling, release artifacts, and
third-party dependencies.

## Project License

iPolloWork is distributed under the iPolloWork Source Available License 1.0.
See `LICENSE` for the controlling terms.

This repository is source-available and is not licensed under an OSI-approved
open source license unless a specific file or component states otherwise.
Separately licensed third-party components remain under their own terms.

## Allowed Dependency Categories

Maintainers may generally use dependencies under permissive licenses such as:

- MIT
- BSD-2-Clause
- BSD-3-Clause
- ISC
- Apache-2.0
- 0BSD
- CC0-1.0 for data or metadata where appropriate

## Review-Required Dependency Categories

Maintainer review is required before adding, updating, bundling, or shipping
dependencies with any of the following:

- GPL, AGPL, LGPL, MPL, EPL, CDDL, SSPL, BUSL, or other copyleft or
  source-available terms
- Custom, unknown, missing, deprecated, or ambiguous license expressions
- Commercial, trial, non-commercial-only, research-only, or field-of-use
  restrictions
- Media, model weights, fonts, datasets, or templates with attribution,
  redistribution, or usage restrictions

## Prohibited Without Written Approval

Do not add or ship code, assets, models, datasets, fonts, or templates when
the license is unknown or when redistribution rights cannot be confirmed.

Do not remove third-party copyright, license, attribution, or NOTICE files.

## Records

Compliance records are maintained in:

- `LICENSE`
- `NOTICE`
- `LICENSES/`
- `THIRD_PARTY_NOTICES.md`
- `docs/compliance/`
- GitHub pull request history and dependency review results
