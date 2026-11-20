# Service configuration files

All production entrypoints (server, migrate, admin, backup, import:sqlite) read `.env`, or the private dotenv named by the process variable `IPOLLO_CONFIG_FILE`. Process/container variables win. Missing explicit files fail before connecting to a database. Restart after changing configuration.

`DATABASE_URL` / `DATABASE_SCHEMA` configure the account store. `APP_DATA_DATABASE_URL` / `APP_DATA_DATABASE_SCHEMA` configure optional separate app data. Both cannot target the same database/schema. Passwords in URLs need percent encoding. Never expose either connection string in browser code.

Schemas default to `public`. Have the database administrator create and grant ownership/access to any custom schema before running application migrations; changing the schema setting does not create or copy a customer's data.

Other deployment addresses: `SERVICE_ORIGIN`, `HOST`, `PORT`, `PUBLICATION_ORIGIN`, and `MAIL_WEBHOOK_URL`. Platform administrators configure OSS region/bucket, cloud execution gateway and Stage in Settings; provider/workspace addresses belong to Service center. These encrypted database settings are runtime administration configuration, not desktop build settings.

For external PostgreSQL, use `deploy/compose.external.yml`. It defaults to `.env`; set the **host** variable `IPOLLO_ENV_FILE` to an absolute file path and pass the same file to Compose `--env-file` when selecting a different file. The bundled-database Compose file constructs its own local database URL. Container-side IPOLLO_CONFIG_FILE instead requires a mounted file.

The new Cloud gateway form defaults to disabled, validates HTTPS/loopback origin and lease limits, and requires a saved key of at least 32 characters before activation. Blank or masked secret edits retain the stored key. Account/database configuration is never changed by a web form.

See [handoff](../HANDOFF.md) for startup, backup, recovery and acceptance.
