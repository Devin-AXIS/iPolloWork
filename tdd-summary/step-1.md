# Step 1 - Understand Intent

## Functional Requirements

### FR-1: Additive self-contained plugin package

Extend the existing iPolloWork extension manifest so a versioned plugin can bundle a native OpenCode plugin, skills, MCP servers, commands, agents, services, permissions, compatibility metadata, and update identity. Existing manifests and direct OpenCode plugin specifications remain valid.

### FR-2: Independent multi-method plugin authorization

A plugin can declare no authorization or multiple choices from secret form, OAuth 2.0 with PKCE, device or QR authorization, and plugin-hosted browser authorization. These flows do not use Authorization Center or global environment keys.

### FR-3: Plugin-scoped authorization state

Store credentials and flow state by plugin installation and account, return only redacted status to app clients, prevent cross-plugin addressing through platform APIs, reject callback replay, and delete the records on revocation or uninstall.

### FR-4: Lightweight lifecycle over existing loaders

Install, update, roll back, disable, and uninstall packages by reusing the current extension resource installer and native OpenCode loader. Preserve unrelated workspace files and avoid an OpenCode fork or broad refactor.

### FR-5: Friendly developer and user workflows

Developers can validate and install a local package with actionable diagnostics before publishing. Users see included capabilities, permissions, available authorization choices, connection status, and one clear primary action without editing JSON or environment variables.

## Assumptions

- The existing `iPolloWorkExtensionManifest` remains the user-facing package projection; new package and authorization fields are optional additions rather than a replacement schema.
- "Plugin completely independent" means no dependency on the existing Authorization Center, global credential environment variables, or built-in OSS/model services.
- The platform still owns generic security mechanics: redacted status, encrypted storage, callback state, PKCE generation, expiry, revocation, and UI framing.
- Provider-specific endpoints, scopes, validation, broker behavior, and business services belong to the plugin package or plugin vendor.
- The first implementation uses logical isolation at storage and API boundaries. Hard isolation between malicious native OpenCode plugins would require a separate process sandbox and is intentionally outside the lightweight first release.
- Confidential OAuth client secrets are not embedded in distributable plugins. Such providers use a plugin-hosted broker, while public clients may use direct PKCE.
- Arbitrary third-party React code will not run inside the settings renderer in the first release; authorization UI is generated from declarative method metadata.
- The local repository can implement package contracts, local installation, authorization runtime, and UI. A hosted marketplace backend for developer accounts, review queues, billing, and production upload storage is a later service that will consume the same contract.
