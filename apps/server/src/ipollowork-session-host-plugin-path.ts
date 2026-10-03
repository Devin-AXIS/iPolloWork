import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resourcesPathFromAppAsarPath(path: string): string | null {
  const match = /[\\/]app\.asar(?:[\\/]|$)/.exec(path);
  return match ? path.slice(0, match.index) : null;
}

function electronResourcesPath(here: string): string | null {
  const resourcesPath = resourcesPathFromAppAsarPath(here);
  if (!resourcesPath) return null;
  const processResourcesPath = process.resourcesPath?.includes("app.asar")
    ? resourcesPath
    : process.resourcesPath?.trim();
  return processResourcesPath || resourcesPath;
}

function ipolloworkPluginPath(name: string, here = dirname(fileURLToPath(import.meta.url))): string {
  const resourcesPath = electronResourcesPath(here);
  if (resourcesPath) {
    return join(resourcesPath, "opencode-plugins", `${name}.js`);
  }

  const extension = basename(here) === "dist" ? "js" : "ts";
  return join(here, "opencode-plugins", `${name}.${extension}`);
}

export const ipolloworkSessionHostPluginPath = () => ipolloworkPluginPath("ipollowork-session-host");
