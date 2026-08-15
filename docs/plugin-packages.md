# Independent plugin packages

For the complete Chinese developer handbook, see [`specs/plugin-developer-guide.zh-CN.md`](../specs/plugin-developer-guide.zh-CN.md).

iPolloWork plugin packages combine portable skills, MCP servers, services, UI contributions, authorization, and optional engine-native capabilities. Engine-specific behavior stays inside `engineBindings`; the package's portable capabilities do not depend on an engine directory layout.

## Package layout

Every unpacked package starts with `ipollowork.plugin.json`. Resource paths are relative to that directory and may not escape it.

```text
acme-research/
├── ipollowork.plugin.json
├── service/acme-research.ts
├── skills/acme-research/SKILL.md
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

## Authorization methods

A plugin can declare several choices. The settings UI renders all fields itself; third-party React code is not loaded there.

- `secret-form`: API keys and named secrets. Values are encrypted in a plugin-specific vault and never returned to the app after saving.
- `oauth-pkce`: public-client OAuth authorization-code flow with PKCE. Declare `clientId`, `authorizationUrl`, `tokenUrl`, and `scopes`.
- `device-code`: device or QR authorization. Declare the device and token endpoints; set `qr` when the verification value can be rendered as a QR code.
- `hosted-browser`: a vendor-owned browser flow. Declare `startUrl`, matching `callbackOrigin`, and `exchangeUrl`. The redirect returns a one-time code that iPolloWork exchanges server-to-server. Confidential client secrets belong on that hosted service, never in the plugin package.

Authorization is scoped to the workspace installation, plugin, account, and method. The active account for each method is persistent. OAuth and device credentials with a `refreshToken` are refreshed automatically before expiry; a hosted-browser provider can declare `refreshUrl` for the same behavior. Callback state is one-time and expires. Uninstalling a plugin deletes only that plugin's authorization records. Native OpenCode plugins still share one operating-system process, so this release provides storage/API isolation but does not claim a hard sandbox against another malicious native plugin.

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

A package exposes actions through one `local-service` resource. Its `path` is the service module entry point. The default export is a factory that receives a capability already bound to the current workspace installation and plugin:

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

The service factory is lazy and persistent for one workspace, plugin, and version. Concurrent and later action calls reuse the same instance. Its optional `dispose()` lifecycle runs when the plugin is disabled, updated, rolled back, uninstalled, reauthorized, or revoked. After an app restart, the encrypted authorization remains and the service is recreated on first use; users do not reconnect or paste a key again.

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
DELETE /workspace/:id/plugin-packages/:pluginId
```

The validate and install requests accept `{ "packageRoot": "plugins/acme-research" }`. Local package roots are restricted to the selected workspace.

Desktop builds can also ship reviewed packages in the built-in catalog. Users install those packages without entering a path:

```text
GET  /workspace/:id/plugin-packages/catalog
POST /workspace/:id/plugin-packages/catalog/:pluginId/install
```

Only server-allowlisted bundle IDs can use these routes. The Figma bundle is copied into the desktop resources at build time and uses the same preview, checksum, approval, install, update, rollback, and uninstall lifecycle as a local package.

## Release and catalog contract

A hosted marketplace can use the same validated manifest and immutable artifact. A release record should contain `updateId`, version, publisher identity, artifact URL, SHA-256 checksum, signature/review status, compatibility ranges, release notes, and rollout channel. The desktop must download to a temporary directory, verify identity and checksum, preview the exact writes and permissions, and then call the existing package lifecycle. This keeps hosted distribution additive and avoids a second installer format.
