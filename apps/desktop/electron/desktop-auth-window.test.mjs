import assert from "node:assert/strict";
import test from "node:test";

import {
  clearDesktopAuthSession,
  classifyDesktopAuthNavigation,
  DESKTOP_AUTH_SESSION_PARTITION,
  desktopAuthCallbackBrandScript,
  isProviderAuthCallbackUrl,
} from "./desktop-auth-window.mjs";

test("clears the isolated desktop authentication session", async () => {
  const calls = [];
  const authSession = {
    async clearStorageData() {
      calls.push(["storage"]);
    },
    async clearCache() {
      calls.push(["cache"]);
    },
  };

  await clearDesktopAuthSession({
    fromPartition(partition) {
      calls.push(["partition", partition]);
      return authSession;
    },
  });

  assert.deepEqual(calls, [
    ["partition", DESKTOP_AUTH_SESSION_PARTITION],
    ["storage"],
    ["cache"],
  ]);
});

test("keeps HTTPS identity redirects inside the isolated auth window", () => {
  assert.deepEqual(
    classifyDesktopAuthNavigation("https://accounts.example.com/authorize?state=one"),
    { kind: "allow", url: "https://accounts.example.com/authorize?state=one" },
  );
});

test("allows the isolated auth window load-error page", () => {
  const url = "data:text/html;charset=utf-8,%3C!doctype%20html%3E";
  assert.deepEqual(classifyDesktopAuthNavigation(url), { kind: "allow", url });
});

test("captures only Den desktop callbacks for the app handoff", () => {
  assert.deepEqual(
    classifyDesktopAuthNavigation("ipollowork://den-auth?grant=one-time"),
    { kind: "complete", url: "ipollowork://den-auth?grant=one-time" },
  );
  assert.deepEqual(
    classifyDesktopAuthNavigation("ipollowork-dev://callback/den-auth?grant=one-time"),
    { kind: "complete", url: "ipollowork-dev://callback/den-auth?grant=one-time" },
  );
  assert.deepEqual(
    classifyDesktopAuthNavigation("ipollowork://open-workspace?id=123"),
    { kind: "external", url: "ipollowork://open-workspace?id=123" },
  );
});

test("captures the isolated auth window close control without opening it externally", () => {
  assert.deepEqual(
    classifyDesktopAuthNavigation("ipollowork-auth-window://close"),
    { kind: "cancel" },
  );
  assert.deepEqual(
    classifyDesktopAuthNavigation("ipollowork-auth-window://close/"),
    { kind: "cancel" },
  );
});

test("does not navigate an auth window to arbitrary local protocols", () => {
  assert.deepEqual(
    classifyDesktopAuthNavigation("file:///tmp/untrusted.html"),
    { kind: "external", url: "file:///tmp/untrusted.html" },
  );
  assert.deepEqual(classifyDesktopAuthNavigation("not a url"), { kind: "block" });
});

test("detects local provider OAuth callback success pages", () => {
  assert.equal(isProviderAuthCallbackUrl("http://localhost:1455/auth/callback?code=abc"), true);
  assert.equal(isProviderAuthCallbackUrl("http://127.0.0.1:1455/auth/callback?code=abc"), true);
  assert.equal(isProviderAuthCallbackUrl("https://accounts.openai.com/oauth/callback"), false);
  assert.equal(isProviderAuthCallbackUrl("http://localhost:1455/not-callback"), false);
});

test("builds iPolloWork branding script for local provider callback success pages", () => {
  const script = desktopAuthCallbackBrandScript({ appName: "iPolloWork" });

  assert.match(script, /iPolloWork/);
  assert.match(script, /logoCandidate/);
  assert.match(script, /0 0 512 512/);
  assert.match(script, /is now connected to ChatGPT/);
  assert.doesNotMatch(script, /M92 150 L238 250 L384 150/);
  assert.doesNotMatch(script, /#C5C4C4/);
  assert.doesNotMatch(script, /openCODE/);
  assert.doesNotMatch(script, /OpenCode is now connected to ChatGPT/);
});
