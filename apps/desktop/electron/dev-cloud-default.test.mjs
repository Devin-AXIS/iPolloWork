import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const devScript = readFileSync(fileURLToPath(new URL("../scripts/electron-dev.mjs", import.meta.url)), "utf8");
const iconScript = readFileSync(fileURLToPath(new URL("../scripts/generate-icons.mjs", import.meta.url)), "utf8");
const main = readFileSync(fileURLToPath(new URL("./main.mjs", import.meta.url)), "utf8");
const workspacePackage = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"));

test("Electron development defaults to the configured iPolloCloud URL", () => {
  assert.match(devScript, /process\.env\.VITE_DEN_BASE_URL\?\.trim\(\) \|\| "http:\/\/i\.ipollo\.ai"/);
  assert.match(devScript, /VITE_DEN_BASE_URL: developmentCloudUrl/);
  assert.match(main, /process\.env\.VITE_DEN_BASE_URL\?\.trim\(\) \|\| "http:\/\/i\.ipollo\.ai"/);
});

test("development startup does not auto-install dependencies when the registry is unavailable", () => {
  assert.match(workspacePackage.scripts.dev, /pnpm_config_verify_deps_before_run=warn/);
  assert.match(workspacePackage.scripts["dev:electron"], /pnpm_config_verify_deps_before_run=warn/);
});

test("embedded server requests use Electron's system-proxy-aware network stack", () => {
  assert.match(main, /Symbol\.for\("ipollowork\.mediaProviderFetch"\), electronNet\.fetch\.bind\(electronNet\)/);
  assert.doesNotMatch(main, /globalThis\.fetch\s*=/);
});

test("macOS development shell embeds the iPollo application icon", () => {
  assert.match(devScript, /copyFileSync\(macAppIcon, macDevElectronIcon\)/);
  assert.match(devScript, /"CFBundleIconFile",\s+"-string",\s+"ipollowork\.icns"/);
});

test("macOS icon keeps native safe-area breathing room", () => {
  assert.match(iconScript, /const MAC_ICON_CANVAS_RATIO = 0\.92/);
  assert.match(iconScript, /background: \{ r: 0, g: 0, b: 0, alpha: 0 \}/);
});
