/** Synthetic database capacity measurement. Never reads or writes the service's real database. */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { loadConfig } from "../src/config.js";
import { createService } from "../src/app.js";
import { wallet, ledgerEntry } from "../src/domain.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test"))
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated database ending in _test",
  );
const schema = "bench_" + randomUUID().replaceAll("-", ""),
  pool = new Pool({ connectionString: databaseUrl });
const dir = await mkdtemp(join(tmpdir(), "ipw-capacity-"));
await pool.query(`CREATE SCHEMA ${schema}`);
const service = await createService(
  loadConfig({
    DATABASE_URL: databaseUrl,
    DATABASE_SCHEMA: schema,
    DATABASE_POOL_SIZE: "20",
    DATA_DIR: dir,
  }),
);
try {
  const { store } = service,
    start = performance.now();
  await store.run(
    `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") SELECT 'bench-'||i,'Person '||i,'person-'||i||'@example.test',false,now(),now() FROM generate_series(1,500000) i`,
  );
  await store.run(
    "INSERT INTO enterprises SELECT 'org-'||i,'Organization '||i,'bench-1',0 FROM generate_series(1,1000) i",
  );
  await store.run(
    "INSERT INTO members SELECT 'org-'||((i-1)%1000+1),'bench-'||i,'member',NULL,0 FROM generate_series(1,500000) i",
  );
  await store.run(
    "INSERT INTO projects(id,owner_id,enterprise_id,title,created_at) SELECT 'project-'||i,'bench-1','org-'||((i-1)%1000+1),'Project '||i,i FROM generate_series(1,100000) i",
  );
  await store.run(
    "INSERT INTO wallets SELECT 'bench-'||i,1000,1000,0 FROM generate_series(1,500000) i",
  );
  await store.run(
    "INSERT INTO ledger(id,user_id,amount,balance_after,reference,reason,created_at) SELECT 'ledger-'||i,'bench-'||i,1000,1000,'reference-'||i,'Fixture',i FROM generate_series(1,500000) i",
  );
  await store.run(
    "INSERT INTO resources SELECT 'file-'||i,'bench-1','org-'||((i-1)%1000+1),'attachment','private','File '||i,'','1','oss/fixture-'||i,'text/plain',1024,'fixture',i FROM generate_series(1,100000) i",
  );
  await store.run("ANALYZE");
  const seedMs = Math.round(performance.now() - start),
    samples: number[] = [];
  for (let batch = 0; batch < 20; batch++)
    await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const n = ((batch * 7919 + i * 997) % 500000) + 1,
          then = performance.now();
        await wallet(store, "bench-" + n);
        await store.one(
          "SELECT role FROM members WHERE enterprise_id=? AND user_id=?",
          "org-" + (((n - 1) % 1000) + 1),
          "bench-" + n,
        );
        samples.push(performance.now() - then);
      }),
    );
  const writes: number[] = [];
  for (let batch = 0; batch < 10; batch++)
    await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const n = batch * 20 + i + 1,
          then = performance.now();
        await store.transaction(() =>
          ledgerEntry(store, "bench-" + n, -1, "debit-" + n, "Fixture"),
        );
        writes.push(performance.now() - then);
      }),
    );
  samples.sort((a, b) => a - b);
  writes.sort((a, b) => a - b);
  const size = await store.one(
    "SELECT SUM(pg_total_relation_size(c.oid)) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()",
  );
  console.log(
    JSON.stringify(
      {
        users: 500000,
        organizations: 1000,
        projects: 100000,
        files: 100000,
        ledger: 500200,
        seedMs,
        readConcurrency: 50,
        readPairP50Ms: samples[500],
        readPairP95Ms: samples[950],
        writeConcurrency: 20,
        debitP95Ms: writes[190],
        databaseBytes: size?.bytes,
        nodeRssBytes: process.memoryUsage().rss,
        cpu: cpus()[0]?.model,
      },
      null,
      2,
    ),
  );
} finally {
  await service.close();
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
  await rm(dir, { recursive: true, force: true });
}
