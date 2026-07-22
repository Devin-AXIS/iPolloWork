import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyEmbeddedServerEnvironment,
  commandMatchesPackagedSidecar,
  devModeHomeDirectoryPaths,
  embeddedServerImportUrl,
  prioritizeWorkspacePaths,
  resolveiPolloWorkServerConfigPath,
  seedWorkspacePathsForEmbeddedServer,
  selectStickyiPolloWorkPortWorkspace,
} from "./runtime.mjs";

describe("applyEmbeddedServerEnvironment", () => {
  it("keeps the desktop process home and config locations outside the dev child sandbox", () => {
    const desktopEnv = {
      APPDATA: "C:\\Users\\Lenovo\\AppData\\Roaming",
      HOME: "C:\\Users\\Lenovo",
      USERPROFILE: "C:\\Users\\Lenovo",
      XDG_CONFIG_HOME: "C:\\Users\\Lenovo\\.config",
    };
    const childEnv = {
      ...desktopEnv,
      HOME: "C:\\Users\\Lenovo\\AppData\\Roaming\\com.differentai.ipollowork.dev\\ipollowork-dev-data\\home",
      USERPROFILE: "C:\\Users\\Lenovo\\AppData\\Roaming\\com.differentai.ipollowork.dev\\ipollowork-dev-data\\home",
      XDG_CONFIG_HOME: "C:\\Users\\Lenovo\\AppData\\Roaming\\com.differentai.ipollowork.dev\\ipollowork-dev-data\\xdg\\config",
      OPENCODE_CONFIG_DIR: "C:\\Users\\Lenovo\\AppData\\Roaming\\com.differentai.ipollowork.dev\\ipollowork-dev-data\\config\\opencode",
      OPENAI_API_KEY: "test-key",
    };

    applyEmbeddedServerEnvironment(desktopEnv, childEnv);

    assert.equal(desktopEnv.HOME, "C:\\Users\\Lenovo");
    assert.equal(desktopEnv.USERPROFILE, "C:\\Users\\Lenovo");
    assert.equal(desktopEnv.XDG_CONFIG_HOME, "C:\\Users\\Lenovo\\.config");
    assert.equal(desktopEnv.OPENCODE_CONFIG_DIR, undefined);
    assert.equal(desktopEnv.OPENAI_API_KEY, "test-key");
  });
});

describe("devModeHomeDirectoryPaths", () => {
  it("includes common shell folders used by Windows file pickers", () => {
    const homeDir = path.join("tmp", "home");
    assert.deepEqual(devModeHomeDirectoryPaths(homeDir), [
      path.join(homeDir, "Desktop"),
      path.join(homeDir, "Downloads"),
      path.join(homeDir, "Documents"),
    ]);
  });
});

describe("prioritizeWorkspacePaths", () => {
  it("keeps the active runtime workspace first", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current", ["/workspace/other", "/workspace/current"]),
      ["/workspace/current", "/workspace/other"],
    );
  });

  it("dedupes equivalent paths", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current/../current", ["/workspace/current"]),
      ["/workspace/current/../current"],
    );
  });
});

describe("seedWorkspacePathsForEmbeddedServer", () => {
  it("uses persisted server config instead of Electron workspace state once config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/legacy"], true),
      [],
    );
  });

  it("seeds from Electron workspace state before server config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/first"], false),
      ["/workspace/first"],
    );
  });
});

describe("selectStickyiPolloWorkPortWorkspace", () => {
  it("uses the requested workspace even when server config owns workspace loading", () => {
    assert.equal(
      selectStickyiPolloWorkPortWorkspace(["/workspace/current"], []),
      "/workspace/current",
    );
  });

  it("falls back to server workspace paths when no requested path is available", () => {
    assert.equal(
      selectStickyiPolloWorkPortWorkspace([], ["/workspace/from-server"]),
      "/workspace/from-server",
    );
  });
});

describe("commandMatchesPackagedSidecar", () => {
  it("matches packaged opencode sidecars with platform suffixes", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/Applications/iPolloWork.app/Contents/Resources/sidecars/opencode-aarch64-apple-darwin serve --hostname 127.0.0.1 --port 49174 --cors *",
        ["/Applications/iPolloWork.app/Contents/Resources/sidecars"],
      ),
      true,
    );
  });

  it("does not match unrelated opencode processes outside sidecar directories", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/usr/local/bin/opencode serve --hostname 127.0.0.1 --port 49174",
        ["/Applications/iPolloWork.app/Contents/Resources/sidecars"],
      ),
      false,
    );
  });
});

describe("embeddedServerImportUrl", () => {
  it("returns the same file URL for unchanged metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-runtime-"));
    try {
      const embeddedPath = path.join(dir, "embedded.js");
      await writeFile(embeddedPath, "export const value = 1;\n");

      const first = embeddedServerImportUrl(embeddedPath);
      const second = embeddedServerImportUrl(embeddedPath);
      const url = new URL(first);

      assert.equal(first, second);
      assert.equal(url.protocol, "file:");
      assert.equal(fileURLToPath(url), embeddedPath);
      assert.ok(url.searchParams.get("mtimeMs"));
      assert.equal(url.searchParams.get("size"), String("export const value = 1;\n".length));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("changes when the file metadata changes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ipollowork-runtime-"));
    try {
      const embeddedPath = path.join(dir, "embedded.js");
      await writeFile(embeddedPath, "export const value = 1;\n");
      const first = embeddedServerImportUrl(embeddedPath);

      await writeFile(embeddedPath, "export const value = 12;\n");

      assert.notEqual(embeddedServerImportUrl(embeddedPath), first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the plain file URL if stat fails", () => {
    const missingPath = path.join(os.tmpdir(), "ipollowork-missing-embedded.js");

    assert.equal(embeddedServerImportUrl(missingPath), pathToFileURL(missingPath).href);
  });
});

describe("resolveiPolloWorkServerConfigPath", () => {
  it("respects explicit server config path", () => {
    assert.equal(
      resolveiPolloWorkServerConfigPath({ IPOLLOWORK_SERVER_CONFIG: "/tmp/ipollowork/server.json" }),
      path.resolve("/tmp/ipollowork/server.json"),
    );
  });

  it("uses XDG config home on Unix", () => {
    if (process.platform === "win32") return;
    assert.equal(
      resolveiPolloWorkServerConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" }),
      "/tmp/xdg/ipollowork/server.json",
    );
  });
});
