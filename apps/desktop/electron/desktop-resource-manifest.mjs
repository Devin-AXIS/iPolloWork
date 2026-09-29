import { createHash, createPublicKey, verify } from "node:crypto";

export const DESKTOP_RESOURCE_KEY_ID = "desktop-resources-20260928-01";
export const DESKTOP_RESOURCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWgeeGJmtpUEWcCoCKiY+ktZyMXls74DGK9VC5Zc5TCU=
-----END PUBLIC KEY-----`;

const RESOURCE_IDS = new Set([
  "codex-harness", "deepseek-harness", "hyperframes-runtime",
  "hyperframes-registry", "ffmpeg", "ffprobe",
]);

export function desktopResourcePlatform(platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  throw new Error(`Unsupported desktop resource platform: ${platform}`);
}

/** @param {Record<string, string>} [trustedKeys] */
export function verifyDesktopResourceManifest(response, target, trustedKeys = {
  [DESKTOP_RESOURCE_KEY_ID]: DESKTOP_RESOURCE_PUBLIC_KEY,
}) {
  const signature = response?.signature;
  const publicKey = trustedKeys[signature?.keyId];
  if (signature?.algorithm !== "Ed25519" || !publicKey) {
    throw new Error("Cloud resource manifest has an unknown signing key.");
  }
  if (typeof signature.payload !== "string" || typeof signature.value !== "string") {
    throw new Error("Cloud resource manifest signature is missing.");
  }
  const payload = Buffer.from(signature.payload, "base64url");
  const digest = createHash("sha256").update(payload).digest("hex");
  if (digest !== signature.payloadSha256
    || !verify(null, payload, createPublicKey(publicKey), Buffer.from(signature.value, "base64url"))) {
    throw new Error("Cloud resource manifest signature verification failed.");
  }
  const manifest = JSON.parse(payload.toString("utf8"));
  const { signature: _signature, ...unsignedResponse } = response;
  if (JSON.stringify(manifest) !== JSON.stringify(unsignedResponse)) {
    throw new Error("Cloud resource manifest does not match its signed payload.");
  }
  if (manifest.schemaVersion !== 1 || manifest.appVersion !== target.appVersion
    || manifest.platform !== target.platform || manifest.arch !== target.arch
    || !Array.isArray(manifest.resources) || manifest.resources.length !== RESOURCE_IDS.size) {
    throw new Error("Cloud resource manifest target or resource set is invalid.");
  }
  const seen = new Set();
  for (const resource of manifest.resources) {
    if (!RESOURCE_IDS.has(resource?.id) || seen.has(resource.id)) throw new Error("Cloud resource manifest contains an invalid resource ID.");
    seen.add(resource.id);
    if (resource.format !== "tar.gz" || !Number.isSafeInteger(resource.sizeBytes)
      || resource.sizeBytes <= 0 || resource.sizeBytes > 2 * 1024 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(resource.sha256)
      || !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(resource.version)
      || !/^[0-9A-Za-z][0-9A-Za-z._+-]*\.tar\.gz$/.test(resource.fileName)) {
      throw new Error(`Cloud resource ${resource.id} has invalid metadata.`);
    }
    const url = new URL(resource.url);
    if (!((url.protocol === "https:") || (url.protocol === "http:" && ["127.0.0.1", "localhost", "i.ipollo.ai"].includes(url.hostname)))) {
      throw new Error(`Cloud resource ${resource.id} has an unsafe download URL.`);
    }
  }
  const runtime = manifest.resources.find((resource) => resource.id === "hyperframes-runtime");
  if ([...(runtime.requires ?? [])].sort().join(",") !== ["ffmpeg", "ffprobe", "hyperframes-registry"].sort().join(",")) {
    throw new Error("Cloud resource manifest is missing video dependencies.");
  }
  return manifest;
}

export async function fetchDesktopResourceManifest({ baseUrl, appVersion, platform, arch, fetch, trustedKeys }) {
  const origin = new URL(baseUrl);
  if (!((origin.protocol === "https:") || (origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))
    || origin.href === "http://i.ipollo.ai/")) {
    throw new Error("Cloud resource origin is invalid.");
  }
  const target = { appVersion, platform: desktopResourcePlatform(platform), arch };
  const url = new URL("/api/v1/desktop/resources", origin);
  url.search = new URLSearchParams(target).toString();
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Cloud resource manifest returned HTTP ${response.status}. Ask the cloud administrator to publish all six resources for ${appVersion}/${target.platform}/${arch}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Cloud resource manifest returned a non-JSON response.");
  return verifyDesktopResourceManifest(await response.json(), target, trustedKeys);
}
