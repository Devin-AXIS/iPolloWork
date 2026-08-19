# SBOM Process

## Purpose

An SBOM records the software components included in a build or release. For
iPolloWork, the SBOM should be generated from the locked dependency graph and
stored with release evidence.

## Recommended Formats

Use one of the standard SBOM formats:

- SPDX
- CycloneDX

## Generation

For dependency license review, run:

```bash
pnpm install --frozen-lockfile
pnpm licenses list --json --long
```

For a formal release SBOM, generate an SPDX or CycloneDX artifact from the
same checkout, lockfile, operating system, and architecture used for the
release build. Store the generated artifact with release evidence and update
`THIRD_PARTY_NOTICES.md` when it changes the public notice posture.

## Review

Before publishing release artifacts, review the SBOM for:

- Unknown or missing licenses
- GPL, AGPL, LGPL, MPL, or other review-required licenses
- Native packages that vary by platform
- Vendored source under `vendor/`
- Bundled templates and assets under `apps/server/bundled-templates/`
- Fonts, images, media, datasets, and model files

## Retention

Keep the SBOM or license report for each release together with the release
record. If the artifact is not committed to the repository, attach it to the
release notes or internal release evidence.
