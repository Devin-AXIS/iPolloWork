# Independent plugin packages

For the complete Chinese developer handbook, see [`specs/plugin-developer-guide.zh-CN.md`](../specs/plugin-developer-guide.zh-CN.md).

iPolloWork plugin packages add skills, MCP servers, OpenCode plugins, and plugin-owned authorization without changing OpenCode itself. They do not use Authorization Center or the global environment-key store.

## Package layout

Every unpacked package starts with `ipollowork.plugin.json`. Resource paths are relative to that directory and may not escape it.

```text
acme-research/
├── ipollowork.plugin.json
├── service/acme-research.ts
└── .opencode/
    ├── plugins/acme-research.ts
    └── skills/acme-research/SKILL.md
```

See [`examples/plugin-packages/acme-research`](../examples/plugin-packages/acme-research) for a working minimal package.

## Manifest

The package contract extends the existing schema-version-1 extension manifest. Existing manifests remain valid because `package`, `permissions`, and `authorization` are optional.

```json
{
  "schemaVersion": 1,
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
    "compatibility": { "ipollowork": ">=0.17.0", "opencode": ">=1.18.0" },
    "updateId": "acme/research",
    "entrypoints": {
      "opencode": ".opencode/plugins/acme-research.ts",
      "service": "service/acme-research.ts"
    }
  },
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
      "type": "opencode-plugin",
      "id": "acme-runtime",
      "path": ".opencode/plugins/acme-research.ts",
      "required": true
    },
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

Package versions use semantic versions. A published version is immutable: changing a file without changing the version is rejected. The installer records a SHA-256 digest for every owned file, preserves unrelated workspace files, and refuses to overwrite files changed outside the package manager.

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

A package can expose actions through a `local-service` resource and a matching `package.entrypoints.service`. The default export is a factory that receives a capability already bound to the current workspace installation and plugin:

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

The package checksum covers the manifest and every owned resource. First canonicalize the parsed manifest with object keys sorted and `package.checksum` omitted; append `ipollowork.plugin.json`, a NUL byte, the SHA-256 hex of that canonical JSON, and a newline. Then, in relative-path order, append each resource's UTF-8 path, a NUL byte, its lowercase SHA-256 hex, and a newline. The declared package checksum is the SHA-256 of those combined bytes.

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

## Release and catalog contract

A hosted marketplace can use the same validated manifest and immutable artifact. A release record should contain `updateId`, version, publisher identity, artifact URL, SHA-256 checksum, signature/review status, compatibility ranges, release notes, and rollout channel. The desktop must download to a temporary directory, verify identity and checksum, preview the exact writes and permissions, and then call the existing package lifecycle. This keeps hosted distribution additive and avoids a second installer format.
