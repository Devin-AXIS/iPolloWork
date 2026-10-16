import { readFileSync } from "node:fs";

// Resource releases are published independently from desktop application builds.
// Keep this pinned until the cloud has a complete replacement release.
export const DESKTOP_RESOURCE_APP_VERSION = "0.50.13";

let cachedDevelopmentVersion = null;

export function resolveDesktopAppVersion(app) {
  const runtimeVersion = app.getVersion();
  if (app.isPackaged) return runtimeVersion;
  if (cachedDevelopmentVersion) return cachedDevelopmentVersion;
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    cachedDevelopmentVersion = packageJson.version || runtimeVersion;
  } catch {
    cachedDevelopmentVersion = runtimeVersion;
  }
  return cachedDevelopmentVersion;
}
