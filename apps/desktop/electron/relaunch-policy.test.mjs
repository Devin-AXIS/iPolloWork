import assert from "node:assert/strict";
import { test } from "node:test";

import { relaunchActionForMode } from "./relaunch-policy.mjs";

test("relaunchActionForMode reloads the window in development instead of spawning outside the dev runner", () => {
  assert.equal(relaunchActionForMode(true), "reload-window");
  assert.equal(relaunchActionForMode(false), "relaunch-app");
});
