import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readdir, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const config = loadConfig();
const target = resolve(process.argv[2] ?? "out/backup-" + Date.now());
if (target === config.dataDir || target.startsWith(config.dataDir + "/"))
  throw new Error("Backups must be outside DATA_DIR.");
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
await mkdir(target, { recursive: false, mode: 0o700 });
const database = new URL(config.databaseUrl);
const dumpEnv = {
  ...process.env,
  PGHOST: database.hostname,
  PGPORT: database.port || "5432",
  PGUSER: decodeURIComponent(database.username),
  PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
};
for (const [option, variable] of Object.entries({
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  options: "PGOPTIONS",
})) {
  const value = database.searchParams.get(option);
  if (value) Reflect.set(dumpEnv, variable, value);
}
try {
  await promisify(execFile)(
    "pg_dump",
    ["--format=custom", "--no-owner", "--file=" + resolve(target, "work.dump")],
    { env: dumpEnv },
  );
} catch (error) {
  await rm(target, { recursive: true, force: true });
  throw new Error(
    "PostgreSQL backup failed. Check the database connection and pg_dump major version; no complete backup was written.",
  );
}
await chmod(resolve(target, "work.dump"), 0o600);
for (const file of await readdir(config.dataDir)) {
  if (file.startsWith("work.sqlite")) continue;
  await cp(resolve(config.dataDir, file), resolve(target, file), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
console.log(
  "PostgreSQL backup written to " +
    target +
    ". Back up private OSS objects and retain the deployment AUTH_SECRET separately.",
);
