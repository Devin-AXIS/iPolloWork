import { DatabaseSync, backup } from "node:sqlite";
import { cp, mkdir, readdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const config = loadConfig();
const target = resolve(process.argv[2] ?? "out/backup-" + Date.now());
if (target === config.dataDir || target.startsWith(config.dataDir + "/")) throw new Error("Backups must be outside DATA_DIR.");
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
await mkdir(target, { recursive: false, mode: 0o700 });
const db = new DatabaseSync(resolve(config.dataDir, "work.sqlite"), { readOnly: true });
try { await backup(db, resolve(target, "work.sqlite")); } finally { db.close(); }
await chmod(resolve(target, "work.sqlite"), 0o600);
for (const file of await readdir(config.dataDir)) {
  if (file.startsWith("work.sqlite")) continue;
  await cp(resolve(config.dataDir, file), resolve(target, file), { recursive: true, errorOnExist: true, force: false });
}
console.log("Backup written to " + target + ". Keep the deployment AUTH_SECRET with this backup when set externally.");
