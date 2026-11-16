# Cloud projects

Cloud projects reuse the official DSH Agent, session store, workspace, terminal and filesystem. The account service owns project metadata and authorization; the optional suite components own admission and Alibaba Sandbox allocation. No upstream DSH code or second Agent engine is included. OpenSandbox is not enabled.

## User behavior

Enable `ipollowork-cloud-projects` in the official plugin manager and configure the account service's cloud settings once. The existing create dialog then offers Local and Cloud. Cloud requires a project name and uses the same organization/access selection. Local retains its directory picker and native execution. Disabling the component removes Cloud from creation and rejects new opens; it does not delete cloud projects or their files. Existing cloud sessions are revoked by disabling cloud execution in the account service, not by disabling one client's connector.

Opening Cloud currently navigates to an authenticated official DSH Web page. Browser clients can use that page without the user's computer remaining online. Native desktop connection switching, returning to the previous local connection, mobile packaging and complete plugin parity are not verified by this implementation. A cloud template contains its own installed plugins; local plugin installations and credentials are not copied.

## Ownership and persistence

Each launch is authorized against current project permissions. View-only membership cannot start an environment. A short-lived signed launch grant is exchanged for runtime and manager grants restricted to one user, project and instance. The Alibaba API key and manager grant remain on the execution server. The runtime grant can access the project's model gateway but cannot administer accounts or enumerate other projects.

PostgreSQL migration 10 adds `execution_mode`, an owner-scoped creation key and one `cloud_runtime_leases` table. Local is the default for existing projects. Creation retries reuse the same record; changed input rejects the old key. A database lease allows one cloud writer per project across execution servers. Lease expiry exceeds provider TTL; an uncertain allocation or deletion retains the lease instead of immediately admitting another writer.

Project files mount at `/mnt/project/workspace` from `/ipollowork/<project-volume>/`. Official DSH state mounts separately at `/mnt/state/dsh` from `/ipollowork-runtime/<user-and-project-hash>/`. The plugin refuses to start if either mount is absent. Reopening uses the same paths. Live Alibaba verification found that OSS mounts reject hard links, symbolic links and chmod. The official DSH profile seed contains symbolic links, and its JSONL persistence requires hard links. Consequently, storing the complete DSH home on OSS does not work: leave cloud project creation disabled until a POSIX-capable state store is integrated and verified. Ordinary file write/read and retention across sandbox destruction passed; these checks do not establish DSH state compatibility. Files outside these mounts are temporary. Direct OSS writes are not yet registered in the account service's storage-usage and retention accounting; they must not be advertised as quota-controlled application files.

The execution server renews active environments and stops an idle one after `idleTimeoutMs` (default 120000). Open Agent turns send activity independently of the browser; closing the browser does not by itself stop an active turn. Grants expire after `grantTtlSeconds` (default 86400); reopening obtains new grants. These grants do not supply checkpoint replay after a killed process. Restart restores persisted official DSH state, but automatic continuation of interrupted tools is not implemented.

## Operator setup

1. Pack this suite and build `deploy/cloud/Dockerfile` with `--platform linux/amd64`. Place the package at `ipollo-dsh-suite.tgz` and copy `runtime.package.json` from this deployment directory into the build context. The image installs official `@deepseek-ai/dsh@0.2.2-rc.3`, pnpm for the official plugin manager, the suite and system components required by Alibaba generation-2 templates. The runtime manifest pins the patched transitive dependencies for this top-level installation. Publish an immutable image tag and create a ready generation-2 template in the intended region. Image build, registry access and Alibaba template readiness require cloud validation.
2. On the existing execution server install the same suite through the official DSH plugin manager. Set `ALIYUN_SANDBOX_API_KEY` and a randomly generated `IPOLLO_CLOUD_GATEWAY_KEY` of at least 32 characters in its process environment. Launch only through `dsh --profile web --patch <server.patch.yml> --no-open`, using `deploy/cloud/server.patch.example.yml` as the operator template.
3. Expose `/ipollowork-cloud-server/open` to the account service through HTTPS, or a loopback proxy on the same machine. The endpoint requires the gateway key. Do not expose the management profile or its owner token publicly.
4. Set account-service `cloud` settings through the authenticated admin settings API: `enabled=true`, `gatewayOrigin`, `gatewayKey`; optionally `ttlSeconds` (1800), `grantTtlSeconds` (86400) and `leaseGraceSeconds` (180). The key must match the execution server. Keep this feature disabled until the live smoke below passes. Availability reports configured enablement, not a cloud-provider health probe.
5. Enable the `ipollowork-cloud-projects` connector for intended clients. Leave `ipollowork-aliyun-sandbox` disabled in this full-runtime mode: official tools already execute inside the remote environment.

Configure `bucket`, `storageEndpoint`, `roleArn`, `template`, `apiUrl` and `domain` centrally. The bucket and template must be in the intended region. RAM policies must restrict access to the intended project/state prefixes; separate mount paths alone are not proof of tenant isolation. The plugin currently accepts one operator-supplied role and does not provision per-project RAM roles. Validate its effective permissions before multi-tenant production use. Never put long-lived credentials in the template.

## Verification and remaining deployment work

Local checks cover actual PostgreSQL migrations, creation retries, project-limited grants, revocation, lease exclusivity, renewal, optional-component disposal and the create dialog. The server tests use a provider fixture to verify official-profile launch, storage checks and cleanup. A disposable real official DSH profile validates official package registration, suite/bootstrap loading, owner-cookie login and revocation; it does not prove a live Alibaba environment.

Before production: build and verify the image, provision the template and restricted RAM/OSS access, open a real cloud project, run terminal and file operations through its official DSH UI, close the local client during a long task, reopen after idle destruction and verify persisted files/session, then test permission revocation and concurrent opens. Validate OSS atomic file/locking behavior for DSH state and storage accounting. No production deployment or live cloud smoke is implied by local checks.

Sources: [Alibaba custom images](https://www.alibabacloud.com/help/en/agent-sandbox/build-and-manage-custom-templates-with-code), [dynamic OSS mounts](https://www.alibabacloud.com/help/en/agent-sandbox/mount-oss-dynamically-1).


## Cloud model and application scope

Cloud profiles disable native personal-key provider entries and accept streaming calls only through suite account providers. The service catalog and invocation route restrict enterprise channels to the project's current enterprise; personal projects use official channels only. Cloud connection rows cannot select Own key. Local profiles retain their existing model configuration.

The runtime grant can create, query and upload attachments only within applications linked to its project. App-data schema 6 records that project identity. An input organization cannot override the grant, and applications from other projects or the account's unbound personal apps are inaccessible through it. Ordinary account tokens keep their existing authorized access. The official Agent loop-to-database regression uses deterministic model output and real PostgreSQL for both local and cloud grants; it does not claim live Alibaba validation.
