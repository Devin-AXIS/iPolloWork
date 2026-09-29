import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { fetchDesktopResourceManifest, verifyDesktopResourceManifest } from "./desktop-resource-manifest.mjs";

const target = { appVersion: "0.50.13", platform: "windows", arch: "x64" };
const ids = ["codex-harness", "deepseek-harness", "ffmpeg", "ffprobe"];
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keys = { test: publicKey.export({ type: "spki", format: "pem" }).toString() };

function signedManifest() {
  const manifest = {
    schemaVersion: 1,
    ...target,
    resources: ids.map((id) => ({
      id,
      version: "1.2.3",
      fileName: `ipollowork-${id}-1.2.3.tar.gz`,
      format: "tar.gz",
      sizeBytes: 10,
      sha256: "a".repeat(64),
      url: `https://example.com/api/v1/desktop/resources/${id}/download`,
    })),
  };
  const payload = Buffer.from(JSON.stringify(manifest));
  return {
    ...manifest,
    signature: {
      algorithm: "Ed25519",
      keyId: "test",
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
      payload: payload.toString("base64url"),
      value: sign(null, payload, privateKey).toString("base64url"),
    },
  };
}

test("accepts the exact signed cloud resource manifest", () => {
  const response = signedManifest();
  assert.equal(verifyDesktopResourceManifest(response, target, keys).resources.length, 4);
});

test("rejects changed metadata, unknown keys and incomplete releases", () => {
  const changed = signedManifest();
  changed.resources[0].url = "https://attacker.example/other.tar.gz";
  assert.throws(() => verifyDesktopResourceManifest(changed, target, keys), /does not match/);
  const unknown = signedManifest();
  unknown.signature.keyId = "unknown";
  assert.throws(() => verifyDesktopResourceManifest(unknown, target, keys), /unknown signing key/);
  const incomplete = signedManifest();
  incomplete.resources.pop();
  assert.throws(() => verifyDesktopResourceManifest(incomplete, target, keys), /does not match/);
});

test("requests the exact app, platform and architecture from the selected cloud origin", async () => {
  const response = signedManifest();
  /** @type {URL | undefined} */
  let requestedUrl;
  const result = await fetchDesktopResourceManifest({
    baseUrl: "https://example.com/dashboard",
    appVersion: target.appVersion,
    platform: "win32",
    arch: target.arch,
    trustedKeys: keys,
    fetch: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
    },
  });
  assert.ok(requestedUrl);
  assert.equal(requestedUrl.origin, "https://example.com");
  assert.equal(requestedUrl.searchParams.get("appVersion"), target.appVersion);
  assert.equal(requestedUrl.searchParams.get("platform"), target.platform);
  assert.equal(requestedUrl.searchParams.get("arch"), target.arch);
  assert.equal(result.resources.length, 4);
});
