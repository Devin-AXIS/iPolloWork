# Storage and deployment

This reference describes service-owned metadata and objects. Native DSH workspaces, input attachments and complete local conversation state remain outside cloud retention.

## Ownership and lifetime

Each object has one personal or organization owner, its exact byte count, project reference and state. PostgreSQL reserves bytes under an owner row lock before upload. A completed object becomes used capacity only once; metadata attachment shares the resource transaction. Failed or abandoned uploads release capacity after confirmed object deletion. A staged upload expires after `UPLOAD_RESERVATION_MS`; a server-side cleanup pass runs every `STORAGE_CLEANUP_INTERVAL_MS`.

| Output owner | Default quota | Retention |
| --- | --- | --- |
| Personal, unpublished project | 200 GiB | Seven days from upload |
| Personal, published project | Same personal quota | Retained |
| Organization | 500 GiB | Retained |

Administrators change a user's or organization's capacity on its detail page. A limit cannot fall below used plus reserved bytes. Project publication preserves current unexpired outputs and subsequent uploads; it does not grant public access or deploy a website. Expiry removes only the cloud/cache copy, keeping file-version metadata. It never accepts a native workspace path for deletion. Expired downloads return HTTP 410. Existing files imported from older services remain retained to avoid destructive migration.

The raw artifact endpoint accepts only `kind: output`, relative paths, declared byte length, request ID and optional native session/turn. It validates permission before reading bytes and before committing metadata. Idempotency checks the content hash and immutable version; local file changes during a native upload fail that attempt. Turn outputs are observed through native presentation, not by scanning input directories. Legacy explicit file submissions remain available.

## PostgreSQL and OSS

Set `DATABASE_URL` to a dedicated PostgreSQL 15+ database; `DATABASE_POOL_SIZE` bounds each process. Business migrations use `service_schema`. Authentication tables belong to Better Auth. Wallet, order, project and quota locks serialize conflicting mutations; read queries do not lock unrelated accounts. Store only metadata and the small current accepted memory in PostgreSQL. Original contribution text and accepted memory history use private objects.

Configure region, bucket and access credentials under administrator Settings → OSS. Production objects use private ACLs and authorized short-lived signed downloads. No provider keys are embedded in the plugin. Public origins require OSS by default; `REQUIRE_OSS=false` is a deliberate development override. Local cache mode writes only `DATA_DIR/files`.

The Compose database has no published port. Use a URL-safe random `POSTGRES_PASSWORD`, retain both volumes and terminate HTTPS with the supplied proxy configuration. For managed PostgreSQL, use its TLS connection URL and omit the Compose database. The relay's live WebSockets still require a single owner process; database capacity does not make independent relay replicas interchangeable.

## Migration and backup

1. Stop the old service writer. Back up its SQLite database, `DATA_DIR`, authentication secret and encrypted settings together. Keep the original files untouched.
2. Create an empty PostgreSQL database. Preserve `DATA_DIR` and set `DATABASE_URL`; retain the existing hostname and authentication secret to preserve login sessions.
3. Run `npm run import:sqlite -- /absolute/path/work.sqlite`. The importer snapshots SQLite versions 1–8, verifies integrity, applies historical migrations only to the temporary snapshot and imports in one transaction. A nonempty target is rejected. It verifies table counts and the total ledger balance and adopts file quotas without moving files.
4. Start the service, check `/api/health`, sign in with an existing account, and verify organizations, balance and a private file download. Do not point the retired SQLite service at new writes after switching traffic.

`npm run backup -- /absolute/new/directory` runs `pg_dump --format=custom` and copies service-owned private files and the secret. Run it where a PostgreSQL client of the same or newer major version is installed and can reach the database. The slim application image does not include that client; managed deployments should use database-native backups. Restore dumps with `pg_restore` into a new database, restore the matching secret/data files, and restore OSS from its separate backup policy. Backup completion alone is not a restore test.
