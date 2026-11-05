import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(pluginRoot, "../../..");
const hyperframesRoot = resolve(repositoryRoot, "vendor/hyperframes");
const cliDist = resolve(hyperframesRoot, "packages/cli/dist");
const cliOutput = resolve(cliDist, "cli.js");
const studioOutput = resolve(cliDist, "studio/index.html");
const stagedRuntime = resolve(pluginRoot, "lib/hyperframes");

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return readdirSync(path).reduce((latest, entry) => Math.max(latest, newestMtime(resolve(path, entry))), info.mtimeMs);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: hyperframesRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const sourceMtime = Math.max(...[
  "cli", "core", "engine", "lint", "parsers", "player", "producer", "sdk", "shader-transitions", "studio", "studio-server",
].flatMap((name) => [
  newestMtime(resolve(hyperframesRoot, "packages", name, "src")),
  newestMtime(resolve(hyperframesRoot, "packages", name, "package.json")),
]), newestMtime(resolve(hyperframesRoot, "bun.lock")));
const outputMtime = Math.min(newestMtime(cliOutput), newestMtime(studioOutput));

if (!outputMtime || sourceMtime > outputMtime) {
  if (!existsSync(resolve(hyperframesRoot, "node_modules/.bun"))) {
    run(process.platform === "win32" ? "bun.exe" : "bun", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  }
  run(process.platform === "win32" ? "bun.exe" : "bun", ["run", "build:local-studio"]);
}

if (!existsSync(cliOutput) || !existsSync(studioOutput)) {
  throw new Error("The canonical iPolloWork HyperFrames runtime was not built.");
}

rmSync(stagedRuntime, { recursive: true, force: true });
cpSync(cliDist, stagedRuntime, { recursive: true });
cpSync(resolve(hyperframesRoot, "LICENSE"), resolve(stagedRuntime, "LICENSE"));
console.log(`Staged canonical HyperFrames runtime: ${stagedRuntime}`);

