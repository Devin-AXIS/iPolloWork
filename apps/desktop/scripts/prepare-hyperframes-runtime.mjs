import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
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
const runtimeFormatVersion = 7;

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

function runtimeKey(formatVersion = runtimeFormatVersion) {
  const hash = createHash("sha256");
  hash.update(`runtime-format:${formatVersion}\0`);
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

function materializeBunPackages(nodeModulesRoot) {
  const bunRoot = resolve(nodeModulesRoot, ".bun");
  if (!existsSync(bunRoot)) return;

  const materializeLink = (destination) => {
    if (!lstatSync(destination).isSymbolicLink()) return;
    const source = realpathSync(destination);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true, dereference: true });
  };

  // Bun may expose direct dependencies as junctions into .bun. Convert them
  // before removing the install store so packaged dependencies stay portable.
  for (const entry of readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (entry.name === ".bun" || entry.name === ".bin") continue;
    const entryPath = resolve(nodeModulesRoot, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory() && !lstatSync(entryPath).isSymbolicLink()) {
      for (const scopedEntry of readdirSync(entryPath)) {
        materializeLink(resolve(entryPath, scopedEntry));
      }
      continue;
    }
    materializeLink(entryPath);
  }

  const copyPackageIfMissing = (source, packageName) => {
    const destination = resolve(nodeModulesRoot, packageName);
    if (existsSync(destination)) return;
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, dereference: true });
  };

  for (const installEntry of readdirSync(bunRoot, { withFileTypes: true })) {
    if (!installEntry.isDirectory()) continue;
    const dependencyRoot = resolve(bunRoot, installEntry.name, "node_modules");
    if (!existsSync(dependencyRoot)) continue;
    for (const dependency of readdirSync(dependencyRoot, { withFileTypes: true })) {
      if (!dependency.isDirectory() || dependency.name === ".bin") continue;
      if (dependency.name.startsWith("@")) {
        const scopeRoot = resolve(dependencyRoot, dependency.name);
        for (const scopedPackage of readdirSync(scopeRoot, { withFileTypes: true })) {
          if (!scopedPackage.isDirectory()) continue;
          copyPackageIfMissing(
            resolve(scopeRoot, scopedPackage.name),
            `${dependency.name}/${scopedPackage.name}`,
          );
        }
        continue;
      }
      copyPackageIfMissing(resolve(dependencyRoot, dependency.name), dependency.name);
    }
  }

  rmSync(bunRoot, { recursive: true, force: true });
}

function pruneOnnxRuntimeBinaries(nodeModulesRoot) {
  const napiRoot = resolve(nodeModulesRoot, "onnxruntime-node", "bin", "napi-v6");
  const targetRoot = resolve(napiRoot, process.platform, process.arch);
  if (!existsSync(targetRoot)) return;

  for (const platformEntry of readdirSync(napiRoot, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) continue;
    const platformPath = resolve(napiRoot, platformEntry.name);
    if (platformEntry.name !== process.platform) {
      rmSync(platformPath, { recursive: true, force: true });
      continue;
    }
    for (const archEntry of readdirSync(platformPath, { withFileTypes: true })) {
      if (archEntry.isDirectory() && archEntry.name !== process.arch) {
        rmSync(resolve(platformPath, archEntry.name), { recursive: true, force: true });
      }
    }
  }
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

function cachedRuntimeMatches(expectedPackage) {
  try {
    const cachedPackage = JSON.parse(
      readFileSync(resolve(runtimeRoot, "package.json"), "utf8"),
    );
    if (
      JSON.stringify(cachedPackage.dependencies ?? {}) !== JSON.stringify(expectedPackage.dependencies)
      || JSON.stringify(cachedPackage.resolutions ?? {}) !== JSON.stringify(expectedPackage.resolutions)
      || JSON.stringify(cachedPackage.overrides ?? {}) !== JSON.stringify(expectedPackage.overrides)
    ) {
      return false;
    }
    return Object.keys(expectedPackage.dependencies).every((packageName) => (
      existsSync(resolve(runtimeRoot, "node_modules", packageName, "package.json"))
    ));
  } catch {
    return false;
  }
}

const key = runtimeKey();
// The installed app merges the separately packaged registry into the same
// resources/hyperframes directory. A cached runtime restored from there can
// therefore contain a stale registry copy. electron-builder also stages the
// source registry separately, and two concurrent writers to the same Windows
// destination intermittently fail with EBUSY.
rmSync(resolve(runtimeRoot, "registry"), { recursive: true, force: true });

if (readStamp()?.key === key && existsSync(resolve(runtimeRoot, "node_modules"))) {
  console.log("HyperFrames packaged runtime is up to date; skipping staging.");
  process.exit(0);
}

const expectedRuntimePackage = runtimePackageJson();
if (cachedRuntimeMatches(expectedRuntimePackage)) {
  console.log("Migrating cached HyperFrames runtime to a packaged-safe layout...");
  copyPath(resolve(sourceRoot, "LICENSE"), resolve(runtimeRoot, "LICENSE"));
  const sourceCliRoot = resolve(sourceRoot, "packages", "cli");
  const runtimeCliRoot = resolve(runtimeRoot, "packages", "cli");
  copyPath(resolve(sourceCliRoot, "package.json"), resolve(runtimeCliRoot, "package.json"));
  for (const resource of cliRuntimeResources) {
    rmSync(resolve(runtimeCliRoot, resource), { recursive: true, force: true });
    copyPath(resolve(sourceCliRoot, resource), resolve(runtimeCliRoot, resource));
  }
  materializeBunPackages(resolve(runtimeRoot, "node_modules"));
  pruneOnnxRuntimeBinaries(resolve(runtimeRoot, "node_modules"));
  writeFileSync(resolve(runtimeRoot, "package.json"), `${JSON.stringify(expectedRuntimePackage, null, 2)}\n`);
  run(
    process.execPath,
    ["--input-type=module", "--eval", 'await Promise.all([import("fontkit"), import("onnxruntime-node")])'],
    runtimeRoot,
  );
  writeFileSync(stampPath, `${JSON.stringify({ key, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`HyperFrames cached runtime migrated: ${runtimeRoot}`);
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

writeFileSync(resolve(runtimeRoot, "package.json"), `${JSON.stringify(expectedRuntimePackage, null, 2)}\n`);
// electron-builder dereferences directory links in extraResources. Bun's
// isolated linker keeps transitive dependencies beside the linked package,
// so dereferencing can strand dependencies such as fontkit -> restructure.
// A hoisted runtime remains resolvable after electron-builder copies it.
run(
  bunCommand,
  ["install", "--production", "--ignore-scripts", "--no-progress", "--linker", "hoisted"],
  runtimeRoot,
);
materializeBunPackages(resolve(runtimeRoot, "node_modules"));
pruneOnnxRuntimeBinaries(resolve(runtimeRoot, "node_modules"));
run(
  process.execPath,
  ["--input-type=module", "--eval", 'await Promise.all([import("fontkit"), import("onnxruntime-node")])'],
  runtimeRoot,
);

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
