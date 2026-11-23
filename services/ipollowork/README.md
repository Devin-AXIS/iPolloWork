# iPolloWork Services

Organization template, Skill and MCP configuration publications accept custom version labels up to 64 characters, excluding control characters and `/ \\ ? # %`. Plugins still require canonical exact SemVer package versions. Review, duplicate-version and member-grant rules remain in force. Suite 0.1.38 or later reads and URL-encodes these labels; older clients need updating before consuming custom labels. No database migration is required.

English | [中文](README.zh.md)

Independent account, organization, project and billing service. Node serves the API and administration UI; PostgreSQL owns identities and transactional records, and private Alibaba OSS owns production files. The service does not import DSH or the old iPolloWork runtime.

For development transfer, image builds, compiled operator commands, external RDS deployment, mail integration and backup/restore acceptance, start with the [handoff guide](HANDOFF.md). The service image includes the built administration pages; no desktop packaging is required.

Enterprise administrators use `POST /api/v1/enterprises/:id/analytics` with `{days: 7|30|90, groupBy: "department"|"member"|"sku", page: 1}`. Results contain at most 25 groups. Schema eight adds immutable enterprise/department attribution, model IDs, polling classification and nullable provider token counts to service calls; historical unattributed calls stay excluded. Responses contain aggregates only, without prompts or response bodies. Skill/plugin inventory is separate from reported skill loads and tool calls in linked enterprise projects. The authenticated activity endpoint deduplicates by account, project, session and call. Metadata reporting is best-effort and excludes arguments and results; it is not an audit log or billing source.

## Run

Use Node 24.15 or newer and PostgreSQL 15 or newer. Create a dedicated database and role, copy `.env.example` to `.env`, and set `DATABASE_URL`. Keep the same `DATA_DIR` and authentication secret when upgrading.

~~~sh
npm ci
npm run build
ADMIN_PASSWORD='set-a-strong-password' npm run admin -- admin@example.com 管理员
npm start
~~~

Open http://localhost:4785. Registration is available on the login page; first-admin creation is a local operator command. Set `MAIL_WEBHOOK_URL` and `MAIL_WEBHOOK_TOKEN` for verification and recovery. The authenticated webhook receives `{to, template, url}`. Sign-in works without mail; verification and password recovery report missing configuration.

## Data and deployment

[Storage and deployment](docs/storage.md) owns PostgreSQL migration, backups, OSS, quotas and retention. Metadata stores users, organizations, departments, permissions, projects, file versions, compact accepted memory, orders and an immutable credit ledger. Large files and memory-version bodies use object storage. Inputs, full local chats and native workspace state are not automatically uploaded.

Personal unpublished outputs expire after seven days. Published project outputs and organization outputs remain until explicitly removed. Cloud cleanup never deletes native local files. Default quotas are 200 GiB per person and 500 GiB per organization; administrators can change each owner's limit. Limits represent allowed capacity, not preallocated storage or a promise of free traffic.

`compose.yml` provides PostgreSQL and the service with persistent volumes. Set `POSTGRES_PASSWORD` and an HTTPS `SERVICE_ORIGIN`; keep the database private. Public deployments require OSS by default. Without OSS, loopback development uses a private service cache. [Alibaba Cloud deployment](deploy/README.md) adds automatic HTTPS and scoped ECS credentials for OSS. The native session relay keeps live sockets in one process: this release supports one relay instance, even though PostgreSQL supports concurrent connections. Do not round-robin independent relay processes.

[App data](docs/app-data.md) gives small plugins, sites and apps a record store in a separate PostgreSQL database named by `APP_DATA_DATABASE_URL`. Callers send JSON statements and never reach SQL; page code uses a per-app public key that only opted-in collections accept. Without that database, app data routes report that the feature is not configured.

## Accounts and permissions

Users can work personally or create organizations. Organization owners and administrators manage departments, invitations, members, file packages, Skills, plugins and organization models. Invitations are email-bound and expire. Every request checks current membership and grants; a department move or revoked membership changes access immediately.

Projects belong to a person or organization. View, Participate and Maintain grants apply to current members or departments. Maintainers manage access and accept contributions. Acceptance checks both the project revision and the submitted file's base version; conflicts retain the proposal. Archived snapshots and old result records remain readable, while new writes to retired snapshot, comment and result endpoints return HTTP 410.

## Native DSH connection

Set the suite's `accountOrigin` to this service. Credentials stay in DSH's native credential store. The suite observes native `deliverables/presented` events only in linked projects and streams output versions without changing the agent loop. Disabling the suite removes these subscriptions and model-context contributions. Existing local files and sessions remain intact.

`GET /api/v1/projects/:id/space` returns accepted state; `/overview` returns participants and contribution counts; `/artifacts` returns current output versions. Raw uploads go to `/artifacts/upload` with an `x-ipw-artifact` metadata header. Input uploads are rejected by this endpoint. The default output maximum is 512 MiB, configurable with `MAX_ARTIFACT_BYTES`; ordinary resource uploads remain limited to 24 MiB.

Memory contributions contain distilled facts and decisions. Maintainers explicitly merge a complete summary of at most 8,000 characters and two heading levels. Bodies and accepted versions are private objects; PostgreSQL retains the current compact summary for the next model step. The service runs no background model to mine full conversations. A linked maintainer may also merge through the suite's project-memory tool.

## Sharing

The suite uses the native DSH share dialog and viewer. A link permits anonymous visitors; organization sharing targets the organization or its departments. Session permission and fork controls remain native. Sharing does not change project grants. The service checks owner sessions and current audience membership and relays native frames over outbound WebSockets; the originating computer must remain online. The relay holds traffic in memory and does not persist transcripts or model keys.

The sandboxed viewer receives only a short-lived share capability and cannot read account cookies. Its assets allow the opaque viewer origin and Cordis configuration evaluation; account pages retain same-origin resources and disallow evaluation. Revocation cancels access, and stopped shares retain tombstones. Set exact trusted proxy IPs in `TRUSTED_PROXY_IPS`, have the proxy overwrite `X-Real-IP`, and do not log authorization headers or share capability paths. [The proxy example](deploy/nginx.conf) includes HTTP and WebSocket routes.

## Official services and plans

[Official billing](docs/billing.md) defines model presets, price sources, credit conversion and activation requirements. Administrators manage keys centrally in Service center. Plugins can choose official services or their own native keys. Missing credentials never trigger a paid fallback.

Each provider has one key configuration shared by its capabilities. Alibaba includes current Qwen and third-party chat presets; the editor starts with recommended versions and searches the complete saved directory. Regional discovery imports all authors with published prices where recognized, preserving operator prices and keeping newly discovered models disabled. The editor supports input/output token prices, cache prices, image counts, audio/video duration, character counts and pricing tiers. Unconfigured, disabled, unpriced and expired models stay out of the user catalog. See the [upgrade steps](https://github.com/Devin-AXIS/iPolloWork/blob/818b201e54dd86cbbc9187f5c92b9097627f8412/docs/upgrade-guide/v0.2.2-rc.2/ipollowork-model-pricing/guide.md).

The gateway authenticates each request, restricts paths and models, admits metered requests when the account has positive credits, and deducts actual provider usage on completion. A completed call may leave debt; another paid call requires a positive balance. Fixed-price routes keep their atomic upfront charge. Video polling verifies job ownership. Duplicate request IDs cannot charge twice. Unknown outcomes retain their billing record until an administrator checks the provider; they are never blindly resubmitted. Response replay is available for 24 hours. Independent gateway requests from the same account can run concurrently. Requests sharing an ID cannot execute or charge twice. Schema version 6 removes the previous per-account unique running-request index; no client update is required.

Stripe, Alipay and WeChat checkout settle only after signed provider notifications or authenticated server-side status queries. Provider credentials are configured centrally; unconfigured channels cannot create orders. Two disabled 30-day membership drafts are supplied. Automatic renewal is not enabled. Cash and credit redemption prices remain separate, and enabled plans must satisfy the configured cost floor. Membership allowances and period usage are described in [billing](docs/billing.md).

## Verification

Project Board schema 22 adds task archive/recycle metadata, deadline-notice deduplication and active-session uniqueness while preserving existing tasks and read receipts. Deploy this service together with the updated Suite bridge for global board search/totals, lifecycle actions and deadline reminders; older services cause the new client to display an upgrade hint. The migration runs through the existing PostgreSQL migrator. Back up the database before production rollout. The service checks due tasks every 30 seconds against current project access; concurrent workers deduplicate deliveries by task, recipient and deadline.

~~~sh
TEST_DATABASE_URL=postgresql://127.0.0.1:5432/ipollowork_test npm run check
npm run build
npm run bench:database
~~~

Tests allocate independent schemas and cover real Better Auth requests, organization authorization, payment replay and refunds, concurrent quotas, output versions, retention and usage settlement. The [capacity report](docs/capacity.md) records a reproducible SQL workload with 500,000 synthetic accounts; it is not a concurrent-user capacity guarantee.

The service catalog classifies each connection and model as `language`, `image`, `video`, `audio`, `embedding` or `tool`, with a separate `vendor`. Existing rows are resolved from declared capabilities; no model-name guessing is used. Non-language model entries do not require token-limit fields. Organization connections require explicit routes for non-chat operations, and the same categorized connection controls department/member access.

Schema 7 reconciles membership data and parallel execution from either schema-6 release. Back up PostgreSQL before upgrading; startup applies the migration atomically and removes the old single-request index.

## HTTP capabilities

[Capability HTTP API](docs/capabilities.md) describes typed discovery, invocation, asynchronous results and application access keys over the same gateway.

Published Design pages keep one public URL per owner, native workspace and entry path. Updates stage a complete file set privately, then switch the live revision atomically. An incomplete update leaves the previous page available. Schema 8 adds publication identity and revision links without new tables. A unique older publication is adopted on the first update; ambiguous older duplicates require selecting a publication before updating.

Cloud/local project creation and the optional Alibaba execution server are described in [cloud projects](https://github.com/Devin-AXIS/iPolloWork/blob/818b201e54dd86cbbc9187f5c92b9097627f8412/plugins/ipollowork-suite/docs/cloud-projects.md). Migration 10 adds project execution location and a single-writer lease; cloud execution is disabled until configured.

Daily and weekly credit caps are currently disabled by default (`USAGE_LIMITS_ENABLED=false`); balances, metering and usage history remain active. Set the flag to `true` to enforce stored membership allowances again.

Invitations currently use copyable links and send no email. Open the link, register or sign in with the invited email, then accept it; mailbox verification is not required. The link is a secret: possession plus a matching account email grants access, but does not prove mailbox ownership. Links expire, can be revoked, and cannot restore a removed member after acceptance. A space invitation grants only its selected view/participate/maintain role; existing organization-wide access still applies.

Organization services accept `credentialMode: "shared" | "member"` (default shared). Authorized members PUT `{ "key": "..." }` to `/api/v1/enterprises/:id/services/:serviceId/credential`; an empty key deletes only their credential. Member-mode invocation requires an authorized `X-iPollo-Project` (cloud grants take precedence). Credentials reuse encrypted settings; no schema migration is needed. Routes may select `base: "origin"` for explicit host-relative integration endpoints; the default remains the configured service base path. Only allowlisted MCP transport headers are forwarded. Never expose provider credentials in client code.

### Organization member administration

Organization owners and administrators can batch-create up to 500 email-bound invitations from the organization Members page. Each batch is atomic and keeps previous invitations valid. Links are returned for the administrator to distribute, not automatically emailed; individual invitations still work.

Optional member-change notifications are configured on the same page and disabled by default. Schema version 13 adds an organization-owned endpoint table and durable delivery queue. The signing secret is encrypted and shown only on creation or rotation. Verify `X-iPollo-Signature` as `sha256=` plus HMAC-SHA256 of `X-iPollo-Timestamp + "." + rawBody`; reject stale timestamps and deduplicate `X-iPollo-Delivery`. Payloads contain event ID/type, organization/user IDs, current role/department (null after removal) and creation time. Delivery is at least once with exponential retries capped at one hour. Only public HTTPS endpoints are accepted; redirects and private destinations are rejected. Back up PostgreSQL and the authentication secret before migration.

## Curated plugin market

`GET /api/market/catalog` publishes up to 200 curated native DSH references. Authenticated `GET /api/v1/market/manage` reports platform administration permission; `POST /api/v1/market/plugins` requires the platform `admin` role. Only HTTPS npm/Git sources and pinned SemVer releases are accepted, with full Git commit hashes for Git sources. References are stored in the existing `settings` table under `market.catalog`; PostgreSQL advisory transaction locks serialize additions, and the existing `audit` table records the actor. No third-party code is fetched or executed. Deploy alongside the updated suite to expose its administrator-only add form.

## Configuration files

The server and every production operator command share the dotenv selected by `IPOLLO_CONFIG_FILE` (default `.env`). Existing process variables win; a missing explicit file fails before database initialization. Both account and app-data database URLs/schemas are configurable. External RDS deployments use `deploy/compose.external.yml`; `IPOLLO_ENV_FILE` selects its host-side dotenv. See [configuration](docs/configuration.md). The administration page now includes validated cloud-gateway settings, and users without organizations can create personal projects. Editing provider credentials preserves the existing disabled/enabled selection instead of defaulting to enable.
