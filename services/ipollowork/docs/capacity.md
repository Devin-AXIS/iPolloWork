# PostgreSQL capacity sample

## HTTP admission for the 100-user trial

Employees run Agent and Electron on their own computers. The shared service handles identity, metadata, model/MCP forwarding, private OSS and publications. This budget does not cover hosting 100 Agent processes, local models or video rendering on one ECS instance.

The default process admits 32 control requests, 2 password operations, 8 model/capability calls, 4 transfers and 128 MCP transports independently. Each lane has at most 160 waiting requests. Control requests wait up to 5 seconds, password operations 20 seconds, and model/transfers 120 seconds; exceeding the bound returns `503` with `Retry-After`. Waiting requests do not reserve credits or submit provider jobs. Client cancellation removes waiting work and cancels forwarded model requests. There is no automatic replay of an uncertain paid call.

`/api/health` checks the process. `/api/ready` checks PostgreSQL and draining. Authenticated administrators can inspect `/api/v1/admin/runtime` for queue, memory, event-loop and database-pool counts; it contains no credentials or request bodies. Configure external availability, memory, disk, PostgreSQL and queue alerts. A single ECS and its local database remain a single point of failure.

Run `TEST_DATABASE_URL=... npm run bench:http` against a dedicated test database. It creates/removes a randomly named schema, starts the real HTTP service in a child limited to a 768 MiB V8 heap, seeds 120 synthetic accounts and invokes a local mock provider. A Windows run on November 19, 2026 passed 120 simultaneous shared-IP logins, 360 authenticated metadata reads, 120 model calls and identical-request replay without duplicate charges. Observed durations were 5.469 s for logins, 1.797 s for browsing and 6.353 s for model calls; maximum model concurrency was 8, 112 calls queued, peak service RSS was 256 MiB and health P95 was 7 ms. The mock provider delayed each response 350 ms. The host had 4 physical cores/16 GB RAM and PostgreSQL 18. These are functional overload checks, not 2-core/4-GB Linux capacity certification, real model-provider throughput or a sustained soak test.

For a new 2-core/4-GB trial host, [the optional Compose budget](../deploy/compose.beta-2c4g.yml) caps Work at 1536 MiB, PostgreSQL at 768 MiB and Caddy at 128 MiB, with pools of 8 and 4. Rehearse that exact image, proxy, OSS region and workload on the target host. Keep the existing 4-core/8-GB host for initial launch when possible. Use private same-region OSS, external database backups and restore drills, disk/availability alerts, and model-provider RPM/TPM/concurrency limits suitable for the trial. Public media traffic may need OSS/CDN offload; 100 accounts do not imply 100 simultaneous video downloads fit the ECS link. Build images in CI or a separate build machine.

See [中文](capacity.zh.md) for the trial deployment notes.

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
