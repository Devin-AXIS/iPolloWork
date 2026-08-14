import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stageServerConstants, stageServerRuntimeTypes } from "./server-packaging.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const electronSidecarDir = resolve(desktopRoot, "resources", "sidecars");
const electronHelperDir = resolve(desktopRoot, "resources", "helpers");
const electronRoot = resolve(desktopRoot, "electron");
const packagedServerRoot = resolve(desktopRoot, "server");
const runtimeTypesRoot = resolve(repoRoot, "packages", "types");
const hyperframesRoot = resolve(repoRoot, "vendor", "hyperframes");
const hyperframesBuildStamp = resolve(desktopRoot, ".hyperframes-build-stamp.json");
const hyperframesInstallStamp = resolve(desktopRoot, ".hyperframes-install-stamp.json");
const serverDistDir = resolve(repoRoot, "apps", "server", "dist");
const constantsSrc = resolve(repoRoot, "constants.json");

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const bunCmd = process.platform === "win32" ? "bun.exe" : "bun";
const nodeCmd = process.execPath;
const require = createRequire(import.meta.url);

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
    resolve(hyperframesRoot, "packages", "cli", "scripts", "build-copy.mjs"),
    resolve(hyperframesRoot, "packages", "studio", "package.json"),
    resolve(hyperframesRoot, "packages", "studio", "vite.config.ts"),
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

function bundleNodeModule(entry, output) {
  mkdirSync(dirname(output), { recursive: true });
  run(
    bunCmd,
    ["build", entry, "--outfile", output, "--target", "node", "--format", "esm", "--minify"],
    desktopRoot,
  );
  if (!existsSync(output) || statSync(output).size === 0) {
    throw new Error(`Failed to stage bundled Node module: ${output}`);
  }
}

function stageBundledOpenCodeRuntime() {
  const chromeEntry = fileURLToPath(import.meta.resolve("opencode-chrome-devtools"));
  const chromeRoot = resolve(dirname(chromeEntry), "..");
  const chromeDestinationRoot = resolve(
    serverDistDir,
    "opencode-plugins",
    "opencode-chrome-devtools",
  );
  bundleNodeModule(chromeEntry, resolve(chromeDestinationRoot, "dist", "plugin.js"));
  copyFileSync(resolve(chromeRoot, "package.json"), resolve(chromeDestinationRoot, "package.json"));

  const sdkEntry = fileURLToPath(import.meta.resolve("@opencode-ai/plugin"));
  const sdkRoot = resolve(dirname(sdkEntry), "..");
  const sdkPackage = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf8"));
  const expectedSdkVersion = JSON.parse(readFileSync(constantsSrc, "utf8"))
    .opencodeVersion.replace(/^v/, "");
  if (sdkPackage.version !== expectedSdkVersion) {
    throw new Error(
      `OpenCode plugin SDK ${sdkPackage.version} must match bundled OpenCode ${expectedSdkVersion}`,
    );
  }

  const runtimeRoot = resolve(serverDistDir, "opencode-runtime");
  const sdkDestinationRoot = resolve(runtimeRoot, "node_modules", "@opencode-ai", "plugin");
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(resolve(sdkDestinationRoot, "dist"), { recursive: true });
  bundleNodeModule(resolve(sdkRoot, "dist", "tool.js"), resolve(sdkDestinationRoot, "dist", "tool.js"));
  writeFileSync(resolve(sdkDestinationRoot, "dist", "index.js"), 'export * from "./tool.js";\n');
  for (const relativePath of [
    "dist/tui.js",
    "dist/v2/effect/index.js",
    "dist/v2/effect/integration.js",
    "dist/v2/effect/plugin.js",
    "dist/v2/promise/index.js",
    "dist/v2/promise/plugin.js",
  ]) {
    const destination = resolve(sdkDestinationRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(sdkRoot, relativePath), destination);
  }

  const runtimeSdkExports = Object.fromEntries(
    Object.entries(sdkPackage.exports).map(([name, value]) => [name, value.import]),
  );
  writeFileSync(
    resolve(sdkDestinationRoot, "package.json"),
    `${JSON.stringify({
      name: sdkPackage.name,
      version: sdkPackage.version,
      type: sdkPackage.type,
      license: sdkPackage.license,
      exports: runtimeSdkExports,
    }, null, 2)}\n`,
  );

  const pnpmLock = require("yaml").parse(readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8"));
  const sdkIntegrity = pnpmLock.packages?.[`@opencode-ai/plugin@${sdkPackage.version}`]?.resolution?.integrity;
  if (!sdkIntegrity) {
    throw new Error(`Missing @opencode-ai/plugin@${sdkPackage.version} integrity in pnpm-lock.yaml`);
  }
  const runtimeDependencies = { "@opencode-ai/plugin": sdkPackage.version };
  writeFileSync(
    resolve(runtimeRoot, "package.json"),
    `${JSON.stringify({ dependencies: runtimeDependencies }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(runtimeRoot, "package-lock.json"),
    `${JSON.stringify({
      name: "opencode",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { dependencies: runtimeDependencies },
        "node_modules/@opencode-ai/plugin": {
          version: sdkPackage.version,
          resolved: `https://registry.npmjs.org/@opencode-ai/plugin/-/plugin-${sdkPackage.version}.tgz`,
          integrity: sdkIntegrity,
        },
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(runtimeRoot, ".gitignore"),
    "node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore\n",
  );
}

run(pnpmCmd, ["--filter", "@ipollowork/app", "typecheck"], repoRoot);
run(nodeCmd, [resolve(__dirname, "prepare-sidecar.mjs"), "--force", "--outdir", electronSidecarDir], desktopRoot);
run(nodeCmd, [resolve(__dirname, "prepare-computer-use-helper.mjs"), "--force", "--outdir", electronHelperDir], desktopRoot);
// Build the server TS → JS so Electron can import it in-process
ensureHyperframesBuild();
run(nodeCmd, [resolve(__dirname, "prepare-hyperframes-runtime.mjs")], desktopRoot);
run(pnpmCmd, ["--filter", "ipollowork-server", "build"], repoRoot);
stageBundledOpenCodeRuntime();
// IPOLLOWORK_ELECTRON_BUILD tells Vite to emit relative asset paths so
// index.html resolves /assets/* correctly when loaded via file:// from
// inside the packaged .app bundle.
run(pnpmCmd, ["--filter", "@ipollowork/app", "build"], repoRoot, {
  IPOLLOWORK_ELECTRON_BUILD: "1",
});
run(nodeCmd, [resolve(__dirname, "validate-renderer-assets.mjs")], repoRoot);
// Copy constants.json next to server dist and patch every compiled root module
// that still points at the repository root. Imports cannot escape app.asar.
stageServerConstants({ serverDistDir, constantsSrc });
stageServerRuntimeTypes({ serverDistDir, runtimeTypesDistDir: resolve(runtimeTypesRoot, "dist") });
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
