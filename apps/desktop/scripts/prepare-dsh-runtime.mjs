import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(__dirname, "..", "dsh-runtime");
const manifestPath = resolve(runtimeRoot, "package.json");
const lockPath = resolve(runtimeRoot, "pnpm-lock.yaml");
const workspacePath = resolve(runtimeRoot, "pnpm-workspace.yaml");
const subprocessPatchPath = resolve(
  runtimeRoot,
  "@deepseek-ai__dsh-subprocess-local@0.1.0-rc.6.patch",
);
const stampPath = resolve(runtimeRoot, ".install-stamp.json");
const cliPath = resolve(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const dshManifestPath = resolve(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function installKey() {
  const hash = createHash("sha256");
  for (const filePath of [manifestPath, lockPath, workspacePath, subprocessPatchPath]) {
    hash.update(readFileSync(filePath));
  }
  return hash.digest("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const key = installKey();
if (existsSync(cliPath) && readJson(stampPath)?.key === key) {
  process.stdout.write("[dsh-runtime] Dependencies are up to date.\n");
  process.exit(0);
}

const install = spawnSync(
  pnpmCommand,
  ["--config.minimum-release-age=0", "install", "--frozen-lockfile", "--prod", "--node-linker=hoisted", "--ignore-scripts"],
  {
    cwd: runtimeRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
if (install.status !== 0) process.exit(install.status ?? 1);
if (!existsSync(cliPath)) throw new Error(`DSH CLI was not installed at ${cliPath}`);

const expectedVersion = readJson(manifestPath)?.dependencies?.["@deepseek-ai/dsh"];
const installedVersion = readJson(dshManifestPath)?.version;
if (installedVersion !== expectedVersion) {
  throw new Error(`Expected DSH ${expectedVersion}, installed ${installedVersion ?? "unknown"}`);
}
writeFileSync(stampPath, `${JSON.stringify({ key, version: installedVersion }, null, 2)}\n`);
process.stdout.write(`[dsh-runtime] Prepared DeepSeek Harness ${installedVersion}.\n`);
