import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const appPackagePath = path.join(repoRoot, "apps/app/package.json");
const desktopPackagePath = path.join(desktopRoot, "package.json");
const outputDir = path.join(desktopRoot, "dist-electron");
const unpackedDir = path.join(outputDir, "win-unpacked");
const executablePath = path.join(unpackedDir, "iPollo Work.exe");
const iconPath = path.join(desktopRoot, "resources/icons/windows/icon.ico");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (process.platform !== "win32") throw new Error("Windows packaging must run on Windows.");

function run(command, args, cwd = repoRoot, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: command.endsWith(".cmd") });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function nextPatchVersion(version) {
  const match = String(version ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
  if (!match) throw new Error(`Unsupported Electron package version: ${version}`);
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

function writeWindowsPackageVersion() {
  const explicitVersion = String(process.env.IPOLLOWORK_WINDOWS_PACKAGE_VERSION ?? "").trim();
  const shouldBump = process.env.IPOLLOWORK_WINDOWS_PACKAGE_VERSION_BUMP !== "0";
  const desktopPackage = readJson(desktopPackagePath);
  const appPackage = readJson(appPackagePath);
  const version = explicitVersion || (shouldBump ? nextPatchVersion(desktopPackage.version) : desktopPackage.version);
  const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!semverPattern.test(version)) throw new Error(`Invalid Windows package version: ${version}`);
  desktopPackage.version = version;
  appPackage.version = version;
  writeJson(desktopPackagePath, desktopPackage);
  writeJson(appPackagePath, appPackage);
  return version;
}

function findRcedit() {
  const cacheRoot = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "electron-builder/Cache/winCodeSign");
  if (!existsSync(cacheRoot)) return null;
  for (const directory of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const candidate = path.join(cacheRoot, directory.name, "rcedit-x64.exe");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const packageVersion = writeWindowsPackageVersion();
console.log(`Windows package version: ${packageVersion}`);

rmSync(outputDir, { recursive: true, force: true });
run(process.execPath, [path.join(desktopRoot, "scripts/electron-build.mjs")]);

const env = { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? "https://npmmirror.com/mirrors/electron/" };
run(pnpm, ["exec", "electron-builder", "--config", "electron-builder.windows.yml", "--win", "--x64", "--dir", "--publish", "never"], desktopRoot, env);

const rcedit = findRcedit();
if (!rcedit) throw new Error("rcedit-x64.exe is missing from the electron-builder cache.");
execFileSync(rcedit, [executablePath, "--set-icon", iconPath], { stdio: "inherit" });

run(pnpm, ["exec", "electron-builder", "--config", "electron-builder.windows.yml", "--win", "--x64", "--prepackaged", unpackedDir, "--publish", "never"], desktopRoot, env);

const expectedInstaller = path.join(outputDir, `ipollowork-win-x64-${packageVersion}.exe`);
if (!existsSync(expectedInstaller)) {
  throw new Error(`Versioned Windows installer was not created: ${expectedInstaller}`);
}
console.log(`Windows package ready: ${expectedInstaller}`);
