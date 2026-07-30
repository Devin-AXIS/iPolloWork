import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const devScript = readFileSync(fileURLToPath(new URL("../scripts/electron-dev.mjs", import.meta.url)), "utf8");
const main = readFileSync(fileURLToPath(new URL("./main.mjs", import.meta.url)), "utf8");

test("Electron development defaults to the configured iPolloCloud URL", () => {
  assert.match(devScript, /process\.env\.VITE_DEN_BASE_URL\?\.trim\(\) \|\| "http:\/\/i\.ipollo\.ai"/);
  assert.match(devScript, /VITE_DEN_BASE_URL: developmentCloudUrl/);
  assert.match(main, /process\.env\.VITE_DEN_BASE_URL\?\.trim\(\) \|\| "http:\/\/i\.ipollo\.ai"/);
});
