import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(__dirname, "..", "dsh-runtime");
const manifestPath = resolve(runtimeRoot, "package.json");
const lockPath = resolve(runtimeRoot, "pnpm-lock.yaml");
const workspacePath = resolve(runtimeRoot, "pnpm-workspace.yaml");
const stampPath = resolve(runtimeRoot, ".install-stamp.json");
const cliPath = resolve(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const dshManifestPath = resolve(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json");
const nodeRuntimePath = resolve(runtimeRoot, "node-runtime", process.platform === "win32" ? "node.exe" : "node");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function nodeRuntimeSource() {
  const candidates = [
    process.env.IPOLLOWORK_NODE_BIN?.trim(),
    process.env.npm_node_execpath?.trim(),
    process.versions.electron ? null : process.execPath,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const resolved = realpathSync(candidate);
    if (!/electron(?:\.exe)?$/i.test(resolved)) return resolved;
  }
  throw new Error("A standard Node.js executable is required to package DeepSeek Harness.");
}

function stageNodeRuntime() {
  const source = nodeRuntimeSource();
  mkdirSync(dirname(nodeRuntimePath), { recursive: true });
  copyFileSync(source, nodeRuntimePath);
  if (process.platform !== "win32") chmodSync(nodeRuntimePath, 0o755);
  const probe = spawnSync(nodeRuntimePath, ["--version"], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0) {
    throw new Error("The staged Node.js executable cannot run independently. Set IPOLLOWORK_NODE_BIN to an official standalone Node.js distribution (not a Homebrew shared-library build).");
  }
}

function supportedArchitectures() {
  const target = process.env.TARGET?.trim() || "";
  const os = target.includes("apple-darwin")
    ? "darwin"
    : target.includes("windows-msvc")
      ? "win32"
      : target.includes("linux")
        ? "linux"
        : process.platform;
  const cpu = target.startsWith("aarch64-")
    ? "arm64"
    : target.startsWith("x86_64-")
      ? "x64"
      : process.arch;
  return { os: [os], cpu: [cpu] };
}

function installKey() {
  const hash = createHash("sha256");
  for (const filePath of [manifestPath, lockPath, workspacePath]) {
    hash.update(readFileSync(filePath));
  }
  hash.update(JSON.stringify(supportedArchitectures()));
  const source = nodeRuntimeSource();
  const sourceStat = statSync(source);
  hash.update(JSON.stringify({ source, size: sourceStat.size, mtimeMs: sourceStat.mtimeMs }));
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
if (existsSync(cliPath) && existsSync(nodeRuntimePath) && readJson(stampPath)?.key === key) {
  process.stdout.write("[dsh-runtime] Dependencies are up to date.\n");
  process.exit(0);
}

const install = spawnSync(
  pnpmCommand,
  ["--config.minimum-release-age=0", "install", "--frozen-lockfile", "--prod", "--node-linker=hoisted", "--ignore-scripts"],
  {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      CI: process.env.CI || "1",
      NPM_CONFIG_SUPPORTED_ARCHITECTURES: JSON.stringify(supportedArchitectures()),
    },
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
stageNodeRuntime();
writeFileSync(stampPath, `${JSON.stringify({ key, version: installedVersion }, null, 2)}\n`);
process.stdout.write(`[dsh-runtime] Prepared DeepSeek Harness ${installedVersion}.\n`);
