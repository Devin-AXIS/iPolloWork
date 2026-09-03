import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(__dirname, "..", "codex-runtime");
const manifestPath = resolve(runtimeRoot, "package.json");
const lockPath = resolve(runtimeRoot, "pnpm-lock.yaml");
const workspacePath = resolve(runtimeRoot, "pnpm-workspace.yaml");
const stampPath = resolve(runtimeRoot, ".install-stamp.json");
const cliPath = resolve(runtimeRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
const codexManifestPath = resolve(runtimeRoot, "node_modules", "@openai", "codex", "package.json");
const targetArch = process.env.TARGET?.startsWith("aarch64-")
  ? "arm64"
  : process.env.TARGET?.startsWith("x86_64-")
    ? "x64"
    : process.arch;
const windowsNativeCliPath = process.platform === "win32"
  ? resolve(
      runtimeRoot,
      "node_modules",
      "@openai",
      targetArch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64",
      "vendor",
      targetArch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    )
  : null;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function supportedArchitectures() {
  const target = process.env.TARGET?.trim() || "";
  const os = target.includes("apple-darwin")
    ? "darwin"
    : target.includes("windows-msvc")
      ? "win32"
      : target.includes("linux")
        ? "linux"
        : process.platform;
  return { os: [os], cpu: [targetArch] };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function installKey() {
  const hash = createHash("sha256");
  for (const filePath of [manifestPath, lockPath, workspacePath]) hash.update(readFileSync(filePath));
  hash.update(JSON.stringify(supportedArchitectures()));
  return hash.digest("hex");
}

const key = installKey();
if (
  existsSync(cliPath)
  && (!windowsNativeCliPath || existsSync(windowsNativeCliPath))
  && readJson(stampPath)?.key === key
) {
  process.stdout.write("[codex-runtime] Dependencies are up to date.\n");
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
if (!existsSync(cliPath)) throw new Error(`Codex CLI was not installed at ${cliPath}`);
if (windowsNativeCliPath && !existsSync(windowsNativeCliPath)) {
  throw new Error(`Codex native Windows runtime was not installed at ${windowsNativeCliPath}`);
}

const expectedVersion = readJson(manifestPath)?.dependencies?.["@openai/codex"];
const installedVersion = readJson(codexManifestPath)?.version;
if (installedVersion !== expectedVersion) {
  throw new Error(`Expected Codex ${expectedVersion}, installed ${installedVersion ?? "unknown"}`);
}
writeFileSync(stampPath, `${JSON.stringify({ key, version: installedVersion }, null, 2)}\n`);
process.stdout.write(`[codex-runtime] Prepared Codex Harness ${installedVersion}.\n`);
