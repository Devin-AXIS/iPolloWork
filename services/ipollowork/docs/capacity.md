# PostgreSQL capacity sample

The reproducible command is `TEST_DATABASE_URL=postgresql://127.0.0.1:5432/ipollowork_test npm run bench:database`. It creates and removes its own schema and leaves working data untouched. Run against a dedicated test database.

A local run on 2026-11-14 used Apple M5, Node 25.8.1 and PostgreSQL 15.13. The workload contained 500,000 users, 1,000 organizations, 500,000 memberships, 100,000 projects, 100,000 file-index rows and 500,200 ledger rows.

| Measurement | Observed result |
| --- | --- |
| Seed time | 14.66 s |
| Wallet and membership reads, concurrency 50, P95 | 10.83 ms |
| Atomic wallet writes, concurrency 20, P95 | 4.46 ms |
| Database size | About 854 MiB |
| Node resident memory | About 161 MiB |

These numbers measure indexed SQL access and row-locked writes, not 500,000 simultaneous users, HTTP authentication, OSS transfers, model throughput or WebSocket fan-out. Production sizing needs the expected active-user ratio, request rate, server resources, connection-pool budget and regional latency. Use managed PostgreSQL backups and monitoring for online operation. The process-local native relay remains a separate scaling constraint.
