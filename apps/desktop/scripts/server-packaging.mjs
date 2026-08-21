import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const REPO_CONSTANTS_IMPORT = /from\s+["']\.\.\/\.\.\/\.\.\/constants\.json["']/g;
const RUNTIME_TYPES_IMPORT = /(["'])@ipollowork\/types(?:\/([A-Za-z0-9._/-]+))?\1/g;
const STAGED_SERVER_DEPENDENCIES = new Set(["@ipollowork/types"]);

function javascriptFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...javascriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }
  return files;
}

function portablePath(filePath) {
  return filePath.split(sep).join("/");
}

export function assertServerRuntimeDependencies({ serverPackagePath, desktopPackagePath }) {
  const serverPackage = JSON.parse(readFileSync(serverPackagePath, "utf8"));
  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  const desktopDependencies = new Set(Object.keys(desktopPackage.dependencies ?? {}));
  const missing = Object.keys(serverPackage.dependencies ?? {})
    .filter((packageName) => !STAGED_SERVER_DEPENDENCIES.has(packageName) && !desktopDependencies.has(packageName))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `Electron runtime is missing server dependencies: ${missing.join(", ")}. `
        + "Add them to apps/desktop dependencies or explicitly stage them in server-packaging.mjs.",
    );
  }
  return [...desktopDependencies].sort();
}

export function stageServerConstants({ serverDistDir, constantsSrc }) {
  copyFileSync(constantsSrc, resolve(serverDistDir, "constants.json"));

  const patchedFiles = [];
  for (const entry of readdirSync(serverDistDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const filePath = resolve(serverDistDir, entry.name);
    const source = readFileSync(filePath, "utf8");
    const patched = source.replace(REPO_CONSTANTS_IMPORT, 'from "./constants.json"');
    if (patched === source) continue;
    writeFileSync(filePath, patched, "utf8");
    patchedFiles.push(entry.name);
  }

  return patchedFiles;
}

export function stageServerRuntimeTypes({ serverDistDir, runtimeTypesDistDir }) {
  const targetDir = resolve(serverDistDir, "ipollowork-types");
  rmSync(targetDir, { recursive: true, force: true });

  const runtimeFiles = javascriptFiles(runtimeTypesDistDir);
  if (runtimeFiles.length === 0) {
    throw new Error(`Missing built @ipollowork/types runtime files in ${runtimeTypesDistDir}`);
  }
  for (const sourcePath of runtimeFiles) {
    const destinationPath = resolve(targetDir, relative(runtimeTypesDistDir, sourcePath));
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }

  const patchedFiles = [];
  for (const filePath of javascriptFiles(serverDistDir)) {
    if (filePath === targetDir || filePath.startsWith(`${targetDir}${sep}`)) continue;
    const source = readFileSync(filePath, "utf8");
    const patched = source.replace(RUNTIME_TYPES_IMPORT, (specifier, quote, subpath) => {
      const segments = subpath ? subpath.split("/") : ["index"];
      if (segments.some((segment) => segment === "." || segment === "..")) {
        throw new Error(`Invalid @ipollowork/types runtime import in ${filePath}: ${specifier}`);
      }
      const runtimeModule = resolve(targetDir, `${segments.join(sep)}.js`);
      if (!existsSync(runtimeModule)) {
        throw new Error(`Missing built @ipollowork/types runtime module for ${specifier} in ${filePath}`);
      }
      const relativeModule = portablePath(relative(dirname(filePath), runtimeModule));
      const localSpecifier = relativeModule.startsWith(".") ? relativeModule : `./${relativeModule}`;
      return `${quote}${localSpecifier}${quote}`;
    });
    if (patched === source) continue;
    writeFileSync(filePath, patched, "utf8");
    patchedFiles.push(portablePath(relative(serverDistDir, filePath)));
  }
  return patchedFiles;
}
