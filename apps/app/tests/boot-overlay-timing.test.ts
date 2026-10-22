import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import {
  BOOT_OVERLAY_FADE_MS,
  MIN_BOOT_OVERLAY_MS,
  remainingBootOverlayHoldMs,
} from "../src/react-app/shell/boot-overlay-timing";

const startupHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const loadingOverlay = readFileSync(
  new URL("../src/react-app/shell/loading-overlay.tsx", import.meta.url),
  "utf8",
);

describe("desktop boot overlay timing", () => {
  test("keeps the loading animation visible on a fast cold start", () => {
    expect(MIN_BOOT_OVERLAY_MS).toBeGreaterThanOrEqual(800);
    expect(remainingBootOverlayHoldMs(100)).toBe(MIN_BOOT_OVERLAY_MS - 100);
  });

  test("does not add delay after a slow boot and retains a fade", () => {
    expect(remainingBootOverlayHoldMs(MIN_BOOT_OVERLAY_MS + 1)).toBe(0);
    expect(remainingBootOverlayHoldMs(-10)).toBe(MIN_BOOT_OVERLAY_MS);
    expect(BOOT_OVERLAY_FADE_MS).toBeGreaterThan(0);
  });

  test("uses the branded animation on the application surface instead of a black startup frame", () => {
    expect(startupHtml).toContain("ipollowork-app-loading-v3.gif");
    expect(startupHtml).toContain("background: #fcfcfd");
    expect(startupHtml).not.toContain("background: #000000");
    expect(loadingOverlay).toContain('publicAssetUrl("ipollowork-app-loading-v3.gif")');
    expect(loadingOverlay).toContain("bg-dls-surface");
    expect(loadingOverlay).not.toContain("bg-black transition-opacity");
  });
});

const recoveryScript = startupHtml.match(/<script id="ipollowork-startup-recovery">([\s\S]*?)<\/script>/)?.[1];
if (!recoveryScript) throw new Error("Startup recovery must run inline before module imports");

function startupRecovery(storage = new Map<string, string>(), unavailableStorage = false) {
  const root = { dataset: { ipolloworkDeployment: "" } };
  const panel = { hidden: true };
  const message = { textContent: "" };
  const button = { textContent: "", onclick: () => {} };
  const elements = new Map<string, object>([
    ["root", root], ["ipollowork-startup-error", panel],
    ["ipollowork-startup-message", message], ["ipollowork-startup-retry", button],
  ]);
  const listeners = new Map<string, (event?: object) => void>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  let reloads = 0;
  runInNewContext(recoveryScript, {
    document: { getElementById: (id: string) => elements.get(id) },
    navigator: { language: "en" },
    localStorage: { getItem: () => "zh" },
    sessionStorage: {
      getItem: (key: string) => { if (unavailableStorage) throw new Error("Blocked"); return storage.get(key); },
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    location: { reload: () => reloads++ },
    setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    window: {
      addEventListener: (name: string, callback: (event?: object) => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
  });
  return {
    root, panel, message, button, storage, timers, listeners,
    fail: (target: object = { tagName: "SCRIPT", type: "module" }) => listeners.get("error")?.({ target }),
    loaded: () => listeners.get("load")?.(),
    runTimer: (delay: number) => {
      const timer = [...timers.values()].find((entry) => entry.delay === delay);
      if (!timer) throw new Error(`No timer scheduled for ${delay}ms`);
      timer.callback();
    },
    reloads: () => reloads,
  };
}

describe("startup resource failure recovery", () => {
  test("recovers a failed entry graph once even when several modules fail", () => {
    const boot = startupRecovery();
    boot.fail();
    boot.fail();
    expect(boot.storage.get("ipollowork.startupRetries")).toBe("1");
    boot.runTimer(1000);
    expect(boot.reloads()).toBe(1);
  });

  test("bounds consecutive reloads and offers a working manual retry", () => {
    const storage = new Map<string, string>();
    const first = startupRecovery(storage);
    first.fail();
    first.runTimer(1000);
    const second = startupRecovery(storage);
    second.fail({ tagName: "LINK", rel: "stylesheet" });
    second.runTimer(2000);
    const third = startupRecovery(storage);
    third.fail();
    expect(third.panel.hidden).toBe(false);
    expect(third.message.textContent).toContain("启动资源加载失败");
    expect(third.reloads()).toBe(0);
    third.button.onclick();
    expect(storage.size).toBe(0);
    expect(third.reloads()).toBe(1);
  });

  test("successful startup resets the retry budget and removes recovery work", () => {
    const boot = startupRecovery(new Map([["ipollowork.startupRetries", "2"]]));
    boot.root.dataset.ipolloworkDeployment = "local";
    boot.loaded();
    expect(boot.storage.size).toBe(0);
    expect(boot.timers.size).toBe(0);
    expect(boot.listeners.has("error")).toBe(false);
  });

  test("does not reload a running app or react to unrelated images and runtime errors", () => {
    const boot = startupRecovery();
    boot.fail({ tagName: "IMG" });
    boot.fail({ message: "unrelated error" });
    expect(boot.storage.size).toBe(0);
    boot.fail();
    boot.root.dataset.ipolloworkDeployment = "local";
    boot.runTimer(1000);
    boot.runTimer(45000);
    expect(boot.reloads()).toBe(0);
    expect(boot.panel.hidden).toBe(true);
  });

  test("storage restrictions and hung startup still allow manual recovery", () => {
    const blocked = startupRecovery(new Map(), true);
    blocked.fail();
    expect(blocked.panel.hidden).toBe(false);
    expect(blocked.reloads()).toBe(0);
    const hung = startupRecovery();
    hung.runTimer(45000);
    expect(hung.panel.hidden).toBe(false);
    expect(hung.reloads()).toBe(0);
  });
});
