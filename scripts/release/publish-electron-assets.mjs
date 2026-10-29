#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CLOUD_UPDATE_BASE, RELEASE_REPOSITORY, UPDATE_METADATA_PATTERN, releaseUpdateInfo, updateMetadataBlock } from "../../apps/desktop/electron/github-installer-provider.mjs";

export function installerNames(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error("Invalid desktop release tag.");
  const version = tag.slice(1);
  return [
    `ipollowork-win-x64-${version}.exe`,
    `ipollowork-win-arm64-${version}.exe`,
    `ipollowork-mac-x64-${version}.dmg`,
    `ipollowork-mac-arm64-${version}.dmg`,
    `ipollowork-linux-x86_64-${version}.AppImage`,
    `ipollowork-linux-arm64-${version}.AppImage`,
  ];
}

export function validateInstallers(release, tag) {
  if (release.tag_name !== tag || !Array.isArray(release.assets)) throw new Error("Unexpected release response.");
  const expected = installerNames(tag);
  for (const name of expected) {
    const matches = release.assets.filter((asset) => asset.name === name);
    if (matches.length !== 1) throw new Error(`Expected exactly one installer: ${name}`);
    const asset = matches[0];
    if (asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size <= 0
      || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) {
      throw new Error(`Installer is incomplete or has no GitHub SHA-256 digest: ${name}`);
    }
  }
  return release.assets.filter((asset) => !expected.includes(asset.name));
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh failed with status ${result.status}`);
  return result.stdout;
}

function readRelease(tag, repo, runGh = gh) {
  // GitHub's tag endpoint only returns published releases. The CLI also
  // resolves pending draft tags, so use its ID for the full REST response.
  const id = runGh(["release", "view", tag, "--repo", repo, "--json", "databaseId", "--jq", ".databaseId"]).trim();
  if (!/^[1-9]\d*$/.test(id)) throw new Error("GitHub release ID is missing or invalid.");
  return JSON.parse(runGh(["api", `repos/${repo}/releases/${id}`]));
}

export function finalizeInstallerRelease(tag, { repo, prune = false, runGh = gh }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error("GITHUB_REPOSITORY is required.");
  installerNames(tag);
  const read = () => readRelease(tag, repo, runGh);
  let release = read();
  const extra = validateInstallers(release, tag);
  if (extra.length && !prune) throw new Error(`Non-installer release assets: ${extra.map((asset) => asset.name).join(", ")}`);
  // Validate every installer before removing anything from an existing release.
  for (const asset of extra) runGh(["release", "delete-asset", tag, asset.name, "--repo", repo, "--yes"]);
  if (extra.length) release = read();
  if (validateInstallers(release, tag).length) throw new Error("Non-installer assets remain after cleanup.");
  return release;
}

export async function stageUpdater(directory, tag) {
  const os = { win32: "win", darwin: "mac", linux: "linux" }[process.platform];
  installerNames(tag);
  if (!os || !["x64", "arm64"].includes(process.arch)) throw new Error("Unsupported native build target.");
  const arch = process.platform === "linux" && process.arch === "x64" ? "x86_64" : process.arch;
  const ext = { win32: "exe", darwin: "zip", linux: "AppImage" }[process.platform];
  const name = `ipollowork-${os}-${arch}-${tag.slice(1)}.${ext}`;
  const file = resolve(directory, name);
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const digest = hash.digest();
  const remoteName = `${digest.toString("hex")}-${name}`;
  const url = process.platform === "darwin" ? `${CLOUD_UPDATE_BASE}${tag}/${remoteName}`
    : `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${name}`;
  const metadata = { version: tag.slice(1), files: { [`${process.platform}-${process.arch}`]: { url, size: (await stat(file)).size, sha512: digest.toString("base64") } } };
  writeFileSync(join(directory, "update-info.json"), `${JSON.stringify(metadata)}\n`);
  if (process.platform === "darwin") {
    writeFileSync(join(directory, "cloud-upload.txt"), `-mkdir /releases/${tag}\nput "${file}" /releases/${tag}/${remoteName}\n`);
  }
  return metadata;
}

export function mergeUpdaterMetadata(directory, release) {
  const metadata = { version: release.tag_name.slice(1), files: {} };
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name === "update-info.json") {
        const part = JSON.parse(readFileSync(file, "utf8"));
        if (part.version !== metadata.version) throw new Error("Mixed updater versions.");
        for (const [target, info] of Object.entries(part.files)) {
          if (metadata.files[target]) throw new Error(`Duplicate updater target: ${target}`);
          metadata.files[target] = info;
        }
      }
    }
  }
  visit(directory);
  if (Object.keys(metadata.files).length !== 6) throw new Error("Expected six native updater receipts.");
  const body = `${String(release.body ?? "").replace(UPDATE_METADATA_PATTERN, "").trim()}\n\n${updateMetadataBlock(metadata)}\n`;
  const candidate = { ...release, draft: false, prerelease: false, body };
  for (const platform of ["win32", "darwin", "linux"]) {
    for (const arch of ["x64", "arm64"]) releaseUpdateInfo(candidate, { platform, arch });
  }
  return { body, metadata };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--stage-updater" && args.length === 3) {
    await stageUpdater(args[1], args[2]);
  } else {
    const tag = args.at(-1);
    const repo = process.env.GITHUB_REPOSITORY;
    if (args[0] === "--metadata-dir" && args.length === 3) {
      // Keep old attachments until all six update receipts and cloud ZIPs pass.
      const release = readRelease(tag, repo);
      validateInstallers(release, tag);
      const { body, metadata } = mergeUpdaterMetadata(args[1], release);
      for (const [target, file] of Object.entries(metadata.files)) {
        if (!target.startsWith("darwin-")) continue;
        const response = await fetch(file.url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
        if (!response.ok || Number(response.headers.get("content-length")) !== file.size) throw new Error(`Cloud updater is unavailable: ${target}`);
      }
      const notes = join(args[1], "release-notes.md");
      writeFileSync(notes, body);
      gh(["release", "edit", tag, "--repo", repo, "--notes-file", notes]);
    } else if (!(args.length === 1 || (args.length === 2 && args[0] === "--prune"))) {
      throw new Error("Usage: publish-electron-assets.mjs [--prune | --metadata-dir <directory>] <release-tag>");
    }
    const release = finalizeInstallerRelease(tag, { repo, prune: args.includes("--prune") || args[0] === "--metadata-dir" });
    console.log(JSON.stringify({ tag: release.tag_name, installers: release.assets.map(({ name, size, digest }) => ({ name, size, digest })) }, null, 2));
  }
}
