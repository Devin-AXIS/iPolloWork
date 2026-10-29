import assert from "node:assert/strict";
import test from "node:test";
import { finalizeInstallerRelease, installerNames, validateInstallers } from "./publish-electron-assets.mjs";

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
    assert.throws(() => finalizeInstallerRelease(tag, { repo: "owner/repo", prune: true, runGh: (args) => { calls.push(args); return JSON.stringify(release); } }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "api");
  }
});

test("cleanup deletes only extras and rechecks the final release", () => {
  const release = fixture();
  release.assets.push({ name: "SHA256SUMS.txt" });
  const calls = [];
  const result = finalizeInstallerRelease(tag, { repo: "owner/repo", prune: true, runGh: (args) => {
    calls.push(args);
    if (args[0] === "api") return JSON.stringify(release);
    assert.deepEqual(args, ["release", "delete-asset", tag, "SHA256SUMS.txt", "--repo", "owner/repo", "--yes"]);
    release.assets.pop();
    return "";
  } });
  assert.equal(result.assets.length, 6);
  assert.equal(calls.length, 3);
});

test("inspection never deletes an unexpected attachment", () => {
  const release = fixture();
  release.assets.push({ name: "latest.yml" });
  let calls = 0;
  assert.throws(() => finalizeInstallerRelease(tag, { repo: "owner/repo", runGh: () => { calls += 1; return JSON.stringify(release); } }), /Non-installer/);
  assert.equal(calls, 1);
});
