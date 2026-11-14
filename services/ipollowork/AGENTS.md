# iPolloWork services

This independent account, billing and collaboration service uses PostgreSQL for metadata and private Alibaba OSS for production objects. Do not import DSH, the old Cloud runtime, Next.js or a worker provisioner. Local development may use the service-owned file cache; never manage native workspace files through cloud retention.

Keep authentication in Better Auth. Validate requests, check current organization and project permissions, and keep orders, credit reservations, quotas and file metadata atomic and idempotent. Provider credentials remain server-side. Do not trust client payment results or usage claims.

Use strict TypeScript and ESM. Run `npm run check`, `npm run build` and focused HTTP/persistence checks. Business schema versions increase monotonically in `service_schema`; preserve committed SQLite generations for the explicit importer. Back up PostgreSQL and the authentication secret before migration. Never overwrite a customer database.

SQLite import is an operator command into an empty target. Preserve identities, password hashes, sessions, balances and file ownership. Never log credentials or customer content. Use separate PostgreSQL schemas for tests.

For local reviews, follow the [single-preview workflow](../../plugins/ipollowork-suite/AGENTS.md#preview-handoff).
