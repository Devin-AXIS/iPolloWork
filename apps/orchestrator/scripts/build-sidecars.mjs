import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..");
const outdir = resolve(root, "dist", "sidecars");

const orchestratorPkg = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const orchestratorVersion = String(orchestratorPkg.version ?? "").trim();
if (!orchestratorVersion) {
  throw new Error(
    "ipollowork-orchestrator version missing in apps/orchestrator/package.json",
  );
}

const fallbackSourceDateEpoch = Number.parseInt(
  createHash("sha256").update(orchestratorVersion).digest("hex").slice(0, 8),
  16,
);
const configuredSourceDateEpoch = process.env.SOURCE_DATE_EPOCH
  ? Number(process.env.SOURCE_DATE_EPOCH)
  : NaN;
const sourceDateEpoch = Number.isFinite(configuredSourceDateEpoch)
  ? configuredSourceDateEpoch
  : fallbackSourceDateEpoch;
const generatedAt = new Date(sourceDateEpoch * 1000).toISOString();

const serverPkg = JSON.parse(
  readFileSync(resolve(repoRoot, "apps", "server", "package.json"), "utf8"),
);
const serverVersion = String(serverPkg.version ?? "").trim();
if (!serverVersion) {
  throw new Error(
    "ipollowork-server version missing in apps/server/package.json",
  );
}

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run("pnpm", ["--filter", "ipollowork-server", "build:bin:all"], repoRoot);

const targets = [
  { id: "darwin-arm64", bun: "bun-darwin-arm64" },
  { id: "darwin-x64", bun: "bun-darwin-x64" },
  { id: "linux-x64", bun: "bun-linux-x64" },
  { id: "linux-arm64", bun: "bun-linux-arm64" },
  { id: "windows-x64", bun: "bun-windows-x64" },
  { id: "windows-arm64", bun: "bun-windows-arm64" },
];

const sha256File = (path) => {
  const data = readFileSync(path);
  return createHash("sha256").update(data).digest("hex");
};

const serverDir = resolve(repoRoot, "apps", "server", "dist", "bin");

mkdirSync(outdir, { recursive: true });

const entries = {
  "ipollowork-server": { version: serverVersion, targets: {} },
};

for (const target of targets) {
  const ext = target.id.startsWith("windows") ? ".exe" : "";
  const serverSrc = join(serverDir, `ipollowork-server-${target.bun}${ext}`);
  if (!existsSync(serverSrc)) {
    throw new Error(`Missing ipollowork-server binary at ${serverSrc}`);
  }
  const serverDest = join(outdir, `ipollowork-server-${target.id}${ext}`);
  copyFileSync(serverSrc, serverDest);

  entries["ipollowork-server"].targets[target.id] = {
    asset: basename(serverDest),
    sha256: sha256File(serverDest),
    size: statSync(serverDest).size,
  };
}

const manifest = {
  version: orchestratorVersion,
  generatedAt,
  entries,
};

writeFileSync(
  join(outdir, "ipollowork-orchestrator-sidecars.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
