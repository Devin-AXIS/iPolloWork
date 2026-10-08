import { DESKTOP_RESOURCE_APP_VERSION } from "../../apps/desktop/electron/app-version.mjs";
import { fetchDesktopResourceManifest } from "../../apps/desktop/electron/desktop-resource-manifest.mjs";

const DEFAULT_BASE_URL = "http://i.ipollo.ai";
const RELEASE_TARGETS = [
  { platform: "darwin", arch: "arm64", label: "macos/arm64" },
  { platform: "darwin", arch: "x64", label: "macos/x64" },
  { platform: "linux", arch: "arm64", label: "linux/arm64" },
  { platform: "linux", arch: "x64", label: "linux/x64" },
  { platform: "win32", arch: "arm64", label: "windows/arm64" },
  { platform: "win32", arch: "x64", label: "windows/x64" },
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : null;
}

const baseUrl = argument("--base-url")
  || process.env.IPOLLOWORK_DESKTOP_RESOURCE_BASE_URL?.trim()
  || DEFAULT_BASE_URL;
const requestedTarget = argument("--target");
const targets = requestedTarget
  ? RELEASE_TARGETS.filter((target) => target.label === requestedTarget)
  : RELEASE_TARGETS;

if (requestedTarget && targets.length === 0) {
  throw new Error(`Unknown desktop resource target: ${requestedTarget}`);
}

const results = await Promise.all(targets.map(async (target) => {
  try {
    const manifest = await fetchDesktopResourceManifest({
      baseUrl,
      appVersion: DESKTOP_RESOURCE_APP_VERSION,
      platform: target.platform,
      arch: target.arch,
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }),
    });
    return {
      ...target,
      ok: true,
      resources: manifest.resources.map((resource) => `${resource.id}@${resource.version}`),
    };
  } catch (error) {
    return {
      ...target,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}));

console.log(`Desktop resource release ${DESKTOP_RESOURCE_APP_VERSION} at ${baseUrl}`);
for (const result of results) {
  if (result.ok) console.log(`- ok: ${result.label} (${result.resources.join(", ")})`);
  else console.error(`- fail: ${result.label} (${result.error})`);
}

if (results.some((result) => !result.ok)) {
  console.error("Refusing to release a desktop app whose signed runtime resources are incomplete.");
  process.exit(1);
}
