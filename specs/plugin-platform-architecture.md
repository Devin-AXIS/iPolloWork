# Specification: Lightweight Independent Plugin Platform

## Metadata
- **Version**: 1.0.0
- **Status**: Implemented (local platform)
- **Author**: Codex
- **Created**: 2026-07-21
- **Last Updated**: 2026-08-20

## Overview

iPolloWork has one lightweight, engine-neutral plugin-package platform. A plugin is a self-contained product package that may include portable skills, MCP servers, commands, agents, local services, UI contributions, authorization methods, and optional engine-native bindings.

Plugin authorization is independent from iPolloWork Authorization Center and from user-level environment variables. The platform provides a small authorization runtime for safe user interaction, plugin-scoped consumers, callback handling, and connection state. Each plugin owns its providers, authorization choices, endpoints, scopes, validation behavior, and business service.

There is no parallel plugin installer. File archives, reviewed built-in catalog entries, Cloud marketplace releases, and compatible GitHub repositories are source adapters that normalize into the same schema-version-2 package before validation and installation. Direct OpenCode-plugin management and the former Cloud-plugin import lifecycle are removed. Built-in product capabilities and user-authored standalone Skill or MCP configuration remain separate capabilities, not alternate package state.

## Architecture

The platform has six narrow layers:

1. **Canonical manifest**: schema version 2 describes package identity, resources, permissions, authorization, compatibility, and optional engine bindings.
2. **Source adapters**: archive, catalog, Cloud, and compatible GitHub inputs produce the canonical package format; they do not own installation state.
3. **Global package lifecycle**: one application-level inventory validates, installs, enables, disables, updates, rolls back, and uninstalls immutable package versions.
4. **Engine projection adapters**: OpenCode and DeepSeek Harness adapters project the same global package into every compatible local workspace. Portable resources remain portable; engine-native code runs only where the manifest declares a matching binding.
5. **Plugin authorization and service runtime**: authorization is keyed by global plugin identity, account, connection, and method. Local-service actions receive a capability bound to their plugin identity while service instances and working data remain workspace-aware where file access requires it.
6. **User and developer surfaces**: users see one global install-and-connect flow; developers get manifest validation, diagnostics, version metadata, and a stable publishing contract.

Authorization Center remains a separate product surface. The plugin platform does not import its service catalog, reuse its global keys, or route plugin setup through it.

### Authorization ownership

The plugin declares which methods it supports and may offer more than one method. The platform renders the safe shell and controls state transitions; the plugin owns provider-specific behavior.

- **Secret form**: API keys or other named values defined by the plugin.
- **OAuth 2.0 with PKCE**: public-client browser redirect using plugin-declared endpoints and scopes.
- **Device or QR flow**: plugin-declared device endpoints, user code, verification URL, and optional QR value.
- **Plugin-hosted browser flow**: a plugin vendor hosts the specialized authorization experience and returns through a one-time callback contract.

Confidential OAuth clients require a plugin-hosted broker; client secrets must not ship in a desktop plugin package. Arbitrary plugin UI does not execute in the settings renderer in the first version.

### Isolation boundary

Plugin credentials are isolated by canonical connection, account, and method, while active-account selection and pending flows are bound to `plugin:<pluginId>`. Raw values are not returned to ordinary app clients after submission. No plugin authorization value is persisted in the user-level environment store. Uninstall removes that plugin consumer and credentials that are not shared by another remaining consumer.

Engine-native code currently shares its engine process. Therefore the platform provides storage and API isolation, signed-package trust signals, and explicit permissions, but does not claim hard protection from malicious native code running as the same operating-system user. Hard process isolation is a future optional runtime.

### Delivery slices

1. **Foundation**: canonical manifest contract, validation, redacted authorization state, encrypted plugin-scoped storage, and server API.
2. **Local developer loop**: validate and install a local package, exercise authorization methods with test adapters, and show diagnostics.
3. **User flow**: extension detail shows included resources, permissions, authorization choices, connection status, and one primary action.
4. **Distribution**: package upload, immutable versions, signatures or checksums, compatibility declarations, staged updates, and rollback.

## Requirements

### Functional Requirements

- FR-1: A self-contained plugin package must extend the existing iPolloWork extension manifest without invalidating current manifests. It must describe its version, compatible iPolloWork/OpenCode versions, resources, permissions, entry points, and update identity.
- FR-2: A plugin may declare zero, one, or multiple independent authorization methods, including secret form, OAuth 2.0 with PKCE, device or QR flow, and plugin-hosted browser flow. Authorization Center and global environment keys must not be dependencies of these methods.
- FR-3: Authorization consumers and in-progress flows must be scoped by global plugin identity and account. App-facing status responses must be redacted, revocation must remove stored credentials, and one plugin must not address another plugin's records through the platform API.
- FR-4: Plugin lifecycle operations must use the global inventory and registered engine adapters. Install, update, rollback, disable, and uninstall must update every compatible local workspace atomically, preserve unrelated files, and must not require an engine fork.
- FR-5: Developers must be able to validate and locally install a package before publishing. Users must be able to inspect included skills, MCP servers, services, permissions, and authorization choices, then install and connect without editing JSON or environment variables.

### Non-functional Requirements

- NFR-1: Plugin installation state must have one owner. Source adapters and engine adapters must not create parallel inventories or lifecycle APIs.
- NFR-2: Schema version 2 is the only accepted package manifest. Obsolete plugin lifecycle state and migration routes are intentionally unsupported.
- NFR-3: Secret values must be encrypted at rest outside explicit development-only modes, omitted from logs and API responses, and protected against callback replay.
- NFR-4: The default UI must optimize for non-technical users: one primary action, plain-language status, and advanced details collapsed by default.
- NFR-5: The package contract must be declarative and versioned, with actionable validation errors suitable for a future CLI and developer portal.
- NFR-6: The first release must not add a permanently running service solely for secret-form authorization.
- NFR-7: Third-party executable packages must expose source, version, checksum or signature status, and requested permissions before installation.

## Test Steps

1. Validate an existing built-in extension manifest and confirm it remains accepted without package or authorization fields.
2. Validate a self-contained plugin manifest containing OpenCode, skill, and MCP resources plus two authorization methods.
3. Reject duplicate authorization method IDs, unsupported method kinds, invalid callback origins, and malformed compatibility ranges with actionable errors.
4. Save a secret-form authorization for one plugin and confirm list/status APIs return only redacted metadata.
5. Attempt to read or revoke that record through a different plugin ID and confirm the operation is denied or reports no record.
6. Start OAuth PKCE, device-code, and plugin-hosted browser test flows; verify pending, connected, failed, expired, and revoked states.
7. Replay an OAuth or plugin-hosted callback and confirm it is rejected.
8. Install a local test package and confirm its portable resources are projected into OpenCode and DeepSeek Harness workspaces while engine-native bindings appear only in compatible engines.
9. Update the package and confirm authorization is preserved when the authorization schema is compatible; confirm rollback restores the previous package version.
10. Uninstall the package and confirm its projections, artifacts, service data, pending flows, selections, and unshared credentials are removed from every registered workspace without changing unrelated files.
11. Confirm the old direct plugin routes, Cloud-plugin lifecycle, and runtime migration endpoint are absent.
12. Manually verify that a non-technical user can install, choose an authorization method, connect, inspect included capabilities, and revoke access without editing environment variables.

## Acceptance Criteria

- One global inventory is shared by all projects and engines.
- A package can bundle portable resources and optional engine-native code under one versioned manifest.
- At least secret-form, OAuth PKCE, device or QR, and plugin-hosted browser authorization are represented by the stable contract.
- Plugin authorization data is not stored in or injected into the global environment store.
- App-facing APIs never return a stored raw secret after submission.
- Plugin installation, update, rollback, and uninstall operate through one lifecycle and registered engine adapters.
- The settings experience exposes one clear install/connect path and shows included resources and permissions.
- Developer validation reports manifest and authorization errors before installation or upload.
- Automated tests cover manifest compatibility, authorization isolation and redaction, flow state transitions, lifecycle behavior, and regressions.

## Change Log

| Date       | Version | Description       | Author     |
|------------|---------|-------------------|------------|
| 2026-07-21 | 0.1.0   | Initial draft     | Codex      |
| 2026-07-21 | 0.2.0   | Local package, authorization, runtime bridge, lifecycle, and UI implemented | Codex |
| 2026-08-20 | 1.0.0   | Unified global lifecycle, source adapters, OpenCode/DeepSeek Harness projection, and removal of parallel legacy paths | Codex |
