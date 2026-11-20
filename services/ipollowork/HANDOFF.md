# iPolloWork service development and deployment handoff

English | [中文](HANDOFF.zh.md)

This directory independently builds the account, organization, collaboration, model gateway and administration service. Package version is in `package.json`; current business schema is 21. Exported `VERSION.json` and `SHA256SUMS.txt` identify the actual source snapshot, including whether it contains working-tree changes. Do not mix this source with the older 2026-11-19 handoff.

## Ownership

`web/` owns React pages; `src/app.ts` and `src/http-server.ts` assemble routes, authorization, readiness and draining; `src/auth.ts` owns Better Auth and mail; `src/database.ts` and ordered migrations own PostgreSQL; execution/payments own billing; storage modules own service files, quotas and OSS. `src/cli/` compiles operator commands into the production image. Tests use disposable PostgreSQL schemas, never customer databases.

The image contains built pages and APIs. PostgreSQL, private OSS, mail, payment and model providers are dependencies. The optional cloud execution gateway is separate. Native sharing requires the originating computer online. Deploy one service instance; independent relay replicas cannot be round-robined.

## New deployments

Requirements: Docker Engine and Compose v2, or Node >=24.15 and PostgreSQL >=15 for source deployments. Full tests also need `pg_dump` and `pg_restore`. The default operations image provides PostgreSQL 18 clients. Prefer restoring to the same major version; never change an existing database image's major version without a planned migration.

Copy `.env.example` to `.env`. Set `SERVICE_ORIGIN` (public HTTPS origin, or loopback HTTP for development), `DATABASE_URL` (dedicated database, URL-encoded password), and a new random `AUTH_SECRET` of at least 32 characters. In containers, localhost addresses the container, not the host database. Optional `PUBLICATION_ORIGIN` must differ from the account origin; `APP_DATA_DATABASE_URL` enables a separate app-data database.

Keep `.env` private. **Upgrades must retain the existing authentication key.** An environment `AUTH_SECRET` overrides `/data/auth.secret`; if empty, the persisted file is generated and reused. Changing the key breaks encrypted provider settings.

For an external PostgreSQL/RDS database, run from this directory:

```sh
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml build work
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml run --rm --no-deps work npm run migrate
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml run --rm --no-deps -e ADMIN_PASSWORD work npm run admin -- admin@example.com Administrator
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml up -d work
```

Privately inject `ADMIN_PASSWORD` into the current terminal or a company secret mechanism before the administrator command; remove it afterward. Do not put it in CLI arguments, Git or tickets. New passwords require ten characters. Repeating an existing administrator command is a no-op. Use `--promote-existing` explicitly for an existing ordinary account: its password, identity and data are preserved. Only trusted server operators should execute this command.

For bundled PostgreSQL, set URL-safe `POSTGRES_PASSWORD` and use `compose.yml`. It constructs the internal database URL instead of using `.env`'s `DATABASE_URL`. Run `docker compose up -d --build`, then `docker compose exec -e ADMIN_PASSWORD work npm run admin -- admin@example.com Administrator`. Add `deploy/compose.production.yml` and both domains for Caddy HTTPS; see [deployment](deploy/README.md). Retain existing project names and volumes; never run `down -v` on an installed environment.

`deploy/compose.beta-2c4g.yml` is a production resource overlay: use it with both `compose.yml` and `deploy/compose.production.yml`, not with the base file alone.

## Images and source export

```sh
docker build --target runtime -t ipollowork-services:handoff .
docker build --target operations -t ipollowork-services-ops:handoff .
docker save -o ipollowork-services-images.tar ipollowork-services:handoff ipollowork-services-ops:handoff
# Receiving machine:
docker load -i ipollowork-services-images.tar
```

The runtime executes compiled admin, migration and SQLite-import commands without `tsx`. Operations adds official PostgreSQL clients for backups. The default build remains the application image. `npm run package:handoff` exports source, tests, lockfile, deployment materials and checksums, excluding real environment files, data, dependencies and desktop runtimes. A source archive is **not** a built image.

Match operator tools to the database major version. For PostgreSQL 17, build operations with `--build-arg POSTGRES_TOOLS_IMAGE=postgres:17-bookworm`. Tools must not be older than the source server; a newer client's dump is not guaranteed to restore to an older server. `deploy/update-existing.sh` is a historical script specific to the installed cloud.ipollo.net environment, not a general deployment entry point.

## Administration and integrations

- Platform administrators configure **Settings → Alibaba OSS**. ECS instance roles use `OSS_RAM_ROLE`; saved AccessKeys are another option. Buckets remain private and scoped. Public service origins require OSS by default. Organization administrators do not automatically have platform privileges.
- Service center owns provider keys, regions, models, real prices and activation. Unconfigured or disabled providers do not silently fall back to paid routes.
- Mail is optional for trial registration/login; password recovery reports unavailable when absent. Set both `MAIL_WEBHOOK_URL` and `MAIL_WEBHOOK_TOKEN`. The service POSTs JSON `{to, template, url}` with Bearer authorization; templates are `reset-password` and `verify-email`. Your bridge adapts this to the company mail API. A 2xx response acknowledges delivery, the timeout is 15 seconds, and this mail interface has no durable retry queue. Never log reset URLs.
- Payment integrations require real provider credentials, verified callbacks and target-environment acceptance. Client success indications never settle payments.
- `/api/health` is liveness. `/api/ready` checks the account and configured app-data databases. Unknown error logs retain only a generated request ID, type and safe code; correlate using `X-Request-Id`.

## Backup and recovery

Back up databases, the effective key, DATA_DIR, private OSS objects and deployment configuration. Suggested policy: managed daily database backups; daily DATA_DIR snapshots retained for 30 days in independent encrypted private storage; versioned keys in the company vault; additional backups before migrations and monthly restore drills.

Stop all application writers while taking a paired file/database backup, leaving PostgreSQL running. Build the operations image, temporarily set `WORK_IMAGE=ipollowork-services-ops:handoff` (PowerShell: `$env:WORK_IMAGE=...`), and run:

```sh
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml stop work
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml run --name ipw-backup-once --no-deps \
  --entrypoint node work dist/server/cli/backup.js /tmp/backup
docker cp ipw-backup-once:/tmp/backup ./backup-new-directory
docker rm ipw-backup-once
# Clear the temporary WORK_IMAGE override, retaining the normal application image.
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml start work
```

Use a fresh backup directory outside DATA_DIR. Format 1 contains `manifest.json`, `work.dump`, optional `app-data.dump`, and `data/`; this differs from the older flat format. Dumps include only the configured service-owned schemas. `data/auth.secret` is the key actually in use, even when environment configuration overrides a stale file. OSS is separate. Failed database/file copying never publishes a completed destination. Transfer sensitive backup output into controlled encrypted storage.

Restore to **isolated empty databases and a new data volume**, not over customer data:

1. Validate the manifest and inspect dumps using `pg_restore --list`. Retain the schema names in the manifest. Do not start automatic application migrations before restoration.
2. Privately supply connection settings through `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`; run `pg_restore --exit-on-error --no-owner --no-acl --dbname=<new-database> work.dump`. Restore optional `app-data.dump` to its corresponding new app-data database.
3. Restore `data/` contents into `/data`, readable/writable by UID 1000. Set `AUTH_SECRET` to the backed-up key, or leave it empty to use restored `auth.secret`; do not retain an unrelated new key.
4. Restore matching OSS objects and configuration, run migrations, then start the service. Verify existing login, balances, organization permissions, decrypted settings and private file downloads.
5. Switch traffic only after acceptance. Retain the previous environment. Application rollback must support the installed schema; never force an older image onto a newer database.

## Development and acceptance

```sh
npm ci
npm run build
TEST_DATABASE_URL=postgresql://test-user@127.0.0.1:5432/ipollowork_test npm run check
npm run smoke -- http://localhost:4785
npm run package:handoff
```

Tests create/drop isolated schemas in a dedicated test database. Operator commands start neither HTTP listeners nor cleanup workers. Migrations increase monotonically; never rewrite shipped migration history. Web changes rebuild this service image without repackaging the desktop client.

Acceptance covers repeatable admin setup, ordinary-user exclusion from admin routes, login/logout, organization permissions, private OSS transfer, model billing/idempotency, two-database backup/restore, proxied WebSockets, explicit missing-integration failures, both themes and narrow screens.

This local review environment has no usable Docker Engine. Source builds, Compose configuration checks and tests do not establish that the Linux image was executed. Before production handoff, build both images on the target Linux host, verify probes, persistent-volume restarts and restoration, and record the image digests. Real mail, OSS, models and payment integrations require receiving-team credentials and acceptance; fake local fixtures do not replace that work.

## Selecting configuration files

Set `IPOLLO_CONFIG_FILE` before running the server, migrate, admin, backup or import:sqlite to select a private dotenv. Existing process variables override the file; missing explicit files fail early. Both database URLs/schemas, SERVICE_ORIGIN, publication origin and mail bridge are configurable. For external Compose, IPOLLO_ENV_FILE selects the host file and must match --env-file; the bundled-database Compose intentionally constructs a local URL. See [configuration details](docs/configuration.md). The administration UI now covers cloud gateway settings and personal projects without organization membership; connection edits preserve mixed model activation unless the bulk checkbox is explicitly changed.
