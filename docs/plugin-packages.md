# Plugin packages

For the complete Chinese developer handbook, see [`specs/plugin-developer-guide.zh-CN.md`](../specs/plugin-developer-guide.zh-CN.md).

iPolloWork plugin packages combine portable skills, MCP servers, services, UI contributions, authorization, and optional engine-native capabilities. Engine-specific behavior stays inside `engineBindings`; the package's portable capabilities do not depend on an engine directory layout.

## Local development and cloud distribution

The operations plugins below are maintained in the main iPolloWork source collection and distributed as independent cloud downloads:

| Plugin | Authoritative source | Stable plugin ID |
| --- | --- | --- |
| Xiaohongshu Operations | `examples/plugin-packages/xiaohongshu-ops` | `xiaohongshu-ops` |
| Douyin Operations | `examples/plugin-packages/douyin-ops` | `douyin-ops` |

Their services, skills, UI, platform adapters and plugin-specific tests live beside the other plugin sources. The host still owns the generic installer, authorization, browser, scheduling and workbench integration. Stable plugin IDs and data directories let existing installations keep their accounts, drafts and private data when updating from the cloud marketplace.

The host's generic launcher proof accepts `IPOLLOWORK_EVAL_WORKBENCHES` as a JSON array of `{ pluginId, resourceId, label, requireText, external? }` objects. Run `plugin-workbench-launcher` against an app with those plugins installed. Plugin-specific proof flows live inside each package's `evals/flows` directory.

## Onto complete cloud package

Client 0.50.18 adds explicit per-resource ui.sandbox forms/downloads/modals flags for embedded business apps. Other UI resources keep their existing sandbox unless they opt in; popup and top-navigation permissions remain unavailable.

The authoritative Onto source is examples/plugin-packages/ipollo-onto, imported from upstream commit c209c8b8ebdb36773232632e83a02de52360882f. Version 0.1.6 includes the complete frontend/backend and uses the host's built-in SQLite runtime by default. Its closed dist/package distribution requires no PostgreSQL installation, Node.js or package manager. Electron runs this service in Node mode using its bundled SQLite; Bun hosts use their bundled Bun executable. Optional independent PostgreSQL projects retain the upstream connection path.

Onto's plugin-owned database, documents, encryption key and imported extensions are outside the versioned artifact. The same local workspace service is shared across host projects; conversation binding and MCP project/table scopes remain separate. Build with the package's locked dependencies and run both its domain tests and packaged Bun service test before signing a collection. Preserve the upstream license, attribution and compiled dependency notices.

## Package layout

Every unpacked package starts with `ipollowork.plugin.json`. Resource paths are relative to that directory and may not escape it.

```text
acme-research/
├── ipollowork.plugin.json
├── service/acme-research.ts
├── skills/acme-research/SKILL.md
├── ui/canvas.html
└── engines/opencode/plugins/acme-research.ts
```

See [`examples/plugin-packages/acme-research`](../examples/plugin-packages/acme-research) for a working minimal package. The bundled [`examples/plugin-packages/figma`](../examples/plugin-packages/figma) package is a complete declarative example with an official remote MCP, 12 skills, commands, agents, references, scripts, and assets.

## Manifest

The shared schema-version-2 contract covers built-in extensions and installable packages. Version 2 is the only accepted plugin manifest format.

```json
{
  "schemaVersion": 2,
  "id": "acme-research",
  "name": "Acme Research",
  "description": "Search Acme's research service.",
  "source": {
    "format": "ipollowork-extension-manifest",
    "origin": "local",
    "trusted": false
  },
  "package": {
    "version": "1.0.0",
    "publisher": { "id": "acme", "name": "Acme" },
    "compatibility": { "ipollowork": ">=0.17.0" },
    "engines": ["opencode"],
    "updateId": "acme/research"
  },
  "engineBindings": [{
    "engine": "opencode",
    "compatibility": ">=1.18.0",
    "capabilities": [{
      "id": "acme-runtime",
      "kind": "plugin",
      "path": "engines/opencode/plugins/acme-research.ts",
      "required": true
    }]
  }],
  "permissions": [
    { "id": "network", "reason": "Connect to the Acme research API." }
  ],
  "authorization": {
    "required": true,
    "methods": [
      {
        "id": "api-key",
        "kind": "secret-form",
        "label": "API key",
        "fields": [
          { "id": "apiKey", "label": "API key", "secret": true, "required": true }
        ]
      }
    ]
  },
  "resources": [
    {
      "type": "local-service",
      "id": "acme-service",
      "path": "service/acme-research.ts",
      "requires": ["authorization:api-key"],
      "provides": ["action:connection-status"],
      "actions": [
        {
          "id": "connection-status",
          "title": "Acme connection status",
          "description": "Check this plugin's Acme connection."
        }
      ]
    }
  ]
}
```

### Localized display metadata

Packages can keep their authored display text as the manifest default and add locale-specific UI text without changing runtime identifiers or behavior:

```json
{
  "localization": {
    "defaultLocale": "en",
    "translations": {
      "zh": {
        "name": "Acme 研究",
        "description": "搜索 Acme 的研究服务。",
        "category": "研究",
        "composer": { "prompt": "使用 Acme 研究插件。" },
        "setup": {
          "instructions": "连接 Acme 后继续。",
          "primaryCta": "连接",
          "secondaryCta": "查看帮助"
        },
        "resources": {
          "acme-search": {
            "label": "Acme 搜索",
            "description": "搜索已授权的研究资料。"
          }
        },
        "permissions": {
          "network": { "reason": "连接 Acme 研究 API。" }
        },
        "authorizationMethods": {
          "api-key": {
            "label": "API 密钥",
            "fields": {
              "apiKey": { "label": "API 密钥", "placeholder": "请输入密钥" }
            }
          }
        }
      }
    }
  }
}
```

Locale tags must be valid BCP 47-style tags. Resource, permission, authorization-method, and authorization-field keys must reference IDs declared by the base manifest. iPolloWork resolves the selected locale first, then English, then the manifest default. Localization is display-only: IDs, paths, relationships, credentials, and runtime behavior always come from the base manifest. Because localization is part of the immutable manifest and package checksum, published packages must increment their semantic version when adding or changing translations.

Package versions use semantic versions. A published version is immutable: changing a file without changing the version is rejected. A resource or engine capability `path` may name a regular file or a directory; directories are expanded recursively, while symbolic links and special files are rejected. The installer records a SHA-256 digest for every owned file, preserves unrelated workspace files, and refuses to overwrite files changed outside the package manager.

Omit `package.engines` for a portable package. Set it when the package requires one of the listed engines. Portable skills, agents, commands, MCP definitions, and services stay under `skills/`, `agents/`, `commands/`, `mcp/`, and `service/`. `engineBindings` contains optional native enhancements under `engines/<engine>/` plus their engine-version ranges. The active adapter projects portable capabilities into its own runtime layout; package authors never write engine runtime paths directly.

## Workspace Apps

Interactive plugin UI uses the [MCP Apps protocol](https://github.com/modelcontextprotocol/ext-apps), not a separate iPolloWork message format. A `ui` resource owns one static HTML entry under `ui/`, declares the standard `ui://` URI and `text/html;profile=mcp-app` MIME type, and can be contributed to the right workspace or Settings:

```json
{
  "resources": [{
    "type": "ui",
    "id": "canvas",
    "path": "ui/canvas.html",
    "ui": {
      "uri": "ui://workspace-canvas/canvas",
      "mimeType": "text/html;profile=mcp-app",
      "prefersBorder": false
    }
  }],
  "contributions": [
    { "type": "workspace-app", "ref": "canvas", "label": "Canvas" },
    { "type": "settings-page", "ref": "canvas", "label": "Canvas Settings" },
    {
      "type": "conversation-template",
      "label": "Plan on a canvas",
      "prompt": "Build a visual plan for this task.",
      "mode": "work"
    }
  ]
}
```

The host loads the installed immutable artifact in a script-only sandbox, applies the resource CSP and permission policy, and speaks MCP Apps JSON-RPC over `postMessage`. Standard `ui/message` and `ui/update-model-context` requests connect the surface to the current conversation. A view can expose standard `tools/list` and `tools/call` handlers; iPolloWork publishes those view tools to the active agent as `workspace_app.list_tools` and `workspace_app.call_tool`, so AI and direct manipulation edit the same surface. A view can also call the package's declared local-service actions through standard server `tools/call` requests.

iPolloWork adds only the versioned `ai.ipollo/workspace` host-context field with the current plugin, resource, surface, workspace, root, and session IDs. Apps that ignore this optional field remain standard MCP Apps. Network, frames, camera, microphone, geolocation, and clipboard-write are denied unless the UI resource explicitly declares and the host grants them.

See [`examples/plugin-packages/workspace-canvas`](../examples/plugin-packages/workspace-canvas) for a framework-free example that contributes one editable right-side canvas, one Settings page, one conversation template, and two agent-callable canvas tools. The package is engine-neutral and uses the same install, enable, update, rollback, and uninstall lifecycle as every other capability bundle.

## Authorization methods

A plugin can declare several choices. The settings UI renders all fields itself; third-party React code is not loaded there.

- `secret-form`: API keys and named secrets. Values are encrypted in a plugin-specific vault and never returned to the app after saving.
- `oauth-pkce`: public-client OAuth authorization-code flow with PKCE. Declare `clientId`, `authorizationUrl`, `tokenUrl`, and `scopes`.
- `device-code`: device or QR authorization. Declare the device and token endpoints; set `qr` when the verification value can be rendered as a QR code.
- `hosted-browser`: a vendor-owned browser flow. Declare `startUrl`, matching `callbackOrigin`, and `exchangeUrl`. The redirect returns a one-time code that iPolloWork exchanges server-to-server. Confidential client secrets belong on that hosted service, never in the plugin package.

Authorization uses the global plugin consumer `plugin:<pluginId>` plus canonical connection, account, and method identities; the workspace segment in an HTTP route supplies access context, not a separate authorization copy. The active account for each method is persistent. OAuth and device credentials with a `refreshToken` are refreshed automatically before expiry; a hosted-browser provider can declare `refreshUrl` for the same behavior. Callback state is one-time and expires. Uninstalling a plugin removes its pending flows and selections and deletes credentials that are not shared by another remaining consumer. Engine-native plugins still share an operating-system process with their engine, so this release provides storage/API isolation but does not claim a hard sandbox against malicious native code.

## Component relationships

Resources can declare `requires` and `provides` so installation and runtime readiness do not depend on informal Skill wording:

```json
{
  "type": "skill",
  "id": "research-workflow",
  "requires": ["service:acme-service", "authorization:api-key"],
  "provides": ["workflow:research"]
}
```

Supported relationship forms are `service:<resource-id>`, `resource:<resource-id>`, `authorization:<method-id>`, `action:<action-id>`, and `workflow:<workflow-id>`. Validation rejects missing services, resources, authorization methods, or declared actions. The settings readiness state requires every referenced authorization method to be connected.

## Credential-aware service actions

A package exposes actions through one `local-service` resource. Its `path` is the service module entry point. The default export is a factory that receives a capability already bound to the global plugin identity; the service runtime separately supplies its current workspace context:

```ts
export default async function createService(runtime) {
  return {
    actions: {
      search: async ({ query }) => {
        const credential = await runtime.authorization.getCredential("api-key")
        if (!credential) throw new Error("Connect this plugin first")
        return callVendorApi(query, credential.apiKey)
      },
    },
  }
}
```

The existing `ipollowork_extension_list_actions` and `ipollowork_extension_call` tools discover and invoke these declared actions. The service cannot choose another plugin ID through its authorization capability, and neither the action-list API nor settings API returns raw values. Service modules execute on the local server and should return business results, never credentials.

The service factory is lazy and persistent for one workspace, plugin, and version because service actions may read or write workspace files. Concurrent and later action calls reuse the same instance. Its optional `dispose()` lifecycle runs when the plugin is disabled, updated, rolled back, uninstalled, reauthorized, or revoked. After an app restart, the encrypted global authorization remains and the service is recreated on first use; users do not reconnect or paste a key again.

The package checksum covers the manifest and every owned file declared by resources or engine bindings. First canonicalize the parsed manifest with object keys sorted and `package.checksum` omitted; append `ipollowork.plugin.json`, a NUL byte, the SHA-256 hex of that canonical JSON, and a newline. Then, in relative-path order, append each file's UTF-8 path, a NUL byte, its lowercase SHA-256 hex, and a newline. The declared package checksum is the SHA-256 of those combined bytes.

## Local developer loop

1. Put the unpacked package inside the selected workspace, for example `plugins/acme-research`.
2. Open **Settings → Extensions → Plugin packages → Developer: install a local package**.
3. Enter the workspace-relative directory and choose **Validate**.
4. Review version, resources, permissions, and authorization choices, then install.
5. Change the semantic version before updating. The previous immutable version remains available for rollback.

The same flow is available to a future CLI or developer portal through these server routes:

```text
POST   /workspace/:id/plugin-packages/validate
POST   /workspace/:id/plugin-packages
POST   /workspace/:id/plugin-packages/:pluginId/update
POST   /workspace/:id/plugin-packages/:pluginId/rollback
PATCH  /workspace/:id/plugin-packages/:pluginId
GET    /workspace/:id/plugin-packages/:pluginId/ui/:resourceId
DELETE /workspace/:id/plugin-packages/:pluginId
```

The validate and install requests accept `{ "packageRoot": "plugins/acme-research" }`. Local package roots are restricted to the selected workspace.

Desktop builds can also ship reviewed packages in the built-in catalog. Users install those packages without entering a path:

```text
GET  /workspace/:id/plugin-packages/catalog
POST /workspace/:id/plugin-packages/catalog/:pluginId/install
```

Only server-allowlisted bundle IDs can use these routes. Reviewed bundles are copied into the desktop resources at build time and use the same preview, approval, install, update, rollback and uninstall lifecycle as imported packages.

## Release and catalog contract

The Xiaohongshu and Douyin catalog entries resolve the reviewed package directories under `examples/plugin-packages` during development and under the desktop `plugin-packages` resource directory after packaging. Catalog refresh and installation do not read `~/.ipollowork/local-plugin-packages` and do not fetch source from GitHub. A plugin change must bump its manifest and package versions, pass the package checks, and then be installed or updated through the normal catalog lifecycle. Publishing remains a separate, explicit release action.

A hosted marketplace can use the same validated manifest and immutable artifact. A release record should contain `updateId`, version, publisher identity, artifact URL, SHA-256 checksum, signature/review status, compatibility ranges, release notes, and rollout channel. The desktop must download to a temporary directory, verify identity and checksum, preview the exact writes and permissions, and then call the canonical package lifecycle. This keeps hosted distribution behind one lifecycle and avoids a second installer format.

## Cloud collection and installed plugins

Public uses the existing Cloud extension resource API. Personal lists installed/imported packages only; uninstalled bundled packages are no longer advertised there. New workspaces automatically install only the internal reference-context capability. Existing installations are retained.

Personal has a Check for updates button and checks the cloud directory when opened/refreshed, when focused after a minute, and every five minutes while open and signed in. Update appears only for a strictly newer semantic version of the same manifest ID. Public, Personal, and enterprise downloads share the verified archive parser and host import lifecycle. Updates retain enabled state, resource switches, authorization and user data. Checksum, identity, signature or compatibility failures preserve the installation.

### Development versus production

- `pnpm dev` builds local closed packages, sets `IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR` to this checkout, and prepares local plugins in the existing development profile. Services, UI and Skills all use the same immutable local snapshot. Its version ends in `+dev.<content-hash>`; changing source and restarting dev refreshes it even without a release version bump. Disabled plugins/resources stay disabled; deliberately uninstalled development plugins stay absent. Reinstall one through the development catalog to restore it.
- A headless developer can opt in with both `IPOLLOWORK_DEV_MODE=1` and `IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR=<absolute-source-collection>`. Local code is trusted as developer-owned code only in this explicit environment. Cloud imports cannot overwrite a source-owned development plugin. To test cloud installation, use a production profile or omit the local source directory flag. No source watching or mid-session module reload is promised.
- Packaged desktops remove both development source variables. They ship only internal `reference-context`, do not build/embed business plugins, and return an empty local catalog. Public downloads and Personal updates continue through the existing signature-verified installation lifecycle. Existing installed plugins and data are retained; the source checkout never overrides them.
- Desktop development and production keep their existing separate app/config/data profiles. Changing a source version for development does not mutate the source manifest or a production installed artifact. Restarting uses a new content-addressed snapshot; only the current and previous development snapshots are retained.
- Windows development also resolves the embedded backend and desktop runtime storage through the profile-local `ipollowork-dev-data/xdg/config/ipollowork` directory. Older builds could incorrectly use `%APPDATA%/ipollowork`; those legacy records remain there for production or explicit recovery. They are not automatically copied into a clean development profile. An explicit `IPOLLOWORK_SERVER_CONFIG`/`IPOLLOWORK_RUNTIME_DB` override still takes precedence; use different paths for separate profiles.

### One-command cloud packages

From the repository root:

```powershell
# All twenty public plugins: build closed runtimes, sign and verify.
pnpm plugins:package
# Only the edited plugin:
pnpm plugins:package --plugin ipollo-onto
# Choose a NEW output directory:
pnpm plugins:package --plugin xiaohongshu-ops --out C:/releases/xhs-0.4.20
# Inventory only; never generates unsigned release archives:
pnpm plugins:package --plugin figma --inventory
```

The default output is `.ipollowork-dev/plugin-releases/<timestamp>/`. Each ready release contains individual `.ipollowork-plugin` files, `collection.json`, `SHA256SUMS`, `plugins-collection.zip` and its SHA-256 sidecar. The outer ZIP is for transport; upload the individual plugin files through the existing cloud import. An existing output directory is rejected. `collection.json` is written only after every signed package passes the real archive parser, host signature policy, identity check and original business-file hash comparison. Build/sign/validation failures stop the command and do not produce a ready collection or transport ZIP.

Configure signing once in `~/.ipollowork/plugin-signing/release.json` (outside Git):

```json
{
  "publisher": { "id": "zjy-web222", "name": "zjy-web222" },
  "privateKey": "C:/Users/31939/.ipollowork/plugin-signing/social-plugins-2026.pem",
  "keyId": "social-plugins-2026"
}
```

This machine already has that config pointing at its existing Ed25519 private key. The script does not generate, export or upload the key. Other developers use their own host-trusted publisher/key, or `--config <private-local-release.json>`. Release config explicitly re-signs distribution under that publisher and includes original attribution/licenses while preserving plugin ID, version, update ID and business files. Alternatively `--keyring <private-local-json>` maps each original publisher ID to `{ "privateKey": "<absolute-PEM-path>", "keyId": "<trusted-key-id>" }` and preserves the original publisher.

Before publishing changed code, increment the source manifest's `package.version` and any plugin-owned synchronized version fields as its AGENTS.md requires. The script never silently bumps a version: a released version is immutable and Personal only offers strictly newer versions. Build native plugins on each declared OS/architecture. This command prepares files locally; it never publishes or uploads.

Upload each signed archive through the existing Cloud resource release process. Match `latestArtifact.manifestId` and `version` to its manifest. Cloud SHA-256 is the **archive byte digest** (`artifact.sha256` in collection.json / `archiveSha256` from the single-package signer), not the manifest's package-file checksum. Downloads retain the existing extension type and digest headers.

Shared limits: 32 MiB expanded files, 40 MiB archive, 48 MiB base64 JSON upload, 512 files. Plugin Workshop retains its separate 10 MiB source-editing limit. Native distributions declare `package.compatibility.platforms` with OS and architecture; incompatible targets are rejected before installation. Xiaohongshu includes Sharp and its native dependencies for the build platform, complete UI assets and icon font, and runs with host Bun without a customer pnpm install. Build on each supported target before publishing that target's artifact.

Data annotation is aligned with data-label (0.4.19 features plus distribution fixes, versioned here as 0.4.20). Its LabelU audio/video/interface and Word dependencies come from that branch and retain third-party notices. Onto includes its imported frontend/backend and defaults to host-owned SQLite; no PostgreSQL setup is required (see the Onto section above). Remote integrations require normal service/account authorization; host workflow packages require the corresponding host capabilities.

Verification: `bun evals/support/plugin-collection-verifier.mjs` signs all packages with a temporary test key, round-trips them through the production archive parser and host integrity checks, and verifies that this untrusted test key is rejected for installation. Test archives are deleted; they are not release packages.

The UI journey is `plugin-cloud-lifecycle`: start `bun evals/support/plugin-cloud-fixture.ts`, serve `apps/app` on port 5188, open `/tests/plugin-cloud-proof.html` in a CDP-enabled test browser, then run `pnpm fraimz --flow plugin-cloud-lifecycle`. Use a fresh fixture per run; all state stays in a temporary workspace. It replaces the obsolete bundled-catalog update-loading fixture. The cloud registry is simulated; the host installation and update routes are real.
