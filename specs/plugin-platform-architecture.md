# Specification: Lightweight Independent Plugin Platform

## Metadata
- **Version**: 0.2.0
- **Status**: Implemented (local platform)
- **Author**: Codex
- **Created**: 2026-07-21
- **Last Updated**: 2026-07-21

## Overview

iPolloWork will add a lightweight plugin platform on top of its existing extension manifests, Cloud plugin installer, and native OpenCode plugin loader. A plugin is a self-contained product package that may include an OpenCode plugin, skills, MCP servers, commands, agents, local services, and its own authorization methods.

Plugin authorization is independent from iPolloWork Authorization Center and from user-level environment variables. The platform provides a small authorization runtime for safe user interaction, plugin-scoped storage, callback handling, and connection state. Each plugin owns its providers, authorization choices, endpoints, scopes, validation behavior, and business service.

The first implementation is additive. Existing built-in extensions, imported Cloud plugins, manually configured OpenCode plugins, and Authorization Center behavior continue unchanged.

## Architecture

The platform has five narrow layers:

1. **Manifest projection**: extend the existing iPolloWork extension manifest with optional package, permission, and authorization declarations. Existing manifests remain valid.
2. **Package lifecycle**: validate, install, enable, disable, update, roll back, and uninstall a versioned plugin package. Installation continues to reuse the existing resource installer and OpenCode plugin configuration.
3. **Plugin authorization runtime**: expose standard flows for secret forms, OAuth 2.0 with PKCE, device or QR authorization, and plugin-hosted browser authorization. It stores state under the plugin installation identity and never writes plugin credentials to the global environment store.
4. **Runtime bridge**: declared local-service actions are discovered by the existing OpenCode extension tools and receive an authorization capability bound to their own workspace installation and plugin identity. A lazy service manager reuses one instance per workspace/plugin/version, disposes it on lifecycle changes, persists the selected account, and refreshes expiring tokens before use. Native OpenCode loading remains owned by OpenCode; iPolloWork does not fork or replace that loader.
5. **User and developer surfaces**: users see one install-and-connect flow; developers get manifest validation, local installation, diagnostics, version metadata, and a stable publishing contract.

Authorization Center remains a separate product surface. The plugin platform does not import its service catalog, reuse its global keys, or route plugin setup through it.

### Authorization ownership

The plugin declares which methods it supports and may offer more than one method. The platform renders the safe shell and controls state transitions; the plugin owns provider-specific behavior.

- **Secret form**: API keys or other named values defined by the plugin.
- **OAuth 2.0 with PKCE**: public-client browser redirect using plugin-declared endpoints and scopes.
- **Device or QR flow**: plugin-declared device endpoints, user code, verification URL, and optional QR value.
- **Plugin-hosted browser flow**: a plugin vendor hosts the specialized authorization experience and returns through a one-time callback contract.

Confidential OAuth clients require a plugin-hosted broker; client secrets must not ship in a desktop plugin package. Arbitrary plugin UI does not execute in the settings renderer in the first version.

### Isolation boundary

Plugin credentials are isolated by installation ID and account ID in storage and APIs. Raw values are not returned to ordinary app clients after submission. No plugin authorization value is persisted in the user-level environment store.

Native OpenCode plugins currently share an OpenCode process. Therefore the lightweight first version provides storage and API isolation, signed-package trust signals, and explicit permissions, but does not claim hard protection from another malicious native plugin running as the same operating-system user. Hard process isolation is a future optional runtime and is not required for the first release.

### Delivery slices

1. **Foundation**: additive manifest contract, validation, redacted authorization state, encrypted plugin-scoped storage, and server API.
2. **Local developer loop**: validate and install a local package, exercise authorization methods with test adapters, and show diagnostics.
3. **User flow**: extension detail shows included resources, permissions, authorization choices, connection status, and one primary action.
4. **Distribution**: package upload, immutable versions, signatures or checksums, compatibility declarations, staged updates, and rollback.

## Requirements

### Functional Requirements

- FR-1: A self-contained plugin package must extend the existing iPolloWork extension manifest without invalidating current manifests. It must describe its version, compatible iPolloWork/OpenCode versions, resources, permissions, entry points, and update identity.
- FR-2: A plugin may declare zero, one, or multiple independent authorization methods, including secret form, OAuth 2.0 with PKCE, device or QR flow, and plugin-hosted browser flow. Authorization Center and global environment keys must not be dependencies of these methods.
- FR-3: Authorization records and in-progress flows must be scoped by plugin installation and account. App-facing status responses must be redacted, revocation must remove stored credentials, and one plugin must not address another plugin's records through the platform API.
- FR-4: Plugin lifecycle operations must reuse the existing extension resource model and native OpenCode plugin loader. Install, update, rollback, disable, and uninstall must preserve unrelated workspace files and must not require an OpenCode fork.
- FR-5: Developers must be able to validate and locally install a package before publishing. Users must be able to inspect included skills, MCP servers, services, permissions, and authorization choices, then install and connect without editing JSON or environment variables.

### Non-functional Requirements

- NFR-1: Changes must be additive and localized. Existing Authorization Center routes, UI, storage, and service definitions must remain untouched.
- NFR-2: Existing extension manifests and existing OpenCode plugin specifications must remain valid without migration.
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
5. Attempt to read or revoke that record through a different plugin installation ID and confirm the operation is denied or reports no record.
6. Start OAuth PKCE, device-code, and plugin-hosted browser test flows; verify pending, connected, failed, expired, and revoked states.
7. Replay an OAuth or plugin-hosted callback and confirm it is rejected.
8. Install a local test package and confirm its native OpenCode plugin and bundled resources appear through the existing loaders.
9. Update the package and confirm authorization is preserved when the authorization schema is compatible; confirm rollback restores the previous package version.
10. Uninstall the package and confirm its installed resources and plugin-scoped authorization records are removed without changing unrelated files.
11. Run existing server and app tests to confirm Authorization Center, Cloud plugin imports, and direct OpenCode plugin management are unchanged.
12. Manually verify that a non-technical user can install, choose an authorization method, connect, inspect included capabilities, and revoke access without editing environment variables.

## Acceptance Criteria

- Current extension manifests and OpenCode plugin configuration continue to work unchanged.
- A package can bundle native OpenCode code and existing extension resources under one versioned manifest.
- At least secret-form, OAuth PKCE, device or QR, and plugin-hosted browser authorization are represented by the stable contract.
- Plugin authorization data is not stored in or injected into the global environment store.
- App-facing APIs never return a stored raw secret after submission.
- Plugin installation, update, rollback, and uninstall operate through existing resource and OpenCode loader seams.
- The settings experience exposes one clear install/connect path and shows included resources and permissions.
- Developer validation reports manifest and authorization errors before installation or upload.
- Automated tests cover manifest compatibility, authorization isolation and redaction, flow state transitions, lifecycle behavior, and regressions.

## Change Log

| Date       | Version | Description       | Author     |
|------------|---------|-------------------|------------|
| 2026-07-21 | 0.1.0   | Initial draft     | Codex      |
| 2026-07-21 | 0.2.0   | Local package, authorization, runtime bridge, lifecycle, and UI implemented | Codex |
