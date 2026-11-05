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

## Installer-only releases and in-app updates

Desktop releases upload exactly six installers: Windows EXE, macOS DMG, and
Linux AppImage, each for x64 and arm64. GitHub also generates its two source
archives; these are not uploaded assets and cannot be removed individually.
Engine/media archives remain in the signed cloud resource service. ZIPs,
blockmaps, YAML feeds and checksum text files are not release attachments.
GitHub's asset API exposes a SHA-256 digest for every installer. The final
publication gate checks all six names, nonzero sizes, uploaded state and digests
before removing old non-installer attachments.

In-app checking, downloading and installation still use electron-updater.
Its custom provider reads the official GitHub release over HTTPS and consumes
a versioned hidden JSON block in the release description. Windows and Linux
updates download the published installer. Mac updates require a ZIP; both Mac
ZIPs are uploaded to cloud storage under SHA-512-prefixed immutable names.
Every payload is verified against the SHA-512 in the HTTPS release metadata
before electron-updater installs it. The provider rejects mismatched versions,
platforms, missing hashes and URLs outside the exact official artifact paths.
Only the two Mac update ZIPs use this storage; optional engines retain their
existing signed cloud download protocol.

The storage owner is /srv/ipollowork-desktop-updates/releases, served by nginx
at http://i.ipollo.ai/desktop-updates/. GitHub Actions uses the dedicated
DESKTOP_UPDATE_SSH_KEY secret and the existing pinned SSH host variables.
The ipollo-update-publisher account is chrooted to
/srv/ipollowork-desktop-updates with ForceCommand internal-sftp, no shell,
forwarding, password login or TTY. Its root-owned authorized key file lives in
/etc/ssh/authorized_keys/ipollo-update-publisher (public-readable mode 644).
Build receipts are temporary Actions artifacts, not release downloads.
The release body must retain its ipollowork-desktop-update:v1 HTML comment;
editing it away makes the updater fail closed.

Clients built before this migration still request the deleted YAML feeds.
They need one manual installation of the rebuilt desktop; subsequent releases
continue to support in-app updates. Do not describe old clients as automatically
migrated. The resource-only recovery inputs were removed because they depended
on engine archives being attached to the GitHub release.

Windows users can also verify the Authenticode signature from file properties
or with `Get-AuthenticodeSignature`. macOS users can verify Gatekeeper and
notarization status with `spctl` and `codesign`.
