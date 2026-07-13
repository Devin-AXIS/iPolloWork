#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(bin, binArgs, env = process.env) {
  const child = spawn(bin, binArgs, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  child.once("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

function runAndWait(bin, binArgs, env = process.env) {
  return new Promise((resolveExit, rejectExit) => {
    const child = spawn(bin, binArgs, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
  });
}

async function runSequence(steps) {
  for (const [bin, binArgs] of steps) {
    const code = await runAndWait(bin, binArgs);
    if (code !== 0) process.exit(code);
  }
}

function requireCommand(bin, installHint) {
  const result = spawnSync(bin, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`${bin} is required. ${installHint}`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`iPolloWork development commands

  ./ipollowork setup              Install workspace dependencies
  ./ipollowork dev                Start the open-source desktop app
  ./ipollowork dev:ui             Start only the browser UI
  ./ipollowork dev:cloud [url]    Start desktop connected to iPolloCloud
  ./ipollowork check              Run type checks and desktop tests
  ./ipollowork build              Build the desktop application
  ./ipollowork package            Build native installers
  ./ipollowork package:dir        Build an unpacked desktop application

The default local iPolloCloud URL is http://localhost:3100.`);
}

requireCommand("node", "Install Node.js 22 or newer.");

switch (command) {
  case "setup":
    requireCommand("pnpm", "Run: corepack enable");
    run(pnpm, ["install", ...args]);
    break;
  case "dev":
    requireCommand("pnpm", "Run: corepack enable");
    run(pnpm, ["--filter", "@ipollowork/desktop", "dev", ...args], {
      ...process.env,
      IPOLLOWORK_DEV_MODE: "1",
    });
    break;
  case "dev:ui":
    requireCommand("pnpm", "Run: corepack enable");
    run(pnpm, ["--filter", "@ipollowork/app", "dev", ...args], {
      ...process.env,
      IPOLLOWORK_DEV_MODE: "1",
    });
    break;
  case "dev:cloud": {
    requireCommand("pnpm", "Run: corepack enable");
    const cloudUrl = args[0] ?? process.env.IPOLLOCLOUD_URL ?? "http://localhost:3100";
    let normalizedUrl;
    try {
      normalizedUrl = new URL(cloudUrl).origin;
    } catch {
      console.error(`Invalid iPolloCloud URL: ${cloudUrl}`);
      process.exit(1);
    }
    const stateDir = resolve(root, ".ipollowork-dev", "cloud");
    const bootstrapPath = resolve(stateDir, "bootstrap.json");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      bootstrapPath,
      `${JSON.stringify({ baseUrl: normalizedUrl, requireSignin: true }, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(`Starting iPolloWork with iPolloCloud at ${normalizedUrl}`);
    run(pnpm, ["--filter", "@ipollowork/desktop", "dev", ...args.slice(1)], {
      ...process.env,
      IPOLLOWORK_DEV_MODE: "1",
      IPOLLOWORK_DESKTOP_BOOTSTRAP_PATH: bootstrapPath,
      IPOLLOWORK_ELECTRON_USERDATA: resolve(stateDir, "electron-userdata"),
      IPOLLOWORK_DATA_DIR: resolve(stateDir, "runtime-data"),
      VITE_DEN_BASE_URL: normalizedUrl,
      VITE_DEN_REQUIRE_SIGNIN: "1",
      IPOLLOWORK_FORCE_SIGNIN: "1",
    });
    break;
  }
  case "check":
    requireCommand("pnpm", "Run: corepack enable");
    await runSequence([
      [pnpm, ["--filter", "@ipollowork/app", "typecheck", ...args]],
      [pnpm, ["--filter", "@ipollowork/desktop", "typecheck:electron", ...args]],
      [pnpm, ["--filter", "@ipollowork/desktop", "test", ...args]],
    ]);
    break;
  case "build":
    run(process.execPath, [resolve(root, "scripts", "build.mjs"), ...args]);
    break;
  case "package":
    requireCommand("pnpm", "Run: corepack enable");
    run(pnpm, ["--filter", "@ipollowork/desktop", "package:electron", ...args]);
    break;
  case "package:dir":
    requireCommand("pnpm", "Run: corepack enable");
    run(pnpm, ["--filter", "@ipollowork/desktop", "package:electron:dir", ...args]);
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}
