# Plugin Platform TODO

This checklist implements [the lightweight plugin platform architecture](./plugin-platform-architecture.md) as additive slices. The existing Authorization Center and direct OpenCode plugin loader are outside the change boundary.

## 0. Contract and tests

- [x] Record architecture, requirements, isolation boundary, and acceptance criteria.
- [x] Write one executable scenario for each functional requirement.
- [x] Add failing manifest compatibility and validation tests.
- [x] Add failing authorization isolation, redaction, and lifecycle tests.
- [x] Add failing app projection and simple-connect-flow tests.

## 1. Additive plugin manifest

- [x] Add optional package metadata to the existing extension manifest projection.
- [x] Add declarative permissions and compatibility metadata.
- [x] Add authorization method types for secret form, OAuth PKCE, device/QR, and hosted browser flows.
- [x] Add server-side manifest validation with actionable issue paths and messages.
- [x] Keep every current schema-version-1 extension manifest valid.

## 2. Independent authorization runtime

- [x] Add plugin-installation and account-scoped authorization identifiers.
- [x] Add encrypted-at-rest plugin credential storage outside the environment store.
- [x] Return redacted connection status and field presence only.
- [x] Implement secret-form save and revoke.
- [x] Implement OAuth PKCE start, callback, expiry, and replay protection.
- [x] Implement device/QR start, poll, expiry, and cancellation.
- [x] Implement one-time plugin-hosted browser callback flow.
- [x] Bind local-service execution to the current plugin's authorization capability.
- [x] Persist the active account per method and refresh expiring OAuth/device/hosted credentials automatically.
- [x] Validate declarative `requires`/`provides` relationships and derive a plugin Ready state.
- [x] Reuse one lazy service instance per workspace/plugin/version and dispose it on lifecycle or authorization changes.
- [x] Ensure no plugin route imports or calls Authorization Center.

## 3. Package lifecycle

- [x] Validate and preview a local plugin package before writing files.
- [x] Install package resources through the existing resource paths and loaders.
- [x] Register native OpenCode plugin entry points through the existing plugin configuration store.
- [x] Persist installed package version, source, checksum, permissions, and file ownership.
- [x] Support enable, disable, update, rollback, and uninstall.
- [x] Preserve unrelated workspace files and compatible authorization records during updates.
- [x] Remove owned resources and authorization records during uninstall.

## 4. Developer experience

- [x] Add a local validate endpoint suitable for later CLI reuse.
- [x] Add local development installation from an unpacked package directory.
- [x] Produce concise validation diagnostics with field paths.
- [x] Document the manifest, package layout, authorization methods, runtime service, and release process.
- [x] Add a minimal example plugin covering a native OpenCode entry, a skill, a bound local service, and two authorization choices.

## 5. User experience

- [x] Show package version, publisher/source, permissions, and included resources on extension details.
- [x] Present one primary action: Install, Connect, Open, Update, or Repair.
- [x] Generate authorization forms from the manifest; do not run arbitrary third-party React in settings.
- [x] Show plain-language pending, connected, expired, failed, and revoked states.
- [x] Keep advanced technical details collapsed by default.
- [x] Add Chinese and English copy together.

## 6. Future hosted distribution service (outside the local first implementation)

- [x] Define immutable package artifact and checksum metadata consumed by a future catalog.
- [ ] Add developer upload and release-version API contracts.
- [ ] Add compatibility checks and staged update metadata.
- [ ] Add review status, publisher identity, release notes, and rollback target.
- [ ] Connect the desktop installer to the hosted catalog without changing the local package contract.

## 7. Verification

- [x] Complete RED → GREEN → REFACTOR evidence for every scenario.
- [x] Run server tests, app tests, type checks, and builds affected by the change.
- [x] Run the real install/connect/revoke/uninstall experience and lifecycle update/rollback tests.
- [x] Confirm no raw plugin secret appears in API responses, vault plaintext, plugin exports, or global environment storage.
