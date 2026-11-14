# Alibaba Cloud deployment

English | [中文](README.zh.md)

Deploy the account, organization and project service on a dedicated ECS instance. Native DSH sessions and local previews remain on their originating computers. Do not expose one DSH owner's Web profile as a multi-user server.

Use Ubuntu 24.04, Docker Engine and Compose v2. From `services/ipollowork`, create a private `.env` with these values and a URL-safe random database password. When migrating, preserve the existing authentication secret, settings and database.

~~~dotenv
SERVICE_DOMAIN=work.ipollo.net
SERVICE_ORIGIN=https://work.ipollo.net
PUBLICATION_DOMAIN=publish.ipollo.net
PUBLICATION_ORIGIN=https://publish.ipollo.net
POSTGRES_PASSWORD=replace-with-a-random-secret
OSS_RAM_ROLE=ipollowork-storage
OSS_INTERNAL=true
~~~

Attach an ECS role using `oss-role-trust.json` and `oss-role-policy.json`. The policy grants object read, write and delete only in the named publication Bucket; replace that resource for another deployment. Set region and Bucket in the service's central OSS settings. The official SDK retrieves and renews temporary credentials through IMDSv2; no long-lived AccessKey is required. Leave `OSS_RAM_ROLE` empty to use stored keys outside ECS.

~~~sh
chmod 600 .env
docker compose -p ipollowork -f compose.yml -f deploy/compose.production.yml up -d --build
curl --fail http://127.0.0.1:4785/api/health
~~~

After checking local health, point the domain at the ECS public IP. The proxy opens HTTP and HTTPS and manages the certificate. The service port is loopback-only and PostgreSQL has no published port. `PROXY_IP` and `SERVICE_SUBNET` override the private Compose network; the IP must belong to that subnet. The proxy replaces the client-IP header and leaves request-path logging disabled. Native share WebSockets use the same hostname.

Point the publication domain at the same IP. It must differ from the account-service origin: it serves only published files, while account APIs remain on the service domain. Draft files cannot be browsed. A complete publication preserves relative resource paths and supports HTML, CSS, JavaScript and byte-range media reads; uploaded objects remain private in OSS.

Verify HTTPS health, existing-account login, organization access and an authorized OSS upload/download before changing clients' `accountOrigin`. Preserve the old DNS value for rollback. See [storage](../docs/storage.md) for migration and backup. Database backups use a separate destination; the publication Bucket holds explicitly published content.

Back up PostgreSQL, the authentication secret and settings before replacing containers. Reuse the same Compose project name and all data/certificate volumes. Never run `down -v` on an existing installation. Roll application code back only when it supports the installed database version.
