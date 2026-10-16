import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("./package-plugin-collection.mjs", import.meta.url));
function run(args) { return spawnSync("bun", [script, ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 60000 }); }

test("collection CLI rejects unknown IDs and missing signing config before creating output", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-release-cli-"));
  try {
    const output = join(root, "release");
    const unknown = run(["--plugin", "../private", "--out", output]);
    assert.notEqual(unknown.status, 0); assert.match(unknown.stderr, /Unknown plugin ID/);
    const missing = run(["--plugin", "figma", "--config", join(root, "absent.json"), "--out", output]);
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /Create local signing config/);
    await assert.rejects(readFile(join(output, "collection.json")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("single-plugin inventory requires no key and never overwrites a previous release", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-release-inventory-"));
  try {
    const output = join(root, "release");
    const result = run(["--plugin", "figma", "--inventory", "--out", output]);
    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(await readFile(join(output, "collection.json"), "utf8"));
    assert.equal(inventory.signed, false); assert.equal(inventory.plugins.length, 1); assert.equal(inventory.plugins[0].pluginId, "figma");
    assert.equal(inventory.plugins[0].artifact, undefined);
    const repeated = run(["--plugin", "figma", "--inventory", "--out", output]);
    assert.notEqual(repeated.status, 0); assert.match(repeated.stderr, /EEXIST/);
    assert.deepEqual(JSON.parse(await readFile(join(output, "collection.json"), "utf8")), inventory);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an untrusted signing key cannot produce a ready cloud collection", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-release-trust-"));
  try {
    const output = join(root, "release");
    const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
    const key = join(root, "private.pem"); await writeFile(key, pem);
    const config = join(root, "release.json"); await writeFile(config, JSON.stringify({ privateKey: key, keyId: "untrusted", publisher: { id: "fixture", name: "Fixture" } }));
    const result = run(["--plugin", "figma", "--config", config, "--out", output]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /trusted|signature|publisher/i);
    assert.equal((result.stdout + result.stderr).includes(String(pem)), false);
    await assert.rejects(readFile(join(output, "collection.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(output, "plugins-collection.zip")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
