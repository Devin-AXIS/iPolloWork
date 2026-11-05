import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DESKTOP_RESOURCE_APP_VERSION, resolveDesktopAppVersion } from "./app-version.mjs";

test("uses the desktop package version in development instead of Electron's version", () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(resolveDesktopAppVersion({ getVersion: () => "35.7.5", isPackaged: false }), version);
});

test("uses Electron's configured application version when packaged", () => {
  assert.equal(resolveDesktopAppVersion({ getVersion: () => "1.2.3", isPackaged: true }), "1.2.3");
});

test("pins optional desktop resources to the published compatibility release", () => {
  assert.equal(DESKTOP_RESOURCE_APP_VERSION, "0.50.13");
});
