import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const electronSidecarDir = resolve(desktopRoot, "resources", "sidecars");
const electronHelperDir = resolve(desktopRoot, "resources", "helpers");
const electronRoot = resolve(desktopRoot, "electron");
const packagedServerRoot = resolve(desktopRoot, "server");
const hyperframesRoot = resolve(repoRoot, "vendor", "hyperframes");
const hyperframesBuildStamp = resolve(desktopRoot, ".hyperframes-build-stamp.json");
const hyperframesInstallStamp = resolve(desktopRoot, ".hyperframes-install-stamp.json");

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const bunCmd = process.platform === "win32" ? "bun.exe" : "bun";
const nodeCmd = process.execPath;

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: needsShell(command),
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveBunPackageDir(packagePrefix, packageName) {
  const bunRoot = resolve(hyperframesRoot, "node_modules", ".bun");
  if (!existsSync(bunRoot)) return null;
  const entry = readdirSync(bunRoot, { withFileTypes: true })
    .find((dirent) => dirent.isDirectory() && dirent.name.startsWith(packagePrefix));
  if (!entry) return null;
  const packageDir = resolve(bunRoot, entry.name, "node_modules", packageName);
  return existsSync(packageDir) ? packageDir : null;
}

function ensureHyperframesFfmpegBinary() {
  const ffmpegDir = resolveBunPackageDir("ffmpeg-static@", "ffmpeg-static");
  if (!ffmpegDir) {
    throw new Error("ffmpeg-static is missing from vendor/hyperframes dependencies.");
  }
  const binaryPath = resolve(ffmpegDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const probe = existsSync(binaryPath)
    ? spawnSync(binaryPath, ["-version"], { stdio: "ignore" })
    : null;
  if (probe?.status === 0) return;
  if (probe?.status !== 0) {
    rmSync(binaryPath, { force: true });
  }
  run(nodeCmd, ["install.js"], ffmpegDir, {
    npm_config_platform: process.platform,
    npm_config_arch: process.arch,
  });
  const verified = spawnSync(binaryPath, ["-version"], { stdio: "ignore" });
  if (verified.status !== 0) {
    throw new Error("ffmpeg-static installed, but the ffmpeg binary cannot run on this platform.");
  }
}

function newestMtimeMs(root) {
  if (!existsSync(root)) return 0;
  const stat = statSync(root);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    newest = Math.max(newest, newestMtimeMs(resolve(root, entry.name)));
  }
  return newest;
}

function hashFiles(paths) {
  const hash = createHash("sha256");
  for (const filePath of paths) {
    hash.update(filePath);
    hash.update("\0");
    hash.update(readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function currentHyperframesInstallKey() {
  return hashFiles([
    resolve(hyperframesRoot, "package.json"),
    resolve(hyperframesRoot, "bun.lock"),
    ...readdirSync(resolve(hyperframesRoot, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(resolve(hyperframesRoot, "packages", entry.name, "package.json")))
      .map((entry) => resolve(hyperframesRoot, "packages", entry.name, "package.json"))
      .sort(),
  ]);
}

function currentHyperframesBuildKey() {
  const hash = createHash("sha256");
  hash.update(hashFiles([
    resolve(hyperframesRoot, "package.json"),
    resolve(hyperframesRoot, "bun.lock"),
    resolve(hyperframesRoot, "packages", "cli", "package.json"),
    resolve(hyperframesRoot, "packages", "studio", "package.json"),
    resolve(hyperframesRoot, "packages", "studio-server", "package.json"),
  ]));
  for (const packageName of ["cli", "core", "engine", "lint", "parsers", "player", "producer", "sdk", "shader-transitions", "studio", "studio-server"]) {
    hash.update(`${packageName}:${newestMtimeMs(resolve(hyperframesRoot, "packages", packageName, "src"))}`);
  }
  return hash.digest("hex");
}

function hasHyperframesBuildOutputs() {
  return [
    resolve(hyperframesRoot, "packages", "cli", "dist", "cli.js"),
    resolve(hyperframesRoot, "packages", "cli", "dist", "runtimeVersion.js"),
    resolve(hyperframesRoot, "packages", "studio", "dist"),
    resolve(hyperframesRoot, "packages", "producer", "dist"),
  ].every(existsSync);
}

function readHyperframesBuildStamp() {
  try {
    return JSON.parse(readFileSync(hyperframesBuildStamp, "utf8"));
  } catch {
    return null;
  }
}

function readJsonStamp(stampPath) {
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function ensureHyperframesDependencies() {
  const key = currentHyperframesInstallKey();
  const hasDependencies = existsSync(resolve(hyperframesRoot, "node_modules", ".bun"));
  if (hasDependencies && readJsonStamp(hyperframesInstallStamp)?.key === key) {
    console.log("HyperFrames dependencies are up to date; skipping bun install.");
    return;
  }
  run(bunCmd, ["install", "--frozen-lockfile", "--ignore-scripts"], hyperframesRoot);
  writeFileSync(
    hyperframesInstallStamp,
    `${JSON.stringify({ key, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function ensureHyperframesBuild() {
  ensureHyperframesDependencies();
  ensureHyperframesFfmpegBinary();

  const beforeBuildKey = currentHyperframesBuildKey();
  const stamp = readHyperframesBuildStamp();
  if (stamp?.key === beforeBuildKey && hasHyperframesBuildOutputs()) {
    console.log("HyperFrames build is up to date; skipping build:local-studio.");
    return;
  }

  run(bunCmd, ["run", "build:local-studio"], hyperframesRoot);
  const afterBuildKey = currentHyperframesBuildKey();
  writeFileSync(
    hyperframesBuildStamp,
    `${JSON.stringify({ key: afterBuildKey, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

run(nodeCmd, [resolve(__dirname, "prepare-sidecar.mjs"), "--force", "--outdir", electronSidecarDir], desktopRoot);
run(nodeCmd, [resolve(__dirname, "prepare-computer-use-helper.mjs"), "--force", "--outdir", electronHelperDir], desktopRoot);
// Build the server TS → JS so Electron can import it in-process
ensureHyperframesBuild();
run(nodeCmd, [resolve(__dirname, "prepare-hyperframes-runtime.mjs")], desktopRoot);
run(pnpmCmd, ["--filter", "ipollowork-server", "build"], repoRoot);
// IPOLLOWORK_ELECTRON_BUILD tells Vite to emit relative asset paths so
// index.html resolves /assets/* correctly when loaded via file:// from
// inside the packaged .app bundle.
run(pnpmCmd, ["--filter", "@ipollowork/app", "build"], repoRoot, {
  IPOLLOWORK_ELECTRON_BUILD: "1",
});
run(nodeCmd, [resolve(__dirname, "validate-renderer-assets.mjs")], repoRoot);
// Copy constants.json next to server dist so the packaged asar can resolve it.
// Also patch the compiled import path so it works from both dev and packaged layouts.
const serverDistDir = resolve(repoRoot, "apps", "server", "dist");
const constantsSrc = resolve(repoRoot, "constants.json");
copyFileSync(constantsSrc, resolve(serverDistDir, "constants.json"));
const serverJsPath = resolve(serverDistDir, "server.js");
const serverJsSrc = readFileSync(serverJsPath, "utf8");
const patched = serverJsSrc.replace(
  /from\s+["']\.\.\/\.\.\/\.\.\/constants\.json["']/,
  'from "./constants.json"',
);
if (patched !== serverJsSrc) {
  writeFileSync(serverJsPath, patched, "utf8");
}
rmSync(packagedServerRoot, { recursive: true, force: true });
cpSync(serverDistDir, resolve(packagedServerRoot, "dist"), { recursive: true });
copyFileSync(resolve(repoRoot, "apps", "server", "package.json"), resolve(packagedServerRoot, "package.json"));
for (const fileName of readdirSync(electronRoot).filter((name) => name.endsWith(".mjs")).sort()) {
  run(nodeCmd, ["--check", resolve(electronRoot, fileName)], repoRoot);
}
run(nodeCmd, [resolve(__dirname, "check-electron-bridge.mjs")], repoRoot);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      renderer: "apps/app/dist",
      electronMain: "apps/desktop/electron/main.mjs",
      electronPreload: "apps/desktop/electron/preload.mjs",
    },
    null,
    2,
  )}\n`,
);
