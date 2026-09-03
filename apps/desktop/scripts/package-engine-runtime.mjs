import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function targetPlatform() {
  const target = process.env.TARGET?.trim() || "";
  if (target.includes("apple-darwin")) return "macos";
  if (target.includes("windows-msvc")) return "windows";
  if (target.includes("linux")) return "linux";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return process.platform;
}

function targetArch() {
  const target = process.env.TARGET?.trim() || "";
  if (target.startsWith("aarch64-")) return "arm64";
  if (target.startsWith("x86_64-")) return "x64";
  return process.arch;
}

function run(command, args, cwd = desktopRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readRuntimeVersion(engineId) {
  const manifestPath = engineId === "deepseek-harness"
    ? resolve(desktopRoot, "dsh-runtime", "package.json")
    : resolve(desktopRoot, "codex-runtime", "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return engineId === "deepseek-harness"
    ? manifest.dependencies?.["@deepseek-ai/dsh"]
    : manifest.dependencies?.["@openai/codex"];
}

async function sha256File(targetPath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(targetPath)) hash.update(chunk);
  return hash.digest("hex");
}

async function packageEngine(engineId, outputDirectory) {
  const isDsh = engineId === "deepseek-harness";
  const runtimeDirectoryName = isDsh ? "dsh-runtime" : "codex-runtime";
  const prepareScript = isDsh ? "prepare-dsh-runtime.mjs" : "prepare-codex-runtime.mjs";
  const runtimeRoot = resolve(desktopRoot, runtimeDirectoryName);
  run(process.execPath, [resolve(__dirname, prepareScript)]);
  if (isDsh) {
    run(process.execPath, ["--test", resolve(desktopRoot, "electron", "dsh-host-tools.test.mjs")]);
  }

  const version = readRuntimeVersion(engineId);
  if (!version) throw new Error(`Could not resolve ${engineId} version.`);
  const name = `ipollowork-engine-${engineId}-${targetPlatform()}-${targetArch()}-${version}.tar.gz`;
  const archivePath = resolve(outputDirectory, name);
  const entries = ["package.json", "node_modules"];
  if (isDsh) entries.push("ipollowork-host-tools.mjs", "node-runtime");
  for (const entry of entries) {
    if (!existsSync(resolve(runtimeRoot, entry))) throw new Error(`Missing engine runtime entry: ${entry}`);
  }
  run("tar", ["-czf", name, "-C", runtimeRoot, ...entries], outputDirectory);
  const checksum = await sha256File(archivePath);
  writeFileSync(`${archivePath}.sha256`, `${checksum}  ${name}\n`);
  process.stdout.write(`[engine-package] ${archivePath}\n`);
}

const requested = argumentValue("--engine");
const outputDirectory = resolve(argumentValue("--outdir") || resolve(desktopRoot, "dist-engine-packs"));
if (process.argv.includes("--clean")) await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const engineIds = process.argv.includes("--all")
  ? ["deepseek-harness", "codex-harness"]
  : requested
    ? [requested]
    : [];
if (engineIds.length === 0 || engineIds.some((id) => id !== "deepseek-harness" && id !== "codex-harness")) {
  throw new Error("Use --all or --engine deepseek-harness|codex-harness.");
}
for (const engineId of engineIds) await packageEngine(engineId, outputDirectory);
