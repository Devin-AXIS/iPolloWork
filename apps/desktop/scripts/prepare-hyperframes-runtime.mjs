import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");
const sourceRoot = resolve(repoRoot, "vendor", "hyperframes");
const runtimeRoot = resolve(desktopRoot, "hyperframes-runtime");
const stampPath = resolve(runtimeRoot, ".runtime-stamp.json");
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";
const runtimeFormatVersion = 4;

const cliRuntimeResources = ["bin", "dist"];

// packages/cli/tsup.config.ts bundles HyperFrames workspace packages into
// dist/cli.js via noExternal. The CLI package's normal dependencies are the
// runtime externals that remain after bundling.
const runtimeDependencyBlocklist = new Set([
  "puppeteer",
]);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    env: {
      ...process.env,
      PUPPETEER_SKIP_DOWNLOAD: "1",
      PUPPETEER_SKIP_CHROME_DOWNLOAD: "1",
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function hashPath(hash, filePath, relativePath) {
  if (!existsSync(filePath)) return;
  const info = statSync(filePath);
  if (info.isDirectory()) {
    for (const entry of readdirSync(filePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      hashPath(hash, resolve(filePath, entry.name), `${relativePath}/${entry.name}`);
    }
    return;
  }
  hash.update(relativePath);
  hash.update("\0");
  hash.update(readFileSync(filePath));
  hash.update("\0");
}

function runtimeKey() {
  const hash = createHash("sha256");
  hash.update(`runtime-format:${runtimeFormatVersion}\0`);
  for (const fileName of ["package.json", "bun.lock", "LICENSE"]) {
    hashPath(hash, resolve(sourceRoot, fileName), fileName);
  }
  const cliPackageRoot = resolve(sourceRoot, "packages", "cli");
  hashPath(hash, resolve(cliPackageRoot, "package.json"), "packages/cli/package.json");
  for (const resource of cliRuntimeResources) {
    hashPath(hash, resolve(cliPackageRoot, resource), `packages/cli/${resource}`);
  }
  return hash.digest("hex");
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function copyPath(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(dirname(destination), { recursive: true });
  const info = statSync(source);
  if (info.isDirectory()) cpSync(source, destination, { recursive: true });
  else copyFileSync(source, destination);
}

function runtimePackageJson() {
  const sourcePackage = JSON.parse(readFileSync(resolve(sourceRoot, "package.json"), "utf8"));
  const cliPackage = JSON.parse(
    readFileSync(resolve(sourceRoot, "packages", "cli", "package.json"), "utf8"),
  );
  const sourceDependencies = {
    ...(cliPackage.dependencies ?? {}),
    ...(cliPackage.optionalDependencies ?? {}),
  };
  const dependencies = Object.fromEntries(
    Object.entries(sourceDependencies).filter(([name]) => !runtimeDependencyBlocklist.has(name)),
  );
  return {
    name: "ipollowork-hyperframes-runtime",
    private: true,
    type: "module",
    dependencies,
    resolutions: sourcePackage.resolutions,
    overrides: sourcePackage.overrides,
  };
}

const key = runtimeKey();
if (readStamp()?.key === key && existsSync(resolve(runtimeRoot, "node_modules"))) {
  console.log("HyperFrames packaged runtime is up to date; skipping staging.");
  process.exit(0);
}

console.log("Preparing slim HyperFrames packaged runtime...");
rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });
copyPath(resolve(sourceRoot, "LICENSE"), resolve(runtimeRoot, "LICENSE"));

const sourceCliRoot = resolve(sourceRoot, "packages", "cli");
const runtimeCliRoot = resolve(runtimeRoot, "packages", "cli");
copyPath(resolve(sourceCliRoot, "package.json"), resolve(runtimeCliRoot, "package.json"));
for (const resource of cliRuntimeResources) {
  copyPath(resolve(sourceCliRoot, resource), resolve(runtimeCliRoot, resource));
}

writeFileSync(resolve(runtimeRoot, "package.json"), `${JSON.stringify(runtimePackageJson(), null, 2)}\n`);
run(bunCommand, ["install", "--production", "--ignore-scripts", "--no-progress"], runtimeRoot);

// Electron supplies its own verified ffmpeg/ffprobe binaries to HyperFrames.
for (const packageName of ["ffmpeg-static", "ffprobe-static"]) {
  rmSync(resolve(runtimeRoot, "node_modules", packageName), { recursive: true, force: true });
  const bunRoot = resolve(runtimeRoot, "node_modules", ".bun");
  if (existsSync(bunRoot)) {
    for (const entry of readdirSync(bunRoot)) {
      if (entry.startsWith(`${packageName}@`)) {
        rmSync(resolve(bunRoot, entry), { recursive: true, force: true });
      }
    }
  }
}

writeFileSync(stampPath, `${JSON.stringify({ key, updatedAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`HyperFrames packaged runtime ready: ${runtimeRoot}`);
