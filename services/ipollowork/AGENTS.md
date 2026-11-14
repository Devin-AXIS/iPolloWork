# iPolloWork services

This independent commercial account and collaboration service runs as one Node.js process with SQLite and private files or OSS. Production must not import iPolloCloud, Next.js, PostgreSQL, a Worker provisioner, or DSH.

Keep authentication in Better Auth. Validate inputs, check enterprise membership per request, and keep payment, points and entitlement updates atomic and idempotent. Never accept a client-reported payment result. Private files require authorization; OSS objects remain private.

Use strict TypeScript and ESM. Changes require npm run check, npm run build and focused HTTP/persistence tests. Business migrations use monotonic PRAGMA user_version. Never overwrite customer databases.

Legacy import is an explicit administrator command, not a runtime dependency. Preserve user IDs, password hashes, plans and ledger history; do not import old login sessions. Never log credentials or customer data.

For local reviews, follow the [single-preview workflow](../../plugins/ipollowork-suite/AGENTS.md#preview-handoff).
