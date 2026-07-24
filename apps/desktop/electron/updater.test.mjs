import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  clearLegacyElectronUpdaterChannel,
  electronUpdaterFeedUrl,
  normalizeElectronUpdaterChannel,
  staleUpdaterStatePaths,
} from "./updater.mjs";

const fakeApp = { getPath: (key) => (key === "home" ? "/Users/test" : `/Users/test/${key}`) };

describe("staleUpdaterStatePaths", () => {
  it("targets the ShipIt cache on macOS", { skip: process.platform !== "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), [
      "/Users/test/Library/Caches/com.differentai.ipollowork.ShipIt",
    ]);
  });

  it("is a no-op off macOS", { skip: process.platform === "darwin" }, () => {
    assert.deepEqual(staleUpdaterStatePaths(fakeApp), []);
  });
});

describe("official updater feed", () => {
  it("always normalizes retired alpha preferences to stable", () => {
    assert.equal(normalizeElectronUpdaterChannel("alpha"), "stable");
    assert.equal(normalizeElectronUpdaterChannel("stable"), "stable");
    assert.equal(
      electronUpdaterFeedUrl("alpha"),
      "https://github.com/Devin-AXIS/iPolloWork/releases/latest/download",
    );
  });

  it("clears the retired per-user alpha channel preference", async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), "ipollowork-updater-"));
    const preferencePath = path.join(userData, "electron-updater-channel.v1.json");
    try {
      await writeFile(preferencePath, '{"channel":"alpha"}\n', "utf8");
      await clearLegacyElectronUpdaterChannel({ getPath: () => userData });
      await assert.rejects(() => access(preferencePath));
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });
});
