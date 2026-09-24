# macOS release packaging

Use this path when building a Mac package that will be sent to other people.
Do not share locally unsigned DMG/ZIP artifacts; macOS Gatekeeper can show them
as damaged even when the archive itself is valid.

## Required Apple assets

- Apple Developer Program membership.
- A Developer ID Application certificate exported as `.p12`, or installed in the
  local macOS keychain.
- An App Store Connect API key with notarization access.

## Local build

If the Developer ID certificate is already installed in Keychain:

```sh
export APPLE_API_KEY="YOUR_NOTARY_KEY_ID"
export APPLE_API_ISSUER="YOUR_NOTARY_ISSUER_ID"
export APPLE_API_KEY_PATH="/absolute/path/AuthKey_XXXXXX.p8"

pnpm --dir apps/desktop run package:mac:release
```

If using a `.p12` certificate directly:

```sh
export CSC_LINK="$(base64 -i /absolute/path/developer-id-application.p12)"
export CSC_KEY_PASSWORD="YOUR_P12_PASSWORD"
export APPLE_API_KEY="YOUR_NOTARY_KEY_ID"
export APPLE_API_ISSUER="YOUR_NOTARY_ISSUER_ID"
export APPLE_API_KEY_PATH="/absolute/path/AuthKey_XXXXXX.p8"

pnpm --dir apps/desktop run package:mac:release
```

The script builds Electron, signs with Developer ID, submits to Apple Notary,
staples the result, and verifies the final app with `codesign`, `stapler`, and
`spctl`.

## GitHub Actions secrets

For CI releases, configure these repository secrets:

- `APPLE_CODESIGN_CERT_P12_BASE64`
- `APPLE_CODESIGN_CERT_PASSWORD`
- `APPLE_NOTARY_API_KEY_P8_BASE64`
- `APPLE_NOTARY_API_KEY_ID`
- `APPLE_NOTARY_API_ISSUER_ID`

The existing macOS release workflows use these secrets for signed and notarized
Electron artifacts.

## data-label branch distribution

This branch uses its own checked-out scripts, locked dependencies, annotation
plugin, and resources. Run the annotation plugin's `pnpm check` before the
macOS release command above. Output is `apps/desktop/dist-electron-data-label`.
Installer and optional engine assets start with `ipollowork-data-label-`.

Publish the exact build commit as `data-label-v<desktop-version>` and create a
GitHub prerelease with `--latest=false`. Upload the matching engine archive,
checksum, and `data-label-mac.yml` alongside the signed DMG/ZIP. The updater
feed is pinned to this branch release; engine downloads never fall back to the
stable Latest release. Future branch upgrades are manual installations.
Do not run the stable `v*` tag workflow, publish stable updater manifests, or
replace assets belonging to another release.
