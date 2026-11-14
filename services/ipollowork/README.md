# iPolloWork services

English | [中文](README.zh.md)

Independent replacement for the old Cloud backend. One Node process serves an API and static admin interface; one SQLite database stores accounts, points, plans, orders and enterprise metadata. No Next.js, PostgreSQL, Worker provisioning, or old Cloud runtime is required.

## Run

Use Node 24.15 or later.

~~~sh
npm ci
cp .env.example .env
npm run build
ADMIN_PASSWORD='set-a-strong-password' npm run admin -- admin@example.com 管理员
npm start
~~~

Open http://localhost:4785. Registration is available on the login page. First-admin creation is a local operator command, never a public “first user becomes admin” endpoint. Normal users see their own account, enterprises, resources, plans and orders. Platform admins also manage users, payment configuration and the public resource catalog.

## Storage and deployment

DATA_DIR owns work.sqlite, its WAL files, private uploaded files and the generated authentication secret. Back it up as one unit. SQLite is intended for a single service instance with a persistent local disk, not horizontally replicated instances or a network filesystem.

~~~sh
npm run backup -- /absolute/path/to/new-backup-folder
docker build -t ipollowork-services .
docker run --rm -p 4785:4785 -v ipw-data:/data \
  -e SERVICE_ORIGIN=https://accounts.example.com ipollowork-services
~~~

Put HTTPS termination in front of public deployments and set the exact SERVICE_ORIGIN. Rate-limit identity uses the TCP peer. For a reverse proxy, list only its exact IP in TRUSTED_PROXY_IPS and configure that proxy to overwrite X-Real-IP with the client address. Forwarding headers from any other peer are ignored.

Private enterprise Skills and plugin packages can be stored in Aliyun OSS. Configure the private bucket and key in Settings; objects use a private ACL and downloads use short-lived signed URLs after checking membership. Without OSS, uploads use private local files through authenticated download endpoints. Back up OSS separately.

## Scope

- Email/password login with session cookies or bearer tokens; account recovery and invite acceptance use verified email.
- Configure MAIL_WEBHOOK_URL and MAIL_WEBHOOK_TOKEN for verification and password reset. The authenticated POST body is {to, template, url}. Without a mail provider, sign-in works but email verification and recovery report an error.
- Immutable points ledger, idempotent order settlement, membership entitlements, distinct cash and points prices.
- Stripe Checkout and signed webhook settlement at /hooks/stripe. App Store server verification at /api/v1/payments/storekit/verify requires official keys and Apple root certificates. Live charging has not been verified without merchant credentials. Automatic App Store subscription renewals are not enabled in this release.
- Enterprise owner/admin/member roles, departments, email-bound expiring invitations, and per-request membership checks.
- Projects have enterprise/member/department grants, immutable file and knowledge submissions, and native DSH session sharing. Historical snapshots remain read-only.
- Private Skills, plugins and files, up to 24 MB per upload. The service stores and distributes packages; it never executes them.

The new service does not import a legacy customer database automatically. Before a live cutover, stop the old writer, back up it, import into an empty target, reconcile totals, then switch the official API origin. Existing login sessions require a new sign-in.

## Work connection

The existing Work suite account adapter is compatible without changing the native DSH agent runtime. Set its existing accountOrigin to this service's origin. Keep the same API hostname during an official cutover or configure it once for a private deployment.

~~~yaml
# In the existing suite plugin's config:
accountOrigin: http://localhost:4785
~~~

The API implements /api/auth/sign-in/email, /api/auth/get-session and /api/v1/me/summary with the bearer-token and numeric-points fields used by Work. Enterprise and resource APIs live at /api/v1/enterprises, /api/v1/projects, /api/v1/shares and /api/v1/resources. Client tokens stay in the native DSH credential provider. Disabling the suite does not change the native agent loop.

## Checks

~~~sh
npm run check
npm run build
~~~

Tests use actual Better Auth HTTP requests and SQLite files, including invite verification, cross-enterprise access rejection, removal of sharing access, binary downloads, repeated signed payment callbacks, payment mismatch rollback, refunds, points redemption, session revocation and persistence after restart.

## Project collaboration

Schema version 4 adds project grants and immutable changes, and keeps the older records. Project roles are View, Participate and Maintain. A direct member grant or a grant to the member's current department is checked on every request; the highest grant applies. Enterprise owners/admins and the project owner retain maintenance access. Existing enterprise-wide projects retain view access until their scope is changed.

`GET /api/v1/projects/:id/space` returns files, accepted memory and submission summaries. Details are read from `/changes/:changeId`; `/memory` supplies a bounded, independently authorized read for DSH model context. `PUT /access` changes the project scope and direct/department grants. Participants submit either immutable attachment references or knowledge through `/changes`; maintainers accept with a checked version. File acceptance also compares each file's base resource; memory acceptance requires explicitly supplied complete next text. Concurrent changes return a conflict without changing accepted state.

Attachments use the existing upload/download service. Project grants allow readers to download referenced attachments, including submitted versions. Files are not automatically synchronized with local DSH directories. The service runs no models or Git operations. The DSH bundle uses native Liveshare for new session shares; the compatible relay runs in this service and derives native admission from current project grants.

Old snapshots and result revisions remain readable as historical records. Creating a snapshot, posting a comment, or writing old work revisions returns HTTP 410. The admin project page directs sharing to the native DSH interface and has no snapshot creation form. No historical customer rows are deleted during migration.

## Native session relay

Schema version 5 adds project-bound share intents and single-use PKCE authorization codes. The same Node process accepts DSH's outbound WebSocket connections. No DSH runtime runs on the server. The matching native viewer carrier is generated from the pinned official protocol package at development/build time; it is shipped as a static script with its MIT license. Run `npm run build:carrier` when deliberately updating the protocol package.

The suite installs the native Liveshare owner plugin. Its Share action selects a project and View or Participate, authorizes the current iPollo account through native PKCE, then starts the native share. View includes current project readers and blocks model input, cancellation, forking, renaming and uploads; Participate includes only current participants and maintainers and enables native forking. Each link has one native permission tier. URLs are not public access grants. Recipients sign in with their own iPollo account.

Owner credentials are tied to the existing login session and DSH instance. The server authenticates each registration and each viewer request, derives identities itself, and pushes monotonic access snapshots to DSH. Changing departments, removing project access, banning an account, or revoking its login removes access; open requests are cancelled and the native owner rechecks admission before execution. A stopped share retains a tombstone, so old gateway credentials cannot recreate it. Normal disconnection leaves the record available for authenticated reconnection. DSH and the originating computer must remain online to execute or serve a shared session. Forks are native sessions on that computer, not copies downloaded to the recipient.

The native viewer document runs in a sandbox without same-origin access. It receives only a short-lived capability for that share, uses ephemeral display preferences, and cannot read the service's account cookies or browser storage. Responses and assets are not cached. The relay neither persists transcripts nor hosts model/provider credentials. It sees native request/response traffic in memory and is part of the trusted deployment.

`compose.yml` runs the built service on loopback with a persistent data volume. Set `SERVICE_ORIGIN=https://your-work-domain`, then run `docker compose up -d --build` behind HTTPS termination. `deploy/nginx.conf` contains the HTTP/WebSocket locations to add to an existing TLS virtual host. Preserve the `/data` volume, which contains both SQLite and the signing secret. Do not log authorization headers or share capability paths. Every replica needs the same live socket registry, so this release runs one service instance; do not place independent replicas behind round-robin balancing.

The owner computer connects outward only. No incoming port is opened on employee computers. This version uses native DSH v1 relay frames from 0.2.2-rc.2; protocol upgrades require rerunning the native integration test before deployment. Native write confinement is supplied by DSH. Project permissions and explicit file submissions do not turn a shared workspace into isolated per-person filesystem copies.

## Official execution services

Schema version 6 adds the service directory and invocation receipts. Administrators configure shared credential ids, HTTPS upstreams, allowed GET/POST paths, optional model catalogs, per-request credit prices and eligible plans in Service center. Empty plan restrictions allow any signed-in account. A plan's existing points grant funds service calls; BYOK calls made locally never use this ledger. Secrets use the existing encrypted Settings store and are excluded from catalog responses.

`GET /api/v1/services` returns the current account's directory. `POST /api/v1/services/:id/invoke` accepts a UUID requestId, relative path, method, optional base64 body and contentType. Only configured path templates are callable (`:id` matches a single identifier). The server selects credentials and price, atomically reserves points, and streams the upstream response. Completed requests replay once without another charge; a conflicting id is rejected. Response replay bytes are retained for 24 hours, while audit receipts remain. One request per account runs at a time. Definitive 4xx rejection refunds the reservation; transport failures, interrupted responses and server errors stay unknown for administrator reconciliation and are never blindly repeated. These prices meter HTTP operations, not inferred media duration or token usage; configure polling routes at zero points. Provider-specific success and usage accounting must be verified before offering per-token or per-video pricing.

Service center displays configuration and invocation receipts. Administrators reconcile unknown calls only after checking the provider; confirming failure refunds once. Model, image and video providers remain external services. Live provider credentials and payment channels are deployment configuration, and are not shipped with this repository.

Polling routes must declare job ownership: `jobResultField` names the submission response's job id (for example `data.task_id`), `jobField` names a body/query polling id, and `:id` in a path also requires an owned job receipt. A user cannot poll another account's job through the shared provider key. Chat services declare their allowed model catalog and maximum output tokens; the gateway rejects other model names or larger output limits before reserving credits.
