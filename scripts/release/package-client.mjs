#!/usr/bin/env node
/**
 * Builds a distributable desktop client from a single release sequence.
 *
 * Source checkouts use 0.0.0 as the unshipped baseline. Each `package` call
 * advances to the next patch release.
 * The flow deliberately does not commit, tag, push, or publish remotely.
 */
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const versionFiles = [
  "apps/app/package.json",
  "apps/desktop/package.json",
  "apps/orchestrator/package.json",
  "apps/server/package.json",
  "pnpm-lock.yaml",
];
const packageFiles = versionFiles.slice(0, -1);
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function nextClientVersion(version) {
  const match = versionPattern.exec(version);
  if (!match) {
    throw new Error(
      `Client version must use semantic versioning (X.Y.Z), got "${version}".`,
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return `${major}.${minor}.${patch + 1}`;
}

function parseArgs(argv) {
  const options = { dryRun: false, skipCheck: false, electronArgs: [] };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--skip-check") {
      options.skipCheck = true;
      continue;
    }
    if (arg === "--publish" || arg.startsWith("--publish=")) {
      throw new Error(
        "Local client packaging never publishes remotely. Use the release workflow to publish.",
      );
    }
    options.electronArgs.push(arg);
  }

  return options;
}

function run(bin, args) {
  const result = spawnSync(bin, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${bin} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

async function readPackageVersions() {
  const packages = await Promise.all(
    packageFiles.map(async (file) => ({
      file,
      value: JSON.parse(await readFile(resolve(root, file), "utf8")).version,
    })),
  );
  const currentVersion = String(packages[0]?.value ?? "");
  if (!currentVersion) throw new Error(`Missing version in ${packages[0]?.file}.`);

  const mismatches = packages.filter(({ value }) => value !== currentVersion);
  if (mismatches.length) {
    const details = packages.map(({ file, value }) => `${file}=${value ?? "?"}`).join(", ");
    throw new Error(`Client package versions must match before packaging: ${details}`);
  }
  return currentVersion;
}

async function snapshotVersionFiles() {
  return Promise.all(
    versionFiles.map(async (file) => [file, await readFile(resolve(root, file), "utf8")]),
  );
}

async function restoreVersionFiles(snapshot) {
  await Promise.all(
    snapshot.map(([file, contents]) => writeFile(resolve(root, file), contents, "utf8")),
  );
}

async function findArtifacts(directory, version) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return findArtifacts(path, version);
      const isInstaller = /\.(dmg|zip|exe|AppImage|tar\.gz)$/.test(entry.name);
      return isInstaller && entry.name.includes(`-${version}.`)
        ? [relative(root, path)]
        : [];
    }),
  );
  return results.flat();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const currentVersion = await readPackageVersions();
  const nextVersion = nextClientVersion(currentVersion);

  if (options.dryRun) {
    console.log("iPolloWork client package dry run");
    console.log(`- Current version: ${currentVersion}`);
    console.log(`- Next version:    ${nextVersion}`);
    console.log(`- Checks:          ${options.skipCheck ? "release review only" : "type checks and desktop tests"}`);
    console.log("- Publish:         disabled for local packaging");
    return;
  }

  run(process.execPath, [resolve(root, "scripts", "release", "review.mjs"), "--strict"]);
  if (!options.skipCheck) {
    run(process.execPath, [resolve(root, "scripts", "ipollowork.mjs"), "check"]);
  }

  const snapshot = await snapshotVersionFiles();
  let versionsChanged = false;
  try {
    // The shared bump script writes manifests before it refreshes the lockfile.
    // Mark the snapshot active first so even a lockfile failure is rolled back.
    versionsChanged = true;
    run(pnpm, ["--filter", "@ipollowork/app", "bump:set", "--", nextVersion]);
    run(process.execPath, [resolve(root, "scripts", "release", "review.mjs"), "--strict"]);
    run(pnpm, ["--filter", "@ipollowork/desktop", "package:electron", ...options.electronArgs]);

    const artifacts = await findArtifacts(
      resolve(root, "apps", "desktop", "dist-electron"),
      nextVersion,
    );
    console.log(`\nClient package ${nextVersion} completed.`);
    if (artifacts.length) {
      console.log("Artifacts:");
      for (const artifact of artifacts) console.log(`- ${artifact}`);
    } else {
      console.log("Artifacts are in apps/desktop/dist-electron/.");
    }
    console.log("Version changes are ready to review and commit; nothing was pushed or published.");
  } catch (error) {
    if (versionsChanged) {
      await restoreVersionFiles(snapshot);
      console.error("Restored version files because packaging did not finish.");
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
