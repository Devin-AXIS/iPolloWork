# License Compliance Process

## Purpose

This process describes how maintainers identify, review, document, and
preserve license information for iPolloWork.

## Responsibilities

Maintainers are responsible for checking license information before adding or
shipping third-party material. When a license is unclear or review-required,
maintainers should escalate the dependency to the repository owner or the
appropriate business/legal reviewer before release.

## Pull Request Review

For every pull request that adds or updates dependencies, vendored code,
templates, generated assets, model files, fonts, or datasets:

1. Identify the new or changed third-party material.
2. Confirm the license and source URL.
3. Check whether the license is allowed or review-required under
   `docs/compliance/open-source-policy.md`.
4. Keep upstream `LICENSE`, `NOTICE`, attribution, and copyright files.
5. Update `THIRD_PARTY_NOTICES.md` when the dependency materially changes the
   license profile or release notices.
6. Record any review decision in the pull request.

## Release Review

Before publishing release artifacts:

1. Install dependencies from the lockfile.
2. Generate the dependency license report:

   ```bash
   pnpm licenses list --json --long
   ```

3. Generate or refresh an SBOM as described in `docs/compliance/sbom.md`.
4. Compare the new report with `THIRD_PARTY_NOTICES.md`.
5. Review GPL, AGPL, LGPL, MPL, unknown, custom, and commercial license
   expressions before redistribution.
6. Confirm that vendored and bundled materials still carry their upstream
   license and notice files.
7. Attach the relevant license report, SBOM, or review evidence to the release
   record when applicable.

## Exception Handling

If a dependency cannot be approved:

1. Remove or replace the dependency.
2. Disable the affected release artifact until review is complete.
3. Document the decision in the pull request or release record.

## Evidence

Evidence for this process includes:

- Pull request dependency review results
- `pnpm licenses list --json --long` output
- SBOM artifacts
- `THIRD_PARTY_NOTICES.md`
- Maintainer comments approving review-required dependencies
