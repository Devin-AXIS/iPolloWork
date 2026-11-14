# iPolloWork services

English | [中文](README.zh.md)

Independent account, organization, project and billing service. Node serves the API and administration UI; PostgreSQL owns identities and transactional records, and private Alibaba OSS owns production files. The service does not import DSH or the old iPolloWork runtime.

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

## Accounts and permissions

Users can work personally or create organizations. Organization owners and administrators manage departments, invitations, members, file packages, Skills, plugins and organization models. Invitations are email-bound and expire. Every request checks current membership and grants; a department move or revoked membership changes access immediately.

Projects belong to a person or organization. View, Participate and Maintain grants apply to current members or departments. Maintainers manage access and accept contributions. Acceptance checks both the project revision and the submitted file's base version; conflicts retain the proposal. Archived snapshots and old result records remain readable, while new writes to retired snapshot, comment and result endpoints return HTTP 410.

## Native DSH connection

Set the suite's `accountOrigin` to this service. Credentials stay in DSH's native credential store. The suite observes native `deliverables/presented` events only in linked projects and streams output versions without changing the agent loop. Disabling the suite removes these subscriptions and model-context contributions. Existing local files and sessions remain intact.

`GET /api/v1/projects/:id/space` returns accepted state; `/overview` returns participants and contribution counts; `/artifacts` returns current output versions. Raw uploads go to `/artifacts/upload` with an `x-ipw-artifact` metadata header. Input uploads are rejected by this endpoint. The default output maximum is 512 MiB, configurable with `MAX_ARTIFACT_BYTES`; ordinary resource uploads remain limited to 24 MiB.

Memory contributions contain distilled facts and decisions. Maintainers explicitly merge a complete summary of at most 8,000 characters and two heading levels. Bodies and accepted versions are private objects; PostgreSQL retains the current compact summary for the next model step. The service runs no background model to mine full conversations. A linked maintainer may also merge through the suite's project-memory tool.

## Sharing

The suite uses the native DSH share dialog and viewer. A link permits anonymous visitors; organization sharing targets the organization or its departments. Session permission and fork controls remain native. Sharing does not change project grants. The service checks owner sessions and current audience membership and relays native frames over outbound WebSockets; the originating computer must remain online. The relay holds traffic in memory and does not persist transcripts or model keys.

The sandboxed viewer receives only a short-lived share capability and cannot read account cookies. Revocation cancels access, and stopped shares retain tombstones. Set exact trusted proxy IPs in `TRUSTED_PROXY_IPS`, have the proxy overwrite `X-Real-IP`, and do not log authorization headers or share capability paths. [The proxy example](deploy/nginx.conf) includes HTTP and WebSocket routes.

## Official services and plans

[Official billing](docs/billing.md) defines model presets, price sources, credit conversion and activation requirements. Administrators manage keys centrally in Service center. Plugins can choose official services or their own native keys. Missing credentials never trigger a paid fallback.

The gateway authenticates each request, restricts paths and models, reserves credits atomically, and settles from provider usage. Video polling verifies job ownership. Duplicate request IDs cannot charge twice. Unknown outcomes retain their reservation until an administrator checks the provider; they are never blindly resubmitted. Response replay is available for 24 hours. One active gateway request per account is allowed.

Stripe Checkout settles through signed callbacks at `/hooks/stripe`; App Store verification requires official keys and root certificates. Two disabled 30-day membership drafts are supplied. No live charge or automatic subscription renewal is implied by these presets. Cash and credit redemption prices remain separate, and enabled plans must satisfy the configured cost floor.

## Verification

~~~sh
TEST_DATABASE_URL=postgresql://127.0.0.1:5432/ipollowork_test npm run check
npm run build
npm run bench:database
~~~

Tests allocate independent schemas and cover real Better Auth requests, organization authorization, payment replay and refunds, concurrent quotas, output versions, retention and usage settlement. The [capacity report](docs/capacity.md) records a reproducible SQL workload with 500,000 synthetic accounts; it is not a concurrent-user capacity guarantee.

The service catalog classifies each connection and model as `language`, `image`, `video`, `audio`, `embedding` or `tool`, with a separate `vendor`. Existing rows are resolved from declared capabilities; no model-name guessing is used. Non-language model entries do not require token-limit fields. Organization connections require explicit routes for non-chat operations, and the same categorized connection controls department/member access.
