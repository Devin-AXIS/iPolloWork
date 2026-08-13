import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyEmbeddedServerEnvironment,
  commandMatchesPackagedSidecar,
  devModeHomeDirectoryPaths,
  embeddedServerImportUrl,
  managedOpencodeEnvironment,
  prioritizeWorkspacePaths,
  resolveiPolloWorkServerConfigPath,
  seedWorkspacePathsForEmbeddedServer,
  selectStickyiPolloWorkPortWorkspace,
  stageBundledOpencodeRuntime,
  windowsProxyEnvFromServer,
} from "./runtime.mjs";

describe("windowsProxyEnvFromServer", () => {
  it("maps a Windows system proxy to child-process proxy variables", () => {
    assert.deepEqual(windowsProxyEnvFromServer("127.0.0.1:7890"), {
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "127.0.0.1,localhost,::1",
      NODE_USE_ENV_PROXY: "1",
    });
  });

  it("does not replace an explicitly configured proxy", () => {
    assert.deepEqual(windowsProxyEnvFromServer("127.0.0.1:7890", {
      HTTPS_PROXY: "http://proxy.example:8080",
    }), {});
  });
});

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

describe("managedOpencodeEnvironment", () => {
  it("forwards only managed OpenCode home and config paths", () => {
    assert.deepEqual(managedOpencodeEnvironment({
      HOME: " C:\\runtime-home ",
      OPENCODE_CONFIG_DIR: "C:\\runtime-config",
      OPENAI_API_KEY: "must-not-be-copied",
    }), {
      HOME: "C:\\runtime-home",
      OPENCODE_CONFIG_DIR: "C:\\runtime-config",
    });
  });
});

describe("stageBundledOpencodeRuntime", () => {
  it("overlays bootstrap files without deleting user configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-opencode-bootstrap-"));
    const sourceDir = path.join(root, "source");
    const targetDir = path.join(root, "target");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(sourceDir, "package.json"), '{"dependencies":{"@opencode-ai/plugin":"1.18.16"}}\n');
    await writeFile(path.join(sourceDir, "package-lock.json"), '{"lockfileVersion":3,"packages":{"":{"dependencies":{"@opencode-ai/plugin":"1.18.16"}},"node_modules/@opencode-ai/plugin":{"version":"1.18.16"}}}\n');
    await writeFile(path.join(targetDir, "package.json"), '{"userSetting":true,"dependencies":{"user-plugin":"1.0.0"}}\n');
    await writeFile(path.join(targetDir, "package-lock.json"), '{"lockfileVersion":3,"packages":{"":{"dependencies":{"user-plugin":"1.0.0"}},"node_modules/user-plugin":{"version":"1.0.0"}}}\n');
    await writeFile(path.join(targetDir, "opencode.jsonc"), "// user config\n");

    try {
      assert.equal(stageBundledOpencodeRuntime(sourceDir, targetDir), true);
      const stagedPackage = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
      assert.equal(stagedPackage.userSetting, true);
      assert.deepEqual(stagedPackage.dependencies, {
        "@opencode-ai/plugin": "1.18.16",
        "user-plugin": "1.0.0",
      });
      const stagedLock = JSON.parse(await readFile(path.join(targetDir, "package-lock.json"), "utf8"));
      assert.equal(stagedLock.packages["node_modules/user-plugin"].version, "1.0.0");
      assert.equal(stagedLock.packages["node_modules/@opencode-ai/plugin"].version, "1.18.16");
      assert.equal(await readFile(path.join(targetDir, "opencode.jsonc"), "utf8"), "// user config\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
