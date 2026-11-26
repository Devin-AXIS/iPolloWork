# Alibaba Cloud deployment

English | [中文](README.zh.md)

Deploy the account, organization and project service on a dedicated ECS instance. Native DSH sessions and local previews remain on their originating computers. Do not expose one DSH owner's Web profile as a multi-user server.

Use Ubuntu 24.04, Docker Engine and Compose v2. From `services/ipollowork`, create a private `.env` with these values and a URL-safe random database password. When migrating, preserve the existing authentication secret, settings and database.

~~~dotenv
SERVICE_DOMAIN=cloud.ipollo.net
SERVICE_ORIGIN=https://cloud.ipollo.net
PUBLICATION_DOMAIN=publish.ipollo.net
PUBLICATION_ORIGIN=https://publish.ipollo.net
POSTGRES_PASSWORD=replace-with-a-random-secret
OSS_RAM_ROLE=ipollowork-storage
OSS_INTERNAL=true
~~~

Attach an ECS role using `oss-role-trust.json` and `oss-role-policy.json`. The policy grants object read, write and delete only in the named publication Bucket; replace that resource for another deployment. Set region and Bucket in the service's central OSS settings. The official SDK retrieves and renews temporary credentials through IMDSv2; no long-lived AccessKey is required. Leave `OSS_RAM_ROLE` empty to use stored keys outside ECS.

For a versioned or versioning-suspended bucket, apply the policy's bucket-level `oss:ListObjectVersions` and object-level `oss:DeleteObjectVersion` permissions before enabling permanent deletion. Verify with a disposable object containing historical versions. A receipt remains pending when IAM or object retention prevents cleanup.

~~~sh
chmod 600 .env
docker compose -p ipollowork -f compose.yml -f deploy/compose.production.yml up -d --build
curl --fail http://127.0.0.1:4785/api/health
~~~

After checking local health, point the domain at the ECS public IP. The proxy opens HTTP and HTTPS and manages the certificate. The service port is loopback-only and PostgreSQL has no published port. `PROXY_IP` and `SERVICE_SUBNET` override the private Compose network; the IP must belong to that subnet. The proxy replaces the client-IP header and leaves request-path logging disabled. Native share WebSockets use the same hostname.

Point the publication domain at the same IP. It must differ from the account-service origin: it serves only published files, while account APIs remain on the service domain. Draft files cannot be browsed. A complete publication preserves relative resource paths and supports HTML, CSS, JavaScript and byte-range media reads; uploaded objects remain private in OSS.

Verify HTTPS health, existing-account login, organization access and an authorized OSS upload/download before changing clients' `accountOrigin`. Preserve the old DNS value for rollback. See [storage](../docs/storage.md) for migration and backup. Database backups use a separate destination; the publication Bucket holds explicitly published content.

Back up PostgreSQL, the authentication secret and settings before replacing containers. Reuse the same Compose project name and all data/certificate volumes. Never run `down -v` on an existing installation. Roll application code back only when it supports the installed database version.

For the 100-user trial, see [capacity and verified limits](../docs/capacity.md). The optional `-f deploy/compose.beta-2c4g.yml` adds a bounded single-host memory budget; adding it to an existing deployment restarts PostgreSQL, so rehearse it with backups and a maintenance window. `/api/health` checks process liveness, `/api/ready` checks database readiness. The application drains requests before shutdown; the Compose grace period is 40 seconds. External uptime monitoring and off-host backups are still required.

`deploy/update-existing.sh` stages an exact source revision for the existing Compose installation, then backs up PostgreSQL, the authentication secret and configuration before cutover. It reads the target schema from the candidate image's exported `SERVICE_SCHEMA_VERSION` and verifies that the corresponding SQL file was shipped. The build copies migrations through that same version. A forward migration prevents an automatic rollback to code that only accepts an earlier schema. If Docker Hub is unreachable, an operator may set `ROLLOUT_NODE_IMAGE` to the existing trusted service image with Node 24.22.3; both build and runtime still install the current locked dependencies and replace compiled output. This does not reuse the old application code.

Cutover stops only the application while backing up its account database, the separately configured app-data database, `/data`, authentication secret and every active Compose layer. Both database archives must pass `pg_restore -l`. A backup failure restarts the unchanged application; PostgreSQL, proxy and data volumes are retained. These private backups stay on the server and are not printed or attached to a release.
