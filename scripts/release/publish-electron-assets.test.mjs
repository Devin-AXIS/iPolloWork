import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeInstallerRelease, installerNames, validateInstallers, mergeUpdaterMetadata } from "./publish-electron-assets.mjs";
import { updateMetadataBlock, releaseUpdateInfo, CLOUD_UPDATE_BASE, RELEASE_REPOSITORY } from "../../apps/desktop/electron/github-installer-provider.mjs";

const tag = "v0.50.30";
const fixture = () => ({ tag_name: tag, assets: installerNames(tag).map((name) => ({ name, state: "uploaded", size: 1024, digest: `sha256:${"a".repeat(64)}` })) });

test("the public release has exactly six platform installers", () => {
  assert.equal(installerNames(tag).length, 6);
  assert.deepEqual(validateInstallers(fixture(), tag), []);
  const release = fixture();
  release.assets.push({ name: "latest.yml" }, { name: "ipollowork-mac-arm64-0.50.30.zip" });
  assert.deepEqual(validateInstallers(release, tag).map((asset) => asset.name), ["latest.yml", "ipollowork-mac-arm64-0.50.30.zip"]);
});

test("missing, empty, unsigned-digest and mismatched-version installers block cleanup", () => {
  for (const mutate of [
    (release) => release.assets.pop(),
    (release) => { release.assets[0].size = 0; },
    (release) => { release.assets[0].digest = null; },
    (release) => { release.assets[0].state = "starter"; },
    (release) => { release.tag_name = "v0.50.29"; },
  ]) {
    const release = fixture();
    mutate(release);
    const calls = [];
    assert.throws(() => finalizeInstallerRelease(tag, { repo: "owner/repo", prune: true, runGh: (args) => { calls.push(args); return args[0] === "api" ? JSON.stringify(release) : "42\n"; } }));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ["api", "repos/owner/repo/releases/42"]);
  }
});

test("cleanup deletes only extras and rechecks the final release", () => {
  const release = fixture();
  release.assets.push({ name: "SHA256SUMS.txt" });
  const calls = [];
  const result = finalizeInstallerRelease(tag, { repo: "owner/repo", prune: true, runGh: (args) => {
    calls.push(args);
    if (args[0] === "api") return JSON.stringify(release);
    if (args[1] === "view") return "42\n";
    assert.deepEqual(args, ["release", "delete-asset", tag, "SHA256SUMS.txt", "--repo", "owner/repo", "--yes"]);
    release.assets.pop();
    return "";
  } });
  assert.equal(result.assets.length, 6);
  assert.equal(calls.length, 5);
});

test("inspection never deletes an unexpected attachment", () => {
  const release = fixture();
  release.assets.push({ name: "latest.yml" });
  let calls = 0;
  assert.throws(() => finalizeInstallerRelease(tag, { repo: "owner/repo", runGh: (args) => { calls += 1; return args[0] === "api" ? JSON.stringify(release) : "42\n"; } }), /Non-installer/);
  assert.equal(calls, 2);
});

test("pending draft tags resolve through the CLI and invalid release IDs block API access", () => {
  const release = { ...fixture(), id: 42, draft: true };
  const calls = [];
  assert.deepEqual(finalizeInstallerRelease(tag, { repo: "owner/repo", runGh: (args) => {
    calls.push(args);
    if (args[0] === "release") {
      assert.deepEqual(args, ["release", "view", tag, "--repo", "owner/repo", "--json", "databaseId", "--jq", ".databaseId"]);
      return "42\n";
    }
    assert.deepEqual(args, ["api", "repos/owner/repo/releases/42"]);
    return JSON.stringify(release);
  } }), release);
  assert.equal(calls.length, 2);
  for (const id of ["", "null", "0", "../tags/v0.50.30"]) {
    assert.throws(() => finalizeInstallerRelease(tag, { repo: "owner/repo", runGh: (args) => {
      assert.equal(args[0], "release");
      return id;
    } }), /release ID/);
  }
});

test("six build receipts replace old metadata and incomplete or duplicate builds are rejected", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ipollowork-update-receipts-"));
  try {
    const release = fixture();
    release.body = `Visible notes\n\n${updateMetadataBlock({ version: "old", files: {} })}`;
    for (const asset of release.assets) asset.browser_download_url = `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${asset.name}`;
    const hash = Buffer.alloc(64, 7);
    for (const platform of ["win32", "darwin", "linux"]) for (const arch of ["x64", "arm64"]) {
      const target = `${platform}-${arch}`;
      const folder = path.join(root, target);
      mkdirSync(folder);
      const osName = { win32: "win", darwin: "mac", linux: "linux" }[platform];
      const fileArch = platform === "linux" && arch === "x64" ? "x86_64" : arch;
      const ext = { win32: "exe", darwin: "zip", linux: "AppImage" }[platform];
      const name = `ipollowork-${osName}-${fileArch}-0.50.30.${ext}`;
      const url = platform === "darwin" ? `${CLOUD_UPDATE_BASE}${tag}/${hash.toString("hex")}-${name}`
        : `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${name}`;
      writeFileSync(path.join(folder, "update-info.json"), JSON.stringify({ version: "0.50.30", files: { [target]: { url, sha512: hash.toString("base64"), size: 1024 } } }));
    }
    const merged = mergeUpdaterMetadata(root, release);
    assert.equal(Object.keys(merged.metadata.files).length, 6);
    assert.equal((merged.body.match(/<!-- ipollowork-desktop-update:v1/g) ?? []).length, 1);
    assert.equal(releaseUpdateInfo({ ...release, body: merged.body }, { platform: "darwin", arch: "arm64" }).releaseNotes, "Visible notes");
    writeFileSync(path.join(root, "update-info.json"), JSON.stringify({ version: "0.50.30", files: { "darwin-arm64": merged.metadata.files["darwin-arm64"] } }));
    assert.throws(() => mergeUpdaterMetadata(root, release), /Duplicate/);
    rmSync(path.join(root, "update-info.json"));
    rmSync(path.join(root, "darwin-arm64", "update-info.json"));
    assert.throws(() => mergeUpdaterMetadata(root, release), /six native/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
