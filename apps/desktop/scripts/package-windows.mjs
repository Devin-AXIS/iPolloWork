import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputDir = path.join(desktopRoot, "dist-electron");
const unpackedDir = path.join(outputDir, "win-unpacked");
const executablePath = path.join(unpackedDir, "iPollo Work.exe");
const iconPath = path.join(desktopRoot, "resources/icons/icon.ico");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (process.platform !== "win32") throw new Error("Windows packaging must run on Windows.");

function run(command, args, cwd = repoRoot, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: command.endsWith(".cmd") });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
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

function validateRenderer() {
  const indexPath = path.join(repoRoot, "apps/app/dist/index.html");
  const scriptNames = readdirSync(path.join(repoRoot, "apps/app/dist/assets")).filter((name) => name.endsWith(".js"));
  const source = [readFileSync(indexPath, "utf8"), ...scriptNames.map((name) => readFileSync(path.join(repoRoot, "apps/app/dist/assets", name), "utf8"))].join("\n");
  const required = ["ipollo-work-wordmark.svg", "new-conversation-bg.png", "new-conversation-tabs/video.svg"];
  for (const asset of required) {
    if (!existsSync(path.join(repoRoot, "apps/app/dist", asset))) throw new Error(`Missing renderer asset: ${asset}`);
    if (!source.includes(asset) || source.includes(`\"/${asset}\"`)) {
      throw new Error(`Renderer still uses an invalid packaged path for ${asset}.`);
    }
  }
}

rmSync(outputDir, { recursive: true, force: true });
run(process.execPath, [path.join(desktopRoot, "scripts/electron-build.mjs")]);
validateRenderer();

const env = { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? "https://npmmirror.com/mirrors/electron/" };
run(pnpm, ["exec", "electron-builder", "--config", "electron-builder.windows.yml", "--win", "--x64", "--dir", "--publish", "never"], desktopRoot, env);

const rcedit = findRcedit();
if (!rcedit) throw new Error("rcedit-x64.exe is missing from the electron-builder cache.");
execFileSync(rcedit, [executablePath, "--set-icon", iconPath], { stdio: "inherit" });

run(pnpm, ["exec", "electron-builder", "--config", "electron-builder.windows.yml", "--win", "--x64", "--prepackaged", unpackedDir, "--publish", "never"], desktopRoot, env);
console.log(`Windows package ready in ${outputDir}`);
