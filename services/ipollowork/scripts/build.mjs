import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"], { stdio: "inherit" });
copyFileSync("src/schema-postgres.sql", "dist/server/schema-postgres.sql");
for (const version of [2, 3, 4, 5, 6, 7]) { const name = `migration-pg-${String(version).padStart(3,"0")}.sql`; copyFileSync(`src/${name}`, `dist/server/${name}`); }
for (let version = 2; version <= 8; version++) {
  const name = `migration-${String(version).padStart(3, "0")}.sql`;
  copyFileSync(`src/${name}`, `dist/server/${name}`);
}
copyFileSync("web/liveshare-carrier.js", "dist/server/liveshare-carrier.js");
copyFileSync("web/liveshare-carrier.LICENSE", "dist/server/liveshare-carrier.LICENSE");
execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { stdio: "inherit" });
