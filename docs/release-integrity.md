# Release integrity

iPolloWork public releases are produced by GitHub Actions from version tags.
Release managers should use the workflow outputs and the public release page as
the source of truth for signing, notarization, checksums, and verification.

## Coverage evidence

Run coverage locally before a release candidate:

```sh
pnpm coverage
```

The `Coverage` GitHub Actions workflow runs the same command on pull requests
and pushes to `main` and `dev`. It uploads Bun `lcov.info` reports for the app
and server packages and prints the desktop coverage summary from Node's built-in
test runner.

OpenSSF Silver requires at least 80% statement coverage where coverage tooling
is practical. Do not mark the coverage criterion as met until the current
workflow output shows the maintained source scope is at or above that level, or
the OpenSSF form records a narrow, justified N/A for code that cannot be
measured reasonably. Generated files, vendored code, fixtures, and release
artifacts should not be counted as maintained source coverage.

## Signing configuration

macOS release artifacts are signed and notarized by the release workflow when
the repository has these GitHub Actions secrets:

- `APPLE_CODESIGN_CERT_P12_BASE64`
- `APPLE_CODESIGN_CERT_PASSWORD`
- `APPLE_NOTARY_API_KEY_P8_BASE64`
- `APPLE_NOTARY_API_KEY_ID`
- `APPLE_NOTARY_API_ISSUER_ID`

Windows release artifacts are signed through SignPath when the repository has
the SignPath token and project configuration, and `RELEASE_SIGN_WINDOWS` is set
to `true` or the release workflow is dispatched with `sign_windows=true`:

- `SIGNPATH_API_TOKEN`
- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` (optional)

Official public releases should use annotated, signed Git tags. Release
managers can create and verify a signed tag with:

```sh
git tag -s vX.Y.Z -m "iPolloWork vX.Y.Z"
git tag -v vX.Y.Z
git push origin vX.Y.Z
```

## Checksums

The `Release App` workflow downloads the release assets before publishing a
draft release, generates `SHA256SUMS.txt`, uploads it to the GitHub release, and
only then makes the release public.

Users can verify an asset after download:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing
```

Windows users can also verify the Authenticode signature from file properties
or with `Get-AuthenticodeSignature`. macOS users can verify Gatekeeper and
notarization status with `spctl` and `codesign`.
