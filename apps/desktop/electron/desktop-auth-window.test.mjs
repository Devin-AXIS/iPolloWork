import assert from "node:assert/strict";
import test from "node:test";

import { classifyDesktopAuthNavigation } from "./desktop-auth-window.mjs";

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
