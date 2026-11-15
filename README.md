# iPolloWork

[English](README.md) | [中文](README.zh.md)

AI workspace built on the official DeepSeek Harness runtime. This repository maintains the iPolloWork plugins, account services, desktop shell and distribution. It does not vendor or modify the DSH Agent runtime.

## Develop

Use Node.js 24.9 or newer and Git. Run `npm run setup:build` from a fresh checkout. Setup downloads the exact official source pinned in [upstream.json](integrations/runtime/upstream.json), verifies its SHA-256, installs the official lockfile, and builds the dependency. Source and generated resolution links are ignored by Git. Run `npm test` and `npm run check:upstream` to check the product/dependency separation.

The [suite](plugins/ipollowork-suite/README.md) installs as a native DSH bundle. Its brand, account, enterprise, marketplace and task features run inside the official client without a separate Agent engine. The [desktop shell](integrations/desktop/README.md) additionally owns OS branding, native sign-in and installers. The [account service](services/ipollowork/README.md) deploys independently.

To package macOS locally, run `npm run package:desktop:mac:arm64 -- --unsigned --dir`. Signing and publication use the existing dedicated workflows and machine settings. Runtime dependencies are included in the resulting application; the full upstream source repository is not.

## Official updates

Change the pinned revision, archive hash and declared release together after reviewing an upstream release. Never track `master` or `latest` implicitly. Setup refuses modified official source. Verify plugin behavior and the packaged application before adopting a newer dependency.

Earlier Git history still contains the former upstream checkout. The current product tree removes it; history has not been rewritten or force-pushed.

The two distribution forms and plugin installation steps are documented in [delivery](integrations/delivery.md).

## License and attribution

Owned iPolloWork code uses the [iPolloWork Source Available License](LICENSE). This is source-available software, not an unrestricted MIT grant. Third-party code and previously granted licenses remain under their original terms; see [third-party notices](THIRD_PARTY_NOTICES.md). Git history and original author attribution are retained when upstream files are removed from the current tree.
