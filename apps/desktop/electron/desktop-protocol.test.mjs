import assert from "node:assert/strict";
import test from "node:test";

import {
  registerDesktopProtocolClient,
  resolveDesktopProtocolRegistration,
} from "./desktop-protocol.mjs";

test("packaged apps keep the production protocol", () => {
  assert.deepEqual(
    resolveDesktopProtocolRegistration({
      isDevMode: false,
      isPackaged: true,
      execPath: "/Applications/iPollo.app/Contents/MacOS/iPollo",
      entryPath: null,
    }),
    { scheme: "ipollowork", executablePath: null, args: [] },
  );
});

test("development apps register an isolated protocol with the Electron entrypoint", () => {
  const registration = resolveDesktopProtocolRegistration({
    isDevMode: true,
    isPackaged: false,
    execPath: "/repo/node_modules/electron/Electron",
    entryPath: "/repo/apps/desktop/electron/main.mjs",
  });
  assert.deepEqual(registration, {
    scheme: "ipollowork-dev",
    executablePath: "/repo/node_modules/electron/Electron",
    args: ["/repo/apps/desktop/electron/main.mjs"],
  });

  const calls = [];
  const app = {
    setAsDefaultProtocolClient(...args) {
      calls.push(args);
      return true;
    },
  };
  assert.equal(registerDesktopProtocolClient(app, registration), true);
  assert.deepEqual(calls, [[
    "ipollowork-dev",
    "/repo/node_modules/electron/Electron",
    ["/repo/apps/desktop/electron/main.mjs"],
  ]]);
});

test("unpackaged non-development launches do not take over a protocol", () => {
  assert.equal(
    resolveDesktopProtocolRegistration({
      isDevMode: false,
      isPackaged: false,
      execPath: "/repo/node_modules/electron/Electron",
      entryPath: "/repo/apps/desktop/electron/main.mjs",
    }),
    null,
  );
});
