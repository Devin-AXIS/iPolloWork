/** Operator-run import; the target database must be empty and the SQLite writer stopped. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createAuth } from "../src/auth.js";
import { Store, migrate } from "../src/database.js";
import { importSqlite } from "../src/import-sqlite.js";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.argv[2])
  throw new Error("Usage: npm run import:sqlite -- /absolute/path/work.sqlite");
const config = loadConfig();
const store = new Store(config);
try {
  await createAuth(config, store);
  await migrate(store, config);
  const counts = await importSqlite(store, resolve(process.argv[2]), config);
  console.log(JSON.stringify({ imported: counts, verified: true }));
} finally {
  await store.close();
}
