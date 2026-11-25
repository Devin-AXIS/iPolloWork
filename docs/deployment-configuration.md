# Distribution and service address configuration

English | [中文](deployment-configuration.zh.md)

## Enterprise release configuration

Create `ipollowork.release.json` at the repository root. The smallest file is `{"version":1}`. Omitted settings use the existing preset or product default. See the [release configuration example](../ipollowork.release.example.json). You can also select a file outside the checkout with `IPOLLOWORK_RELEASE_CONFIG`. Relative icon, plugin archive, patch and CA paths resolve beside this file.

- `desktop` supports the app ID, display name, data directory, external URL scheme, installer filename and icons. Templates support `${version}`, `${os}`, `${arch}` and `${ext}` and end in `.${ext}`. Build-mode suffixes are still added where applicable.
- `desktop.plugins` accepts exact package versions or local `.tgz` archives. It uses the bundle's declared `dsh.bundle.patch` by default and accepts a separate `patch` file. Patches add entries with `insert` and use unique component IDs. The existing Desktop packaging commands include these plugins.
- Account origin precedence is `PACKAGE_ACCOUNT_ORIGIN`, `desktop.accountOrigin`, `server.origin`, the existing preset, then the Suite default. For side-by-side installations, select a distinct app ID, data directory and external URL scheme. For ordinary automatic updates, set `desktop.update.feedUrl` to the HTTPS directory holding the channel metadata and its artifacts. Use `${target}` for separate target directories and set `desktop.update.channel` to `stable` or `nightly` if needed. Signing and mandatory update policy still come from the release preset.
- `server.database` accepts the host, port, database, user, schema, pool limits, timeouts and TLS. Use `passwordFromEnv` for a password or `urlFromEnv` for a complete URL. The application includes only the required public Desktop metadata and account origin.

For an external PostgreSQL deployment, run from the repository root:

```powershell
node services/ipollowork/deploy/compose-release.mjs -p ipollowork up -d --build
```

In a standalone service handoff, select the file with `IPOLLOWORK_RELEASE_CONFIG` and run `node deploy/compose-release.mjs -p ipollowork up -d --build` from the service directory. Supply passwords and `AUTH_SECRET` through the environment or the private service `.env` file. The bundled PostgreSQL deployment uses the original Compose file and `POSTGRES_PASSWORD`. See the [service handoff guide](../services/ipollowork/HANDOFF.md).

## Electron account service

The public default is stored in [`plugins/ipollowork-suite/deployment.json`](../plugins/ipollowork-suite/deployment.json): `{"accountOrigin":"https://accounts.example.com"}`. Rebuild/package after changing it. Desktop composition writes the selected value into the installed `@ipollo/desktop-host/application.yml`. Dedicated desktop mode preserves the selected origin instead of forcing cloud.ipollo.net. Explicit enterprise and legacy official origins are retained.

Release files (`integrations/desktop/.env.windows`, `.env.macos`, or the selected test/production preset) can set `DSH_DESKTOP_ACCOUNT_ORIGIN=https://accounts.example.com`. A one-off `PACKAGE_ACCOUNT_ORIGIN` overrides the selected file on Windows, macOS and Linux/unsigned builds:

```powershell
$env:PACKAGE_ACCOUNT_ORIGIN = 'https://accounts.example.com'
npm run package:desktop:win:x64
Remove-Item Env:PACKAGE_ACCOUNT_ORIGIN
```

Precedence: **explicit PACKAGE_ACCOUNT_ORIGIN → selected platform/preset file → deployment.json**. Stale ambient DSH_DESKTOP_ACCOUNT_ORIGIN does not override a release file. The selected value reaches packaging subprocesses and generated native composition. Ordinary DSH profiles retain explicit Suite configuration; desktop defaults belong to that distribution snapshot.

Origins require HTTPS without paths, credentials, queries or fragments; loopback HTTP is permitted for development. Switching origins never forwards another origin's stored account token. Historical project-domain comparisons only recognize old records; they do not rewrite request destinations.

## Server database and other addresses

The service reads private dotenv configuration: `.env` in the working directory by default, or an explicit file selected before process startup:

```powershell
$env:IPOLLO_CONFIG_FILE = 'C:\company-config\ipollowork.env'
npm start
```

The same loader covers migrate, admin, backup and import:sqlite. Do not rely on recursively selecting another file from inside an unread file. A missing explicit file fails before database initialization. Process/container variables override file values. Restart the service after changes; live requests never hot-switch databases.

| Address | Configuration | Consumer |
| --- | --- | --- |
| Account database | DATABASE_URL / DATABASE_SCHEMA | API and operator commands |
| App-data database | APP_DATA_DATABASE_URL / APP_DATA_DATABASE_SCHEMA | Separate app data; optional |
| Public service origin | SERVICE_ORIGIN | Login, cookies, invitations and callback links |
| Listener | HOST / PORT | HTTP listener; examples use container port 4785 |
| Publication origin | PUBLICATION_ORIGIN | Published pages isolated from account origin |
| Company mail bridge | MAIL_WEBHOOK_URL / MAIL_WEBHOOK_TOKEN | Server-only mail delivery |
| Private OSS | Platform Settings → Alibaba OSS; OSS_RAM_ROLE for ECS | Region, bucket and storage identity |
| Execution gateway | Platform Settings → Cloud execution gateway | Validated origin, key and leases; disabled by default |
| Stage | Platform Settings → Stage | Origin, activation and pricing |
| Model APIs | Service center | Provider/workspace connections, models and prices |
| Electron updates | DSH_DESKTOP_UPDATE_URL and mandatory-update settings | Independent of account origin |
| Cloud executor | Suite deploy/cloud configuration | Sandbox API, OSS endpoint, role, template and account origin |

Provider SDK production/sandbox protocol endpoints and pricing-document links are provider defaults, not company deployment destinations. Do not replace them with the account hostname. Supported provider connections remain configurable through Service center/payment settings.

## Docker boundaries

Use `services/ipollowork/deploy/compose.external.yml` for RDS/company databases: selected file values for both database URLs remain authoritative. The bundled-database `compose.yml` deliberately constructs a local container URL and depends on local PostgreSQL; do not assume its DATABASE_URL comes from `.env`.

External deployment defaults to the service directory's `.env`. Select another host file with an absolute path:

```powershell
$env:IPOLLO_ENV_FILE = 'C:\company-config\ipollowork.env'
docker compose --env-file $env:IPOLLO_ENV_FILE -f deploy/compose.external.yml config --quiet
docker compose --env-file $env:IPOLLO_ENV_FILE -f deploy/compose.external.yml up -d --build
```

Compose `--env-file` controls interpolation; IPOLLO_ENV_FILE selects container injection. Use the same file for both. Raw `docker run --env-file` is also supported. Container-side IPOLLO_CONFIG_FILE needs its path mounted. Never include database passwords, AUTH_SECRET, mail tokens or provider keys in desktop settings or image layers.

URL-encode reserved characters in database passwords. Account and app-data stores must not share both database and schema. Retain the original key and data volumes on upgrade. See [service handoff](../services/ipollowork/HANDOFF.md).
