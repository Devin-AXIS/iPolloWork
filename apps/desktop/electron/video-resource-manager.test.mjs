import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createVideoResourceManager } from "./video-resource-manager.mjs";

const ids = ["codex-harness", "deepseek-harness", "ffmpeg", "ffprobe"];

async function fixtureArchive(root, id) {
  const source = path.join(root, `${id}-source`);
  const files = {
    ffmpeg: "ffmpeg.exe",
    ffprobe: "ffprobe.exe",
  };
  const relative = files[id] ?? "package.json";
  await mkdir(path.join(source, path.dirname(relative)), { recursive: true });
  await writeFile(path.join(source, relative), `fixture ${id}`);
  const archive = path.join(root, `${id}.tar.gz`);
  const result = spawnSync("tar", ["-czf", archive, "-C", source, "."], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const bytes = await readFile(archive);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

test("installs signed FFmpeg and FFprobe resources after a real HTTP download and reuses them offline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-video-resource-test-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const archives = new Map();
  for (const id of ids) archives.set(id, await fixtureArchive(root, id));
  let origin;
  let requestCount = 0;
  let interruptedFfmpeg = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    if (request.url.startsWith("/api/v1/desktop/resources?")) {
      const manifest = {
        schemaVersion: 1,
        appVersion: "0.50.13",
        platform: "windows",
        arch: "x64",
        resources: ids.map((id) => ({
          id,
          version: "1.0.0",
          fileName: `ipollowork-${id}-1.0.0.tar.gz`,
          format: "tar.gz",
          sizeBytes: archives.get(id).bytes.length,
          sha256: archives.get(id).sha256,
          url: `${origin}/${id}.tar.gz`,
        })),
      };
      const payload = Buffer.from(JSON.stringify(manifest));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...manifest, signature: {
        algorithm: "Ed25519",
        keyId: "test",
        payloadSha256: createHash("sha256").update(payload).digest("hex"),
        payload: payload.toString("base64url"),
        value: sign(null, payload, privateKey).toString("base64url"),
      } }));
      return;
    }
    const id = request.url.slice(1).replace(/\.tar\.gz$/, "");
    const archive = archives.get(id);
    if (!archive) { response.writeHead(404); response.end(); return; }
    const range = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range ?? ""));
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const firstPartEnd = Math.ceil(archive.bytes.length / 4) - 1;
      if (id === "ffmpeg" && end === firstPartEnd && interruptedFfmpeg < 5) {
        interruptedFfmpeg += 1;
        const interruptedEnd = start + Math.floor((end - start + 1) / 2);
        response.writeHead(206, {
          "content-type": "application/gzip",
          "content-range": `bytes ${start}-${interruptedEnd - 1}/${archive.bytes.length}`,
        });
        response.end(archive.bytes.subarray(start, interruptedEnd));
        return;
      }
      response.writeHead(206, {
        "content-type": "application/gzip",
        "content-range": `bytes ${start}-${end}/${archive.bytes.length}`,
      });
      response.end(archive.bytes.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { "content-type": "application/gzip" });
    response.end(archive.bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  try {
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    const probed = [];
    const manager = createVideoResourceManager({
      app: { getPath: () => root, getVersion: () => "0.50.14", isPackaged: true },
      fetch,
      env,
      platform: "win32",
      arch: "x64",
      trustedKeys: { test: publicKey.export({ type: "spki", format: "pem" }).toString() },
      probeBinary: async (binaryPath, id) => {
        probed.push({ binaryPath, id });
      },
    });
    assert.equal((await manager.info()).status, "not-installed");
    assert.equal((await manager.install(origin)).status, "ready");
    assert.equal(requestCount, 14);
    assert.match(env.HYPERFRAMES_FFMPEG_PATH, /ffmpeg\.exe$/);
    assert.match(env.HYPERFRAMES_FFPROBE_PATH, /ffprobe\.exe$/);
    assert.deepEqual(probed.map((item) => item.id).sort(), ["ffmpeg", "ffprobe"]);
    assert.equal(env.HYPERFRAMES_CLI_PATH, undefined);
    assert.equal(env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT, undefined);
    assert.equal((await manager.install(origin)).status, "ready");
    assert.equal(requestCount, 14);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
