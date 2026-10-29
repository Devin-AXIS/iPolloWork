import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createGithubInstallerProvider, releaseUpdateInfo, updateMetadataBlock, CLOUD_UPDATE_BASE, RELEASE_REPOSITORY } from "./github-installer-provider.mjs";

function fixture(platform, arch) {
  const version = "0.50.30";
  const hash = createHash("sha512").update("installer fixture").digest();
  const os = { win32: "win", darwin: "mac", linux: "linux" }[platform];
  const fileArch = platform === "linux" && arch === "x64" ? "x86_64" : arch;
  const ext = { win32: "exe", darwin: "zip", linux: "AppImage" }[platform];
  const name = `ipollowork-${os}-${fileArch}-${version}.${ext}`;
  const url = platform === "darwin" ? `${CLOUD_UPDATE_BASE}v${version}/${hash.toString("hex")}-${name}`
    : `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}/${name}`;
  const file = { url, sha512: hash.toString("base64"), size: 17 };
  const metadata = { version, files: { [`${platform}-${arch}`]: file } };
  const release = { tag_name: `v${version}`, draft: false, prerelease: false, published_at: "2026-10-29T00:00:00Z",
    assets: [{ name, browser_download_url: url, state: "uploaded", size: file.size }], body: `Release notes\n\n${updateMetadataBlock(metadata)}` };
  return { release, metadata, file };
}

test("all six targets resolve only their own payload without YAML or blockmaps", () => {
  for (const platform of ["win32", "darwin", "linux"]) for (const arch of ["x64", "arm64"]) {
    const { release, file } = fixture(platform, arch);
    const info = releaseUpdateInfo(release, { platform, arch });
    assert.deepEqual(info.files, [file]);
    assert.equal(info.releaseNotes, "Release notes");
  }
});

test("unpublished releases, missing metadata and wrong platform artifacts fail closed", () => {
  const { release } = fixture("win32", "x64");
  assert.throws(() => releaseUpdateInfo({ ...release, draft: true }, { platform: "win32", arch: "x64" }));
  assert.throws(() => releaseUpdateInfo({ ...release, prerelease: true }, { platform: "win32", arch: "x64" }));
  assert.throws(() => releaseUpdateInfo({ ...release, body: "No metadata" }, { platform: "win32", arch: "x64" }));
  assert.throws(() => releaseUpdateInfo(release, { platform: "win32", arch: "arm64" }));
  assert.throws(() => releaseUpdateInfo({ ...release, assets: [] }, { platform: "win32", arch: "x64" }));
});

test("metadata cannot redirect downloads or remove integrity checking", () => {
  for (const mutate of [
    (metadata) => { metadata.version = "0.50.29"; },
    (metadata) => { metadata.files["darwin-arm64"].sha512 = ""; },
    (metadata) => { metadata.files["darwin-arm64"].url = "https://example.com/payload.zip"; },
    (metadata) => { metadata.files["darwin-arm64"].url = metadata.files["darwin-arm64"].url.replace("mac-arm64", "mac-x64"); },
    (metadata) => { metadata.files["darwin-arm64"].size = 0; },
  ]) {
    const { release, metadata } = fixture("darwin", "arm64");
    mutate(metadata);
    release.body = updateMetadataBlock(metadata);
    assert.throws(() => releaseUpdateInfo(release, { platform: "darwin", arch: "arm64" }));
  }
});

test("the real electron-updater provider preserves SHA-512 and absolute download URLs", async () => {
  const { release, file } = fixture(process.platform, process.arch);
  const Provider = await createGithubInstallerProvider();
  const requests = [];
  const provider = new Provider({}, {}, { platform: process.platform, executor: { request: async (options) => {
    requests.push(options);
    return JSON.stringify(release);
  } } });
  const info = await provider.getLatestVersion();
  const [resolved] = provider.resolveFiles(info);
  assert.equal(requests[0].hostname, "api.github.com");
  assert.equal(resolved.url.href, file.url);
  assert.equal(resolved.info.sha512, file.sha512);
  assert.equal(provider.isUseMultipleRangeRequest, false);
});
