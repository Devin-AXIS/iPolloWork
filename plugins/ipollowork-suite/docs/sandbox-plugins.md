# Alibaba Sandbox plugin

The iPolloWork bundle ships the optional execution-tool Cordis plugin `@ipollo/dsh-suite/aliyun-sandbox`. It reuses the earlier Alibaba Agent Sandbox adapter and its execution lifecycle. DSH owns all Agent execution, tool dispatch and Session recording. This module does not launch a second Agent or modify official DSH source. OpenSandbox is deferred and is not exported, installed as an SDK dependency, or included in this package's output.

The component is disabled in `cordis.patch.yml`. Installing iPolloWork does not make a sandbox request. Configure it in an isolated cloud Agent preset, or enable it on a dedicated cloud Host. Local projects keep their existing native tools and configuration. The plugin follows DSH's read-only policy and refuses sandbox operations in that mode. Its cloud filesystem does not enforce DSH's local `workspace-write` path restrictions: isolation is provided by the remote sandbox and authorized mount.

## Operator configuration

Use the official `dsh` profile launcher and a profile overlay. Set the key in the Host environment; never put keys in the overlay, model arguments or browser storage. End users do not fill these fields.

```yaml
- id: ipollowork-aliyun-sandbox
  disabled: false
  config:
    apiUrl: https://api.cn-hangzhou.sandbox.aliyuncs.com
    domain: cn-hangzhou.sandbox.aliyuncs.com
    apiKeyEnv: ALIYUN_SANDBOX_API_KEY
    template: code-interpreter-v1
    releaseAfterTurn: true
```

Use the actual endpoint and template from the Alibaba account. E2B is pinned to 2.31.0, the version tested by the original adapter. The plugin exposes `sandbox_exec`, `sandbox_read_file`, `sandbox_write_file` and `sandbox_release`, with native terminal/file cards and persisted DSH tool results.

Optional settings are `sandboxTtlSeconds` (1800), `requestTimeoutSeconds` (30), `commandTimeoutSeconds` (120), `maxOutputBytes` (32768), `maxFileBytes` (1048576), `maxSandboxes` (10), and `releaseAfterTurn` (false). These are operator settings. No sandbox is allocated before the first tool call. Failed or cancelled operations release their environment; failed release prevents reuse. Unloading releases owned environments and drains accepted operations. Provider TTL remains the fallback if a remote release cannot be confirmed.

## Persistent projects and remote clients

Without a project binding, files are temporary; `releaseAfterTurn: true` deletes those files after the turn. Persistent mode requires `project: { serviceUrl, projectId, tokenEnv }` and `storage: { bucket, endpoint, roleArn }`. The account service must authorize `GET /api/v1/projects/:id/runtime` for every operation and return the existing project-volume response. The adapter maps its authorized identity to `/ipollowork/<volume-identity>/` in OSS and mounts it at `/mnt/project`. A denied or invalid response fails closed and releases a retained environment. Tokens remain in Host environment variables.

The template must provide `mountpoint`. Mount failure stops execution and releases the sandbox. The RAM role must permit only the intended storage access. Validate real RAM permissions and storage behavior before production use; a mount configuration alone does not establish tenant isolation.

The account service now supports project-volume authorization and cloud-project launch. The optional cloud-project component starts the full official DSH profile inside Alibaba Sandbox, so the ordinary DSH terminal and filesystem operate in the cloud. It does not route local native tools through the `sandbox_*` tool adapter. See [cloud projects](cloud-projects.md) for configuration, ownership, verification and current limitations. The legacy SQLite service and local child-process launcher remain excluded.

## Verification

`npm run check` builds the plugin entry, typechecks the suite and runs local tests. They exercise the real E2B SDK against a local HTTP fixture, official DSH Agent-loop tool calls, permission rejection, project authorization and cleanup. `tests/expected/sandbox-tools.schemas.json` records the model tool schema. These checks do not create paid cloud resources or establish real Alibaba/OSS availability. No sibling `file:` dependency or upstream DSH implementation is included.

- [Alibaba SDK integration](https://www.alibabacloud.com/help/en/functioncompute/using-the-cloud-sandbox-via-the-sdk)
- [Alibaba dynamic OSS mounts](https://www.alibabacloud.com/help/en/agent-sandbox/mount-oss-dynamically-1)
