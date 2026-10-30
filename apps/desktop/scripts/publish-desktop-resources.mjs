import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { verifyDesktopResourceManifest } from "../electron/desktop-resource-manifest.mjs";

const IDS = ["codex-harness", "deepseek-harness", "ffmpeg", "ffprobe"];

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[index + 1];
}

function artifactName(fileName) {
  const engine = /^ipollowork-engine-(codex-harness|deepseek-harness)-(windows|macos|linux)-(x64|arm64)-([0-9A-Za-z._+-]+)\.tar\.gz$/.exec(fileName);
  if (engine) return { id: engine[1], platform: engine[2], arch: engine[3], version: engine[4] };
  const video = /^ipollowork-(ffmpeg|ffprobe)-(windows|macos|linux)-(x64|arm64)-([0-9A-Za-z._+-]+)\.tar\.gz$/.exec(fileName);
  if (video) return { id: video[1], platform: video[2], arch: video[3], version: video[4] };
  throw new Error(`Unexpected resource archive: ${fileName}`);
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function responseJson(response, action) {
  if (!response.ok) throw new Error(`${action} returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

const directory = path.resolve(argument("--directory"));
const appVersion = argument("--app-version");
const platform = argument("--platform");
const arch = argument("--arch");
const baseUrl = new URL(argument("--base-url"));
const token = process.env.IPOLLO_DESKTOP_RESOURCE_ADMIN_TOKEN?.trim();
if (!token) throw new Error("IPOLLO_DESKTOP_RESOURCE_ADMIN_TOKEN is missing.");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(appVersion)) throw new Error("Invalid app version.");
if (!(["windows", "macos", "linux"].includes(platform) && ["x64", "arm64"].includes(arch))) throw new Error("Invalid platform or architecture.");
if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(baseUrl.hostname))) {
  throw new Error("Admin uploads require HTTPS or a server-local loopback connection.");
}
const files = (await readdir(directory)).filter((name) => name.endsWith(".tar.gz"));
if (files.length !== IDS.length) throw new Error(`Expected ${IDS.length} archives, found ${files.length}.`);
const artifacts = await Promise.all(files.map(async (fileName) => {
  const artifact = artifactName(fileName);
  if ((artifact.platform && artifact.platform !== platform) || (artifact.arch && artifact.arch !== arch)) {
    throw new Error(`Wrong target in ${fileName}.`);
  }
  const file = path.join(directory, fileName);
  const sizeBytes = (await stat(file)).size;
  if (!sizeBytes) throw new Error(`Empty archive: ${fileName}`);
  return { ...artifact, fileName, file, sizeBytes, sha256: await sha256File(file) };
}));
if (new Set(artifacts.map((item) => item.id)).size !== IDS.length || IDS.some((id) => !artifacts.some((item) => item.id === id))) {
  throw new Error("The upload batch must contain each of the four resources exactly once.");
}
const target = { appVersion, platform, arch };
for (const item of artifacts) {
  const url = new URL(`/api/v1/admin/desktop/resources/${item.id}`, baseUrl);
  url.search = new URLSearchParams({ ...target, version: item.version }).toString();
  const response = await fetch(url, {
    method: "PUT",
    redirect: "error",
    signal: AbortSignal.timeout(10 * 60_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/gzip",
      "Content-Length": String(item.sizeBytes),
      "X-iPolloWork-SHA256": item.sha256,
    },
    body: createReadStream(item.file),
    duplex: "half",
  });
  await responseJson(response, `Upload ${item.id}`);
  process.stdout.write(`Uploaded ${item.id} ${item.version} (${item.sizeBytes} bytes)\n`);
}
const publishUrl = new URL("/api/v1/admin/desktop/resource-releases/publish", baseUrl);
await responseJson(await fetch(publishUrl, {
  method: "POST",
  redirect: "error",
  signal: AbortSignal.timeout(120_000),
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(target),
}), "Publish");
const manifestUrl = new URL("/api/v1/desktop/resources", baseUrl);
manifestUrl.search = new URLSearchParams(target).toString();
const manifest = await responseJson(await fetch(manifestUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) }), "Verify published manifest");
// The publisher needs only the same public key shipped to desktop clients.
// Keep the signing private key exclusively on the cloud server.
const published = verifyDesktopResourceManifest(manifest, target);
for (const item of artifacts) {
  const matched = published.resources.find((resource) => resource.id === item.id);
  if (!matched || matched.version !== item.version || matched.sha256 !== item.sha256 || matched.sizeBytes !== item.sizeBytes) {
    throw new Error(`Published manifest differs from uploaded ${item.id}.`);
  }
}
process.stdout.write(`Published and verified ${appVersion}/${platform}/${arch}.\n`);
