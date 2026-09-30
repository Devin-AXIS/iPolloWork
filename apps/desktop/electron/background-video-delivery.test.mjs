import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundVideoDeliverySupervisor,
  deliveryRoute,
  pendingVideoDeliveries,
} from "./background-video-delivery.mjs";

const now = Date.now();
const first = { workspaceId: "ws_first", sessionId: "session-first", intent: "publish-douyin", storedAt: now };
const second = { workspaceId: "ws_second", sessionId: "session-second", intent: "publish-wechat-channels", storedAt: now };

test("ignores malformed, expired, and unsafe saved deliveries", () => {
  assert.deepEqual(pendingVideoDeliveries(JSON.stringify([
    first,
    { ...second, storedAt: now - 8 * 24 * 60 * 60_000 },
    { ...second, sessionId: "../../other" },
  ]), now), [first]);
  assert.deepEqual(pendingVideoDeliveries("not json", now), []);
});

test("runs one inactive task in a hidden worker and advances when it settles", async () => {
  let href = `http://localhost:5173/${deliveryRoute(first)}`;
  let entries = [first, second];
  let readyFirst = false;
  const windows = [];
  const main = {
    isDestroyed: () => false,
    webContents: {
      isLoading: () => false,
      executeJavaScript: async () => ({ href, deliveries: JSON.stringify(entries) }),
    },
  };
  const supervisor = createBackgroundVideoDeliverySupervisor({
    getMainWindow: () => main,
    isReady: async (entry) => entry.sessionId !== "session-first" || readyFirst,
    createWorkerWindow: () => {
      const win = {
        url: null,
        closed: false,
        isDestroyed() { return this.closed; },
        close() { this.closed = true; },
        async loadURL(url) { this.url = url; },
      };
      windows.push(win);
      return win;
    },
  });
  await supervisor.checkNow();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].url, `http://localhost:5173/?ipolloworkBackgroundDelivery=1${deliveryRoute(second)}`);
  await supervisor.checkNow();
  assert.equal(windows.length, 1, "the same task must not start twice");

  href = `http://localhost:5173/${deliveryRoute(second)}`;
  supervisor.onMainNavigation(href);
  assert.equal(windows[0].closed, true, "a visible task owns its own continuation");

  entries = [first];
  readyFirst = true;
  await supervisor.checkNow();
  assert.equal(windows.length, 2);
  assert.equal(windows[1].url, `http://localhost:5173/?ipolloworkBackgroundDelivery=1${deliveryRoute(first)}`);
  supervisor.stop();
  assert.equal(windows[1].closed, true);
});
