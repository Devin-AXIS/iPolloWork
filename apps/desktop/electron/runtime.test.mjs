import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyEmbeddedServerEnvironment,
  binaryFileNames,
  commandMatchesPackagedSidecar,
  devModeHomeDirectoryPaths,
  embeddedServerImportUrl,
  managedOpencodeEnvironment,
  prioritizeWorkspacePaths,
  resolveiPolloWorkServerConfigPath,
  runtimeProxyEnvironmentFingerprint,
  seedWorkspacePathsForEmbeddedServer,
  selectStickyiPolloWorkPortWorkspace,
  stageBundledOpencodeRuntime,
  windowsProxyEnvFromServer,
} from "./runtime.mjs";

describe("binaryFileNames", () => {
  it("prefers the canonical packaged alias before the target-specific fallback", () => {
    const extension = process.platform === "win32" ? ".exe" : "";
    const names = binaryFileNames("opencode");

    assert.equal(names[0], `opencode${extension}`);
    if (names.length > 1) {
      assert.match(names[1], new RegExp(`^opencode-.+${extension.replace(".", "\\.")}$`));
    }
  });
});

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

  it("preserves an explicit direct connection for all child-process traffic", () => {
    assert.deepEqual(windowsProxyEnvFromServer("127.0.0.1:7890", { NO_PROXY: "*" }), {});
    assert.deepEqual(windowsProxyEnvFromServer("127.0.0.1:7890", { no_proxy: "*" }), {});
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

  it("replaces and removes stale proxy values after a VPN change", () => {
    const desktopEnv = {
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NODE_USE_ENV_PROXY: "1",
      KEEP_ME: "desktop",
    };

    applyEmbeddedServerEnvironment(desktopEnv, {
      HTTP_PROXY: "http://127.0.0.1:7891",
      HTTPS_PROXY: "http://127.0.0.1:7891",
      NODE_USE_ENV_PROXY: "1",
      KEEP_ME: "child",
    });
    assert.equal(desktopEnv.HTTP_PROXY, "http://127.0.0.1:7891");
    assert.equal(desktopEnv.HTTPS_PROXY, "http://127.0.0.1:7891");
    assert.equal(desktopEnv.KEEP_ME, "child");

    const beforeDisable = runtimeProxyEnvironmentFingerprint(desktopEnv);
    applyEmbeddedServerEnvironment(desktopEnv, { KEEP_ME: "without-proxy" });
    assert.equal(desktopEnv.HTTP_PROXY, undefined);
    assert.equal(desktopEnv.HTTPS_PROXY, undefined);
    assert.equal(desktopEnv.NODE_USE_ENV_PROXY, undefined);
    assert.notEqual(runtimeProxyEnvironmentFingerprint(desktopEnv), beforeDisable);
  });
});

describe("managedOpencodeEnvironment", () => {
  it("uses a refreshed local model catalog without enabling startup network fetches", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-model-cache-"));
    const catalogPath = path.join(cacheRoot, "opencode", "models.json");
    try {
      assert.equal(managedOpencodeEnvironment({ XDG_CACHE_HOME: cacheRoot }).OPENCODE_MODELS_PATH, undefined);
      await mkdir(path.dirname(catalogPath));
      await writeFile(catalogPath, '{"openai":{"models":{}}}');
      assert.equal(managedOpencodeEnvironment({ XDG_CACHE_HOME: cacheRoot }).OPENCODE_MODELS_PATH, catalogPath);
      assert.equal(managedOpencodeEnvironment({ XDG_CACHE_HOME: cacheRoot, OPENCODE_MODELS_PATH: "  custom-models.json  " }).OPENCODE_MODELS_PATH, "custom-models.json");
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

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
  it("uses the developer profile even when Windows APPDATA points at production", () => {
    assert.equal(resolveiPolloWorkServerConfigPath({ IPOLLOWORK_DEV_MODE: "1", XDG_CONFIG_HOME: "/isolated/dev/xdg", APPDATA: "/production/appdata" }), path.join("/isolated/dev/xdg", "ipollowork", "server.json"));
    if (process.platform === "win32") {
      assert.equal(resolveiPolloWorkServerConfigPath({ XDG_CONFIG_HOME: "/isolated/dev/xdg", APPDATA: "/production/appdata" }), path.join("/production/appdata", "ipollowork", "server.json"));
    }
  });
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

it("removes development plugin overrides from an embedded production environment", () => {
  const target = { IPOLLOWORK_DEV_MODE: "1", IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR: "C:/old/source", IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR: "C:/source" };
  applyEmbeddedServerEnvironment(target, {});
  assert.deepEqual(target, {});
  applyEmbeddedServerEnvironment(target, { IPOLLOWORK_DEV_MODE: "1", IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR: "C:/dev/source" });
  assert.equal(target.IPOLLOWORK_DEV_MODE, "1");
  assert.equal(target.IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR, "C:/dev/source");
});


describe("desktop runtime ownership", () => {
  async function fixture(t) {
    const { createServer } = await import("node:http");
    const { createRuntimeManager } = await import("./runtime.mjs");
    const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-runtime-"));
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await Promise.all([mkdir(first), mkdir(second)]);
    const prior = { IPOLLOWORK_ENV_STORE: process.env.IPOLLOWORK_ENV_STORE, IPOLLOWORK_DATA_DIR: process.env.IPOLLOWORK_DATA_DIR };
    process.env.IPOLLOWORK_ENV_STORE = path.join(root, "env.json");
    process.env.IPOLLOWORK_DATA_DIR = path.join(root, "data");
    const stats = { starts: 0, live: 0, maxLive: 0, failStarts: 0, failStop: false, unhealthy: false };
    const handles = [];
    const manager = createRuntimeManager({
      app: { getPath: name => name === "userData" ? root : name === "exe" ? process.execPath : root, isPackaged: false },
      desktopRoot: root, listLocalWorkspacePaths: async () => [first, second],
      loadServer: async () => ({ startEmbeddedServer: async () => {
        stats.starts++;
        if (stats.failStarts-- > 0) throw new Error("controlled startup failure");
        stats.unhealthy = false;
        // Keep startup asynchronous so raw activation can race the public start.
        await new Promise(resolve => setTimeout(resolve, 15));
        const server = createServer((req, res) => {
          res.setHeader("Content-Type", "application/json");
          if (stats.unhealthy) { res.statusCode = 503; res.end('{}'); return; }
          res.end(JSON.stringify(req.url === "/tokens" ? { token: "test-owner" } : { items: [first, second].map(p => ({ path: p, opencode: { baseUrl: handle.url, directory: first } })) }));
        });
        await new Promise(resolve => server.listen({ port: 0, host: "127.0.0.1" }, () => resolve(undefined)));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
        stats.live++; stats.maxLive = Math.max(stats.maxLive, stats.live);
        const handle = { port: address.port, url: `http://127.0.0.1:${address.port}`, managedOpencodeExecution: null, stop: async () => {
          if (stats.failStop) throw new Error("controlled shutdown failure");
          if (!server.listening) return;
          await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
          stats.live--;
        } };
        handles.push(handle);
        return handle;
      } }),
    });
    t.after(async () => {
      stats.failStop = false;
      await manager.dispose();
      await Promise.all(handles.map(h => h.stop()));
      for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      await rm(root, { recursive: true, force: true });
    });
    return { manager, stats, handles, first, second, root };
  }

  it("serializes boot, duplicate renderer starts and activation into one healthy server", async t => {
    const { manager, stats, first, second } = await fixture(t);
    await Promise.all([manager.engineStart(first), manager.orchestratorWorkspaceActivate({ workspacePath: first }), ...Array.from({ length: 5 }, () => manager.engineStart(first))]);
    assert.equal(stats.starts, 1);
    assert.equal(stats.maxLive, 1);
    const before = await manager.ipolloworkServerInfo();
    await manager.orchestratorWorkspaceActivate({ workspacePath: second });
    assert.equal((await manager.ipolloworkServerInfo()).baseUrl, before.baseUrl);
    assert.equal(stats.starts, 1, "registered workspace activation must not terminate other tasks");
    await manager.engineStart(path.join(first, "new-project"));
    assert.equal(stats.starts, 1, "new workspace registration uses the profile server, preserving running sessions");
  });

  it("safely replaces an unhealthy owned instance and recovers from a failed start", async t => {
    const { manager, stats, handles, first } = await fixture(t);
    stats.failStarts = 1;
    await manager.engineStart(first);
    assert.equal(stats.starts, 2);
    await handles.at(-1).stop();
    await manager.engineStart(first);
    assert.equal(stats.starts, 3);
    stats.unhealthy = true;
    await manager.engineStart(first);
    stats.unhealthy = false;
    assert.equal(stats.starts, 4);
    assert.equal(stats.live, 1);
    assert.equal(stats.maxLive, 1);
    await Promise.all([manager.engineStop(), manager.engineStart(first), manager.orchestratorWorkspaceActivate({ workspacePath: first })]);
    assert.equal(stats.live, 1);
    assert.equal(stats.maxLive, 1);
  });

  it("never launches over an owned instance that failed to stop, and the queue recovers", async t => {
    const { manager, stats, first } = await fixture(t);
    await manager.engineStart(first);
    stats.failStop = true;
    await assert.rejects(manager.engineRestart(), /controlled shutdown failure/);
    assert.equal(stats.starts, 1);
    assert.equal(stats.live, 1);
    stats.failStop = false;
    await manager.engineRestart();
    assert.equal(stats.live, 1);
    assert.equal(stats.maxLive, 1);
  });

  it("reclaims an actual orphan after a crash without killing an unrelated process", { skip: process.platform === "win32" }, async t => {
    const { spawn } = await import("node:child_process");
    const { copyFile, realpath } = await import("node:fs/promises");
    const { manager, root } = await fixture(t);
    const directory = path.join(await realpath(root), "engine-packs", "process-test");
    await mkdir(directory, { recursive: true });
    const binary = path.join(directory, "sleep");
    await copyFile("/bin/sleep", binary);
    const unrelated = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    const launcher = spawn(process.execPath, ["-e", `const {spawn}=require('node:child_process');const child=spawn(${JSON.stringify(binary)},['60'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000);`], { stdio: ["ignore", "pipe", "inherit"] });
    const chunk = await new Promise(resolve => launcher.stdout.once("data", value => resolve(value)));
    const pid = Number(String(chunk).trim());
    t.after(() => { unrelated.kill("SIGKILL"); launcher.kill("SIGKILL"); try { process.kill(pid, "SIGKILL"); } catch {} });
    const exited = new Promise(resolve => launcher.once("exit", () => resolve(undefined)));
    launcher.kill("SIGKILL");
    await exited;
    await manager.prepareFreshRuntime();
    let running = true;
    for (let i = 0; i < 100 && running; i++) {
      try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 10)); } catch { running = false; }
    }
    assert.equal(running, false, "the private orphan must be reclaimed before another writer starts");
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
  });

  it("only selects orphaned private engines from this profile", async () => {
    const { orphanedManagedRuntimeProcesses } = await import("./runtime.mjs");
    const cli = "/profile/engine-packs/codex/cli";
    const rows = [
      { pid: 10, ppid: 1, command: "Electron /profile/engine-packs/codex/bin/codex.js" },
      { pid: 11, ppid: 10, command: cli },
      { pid: 12, ppid: 1, command: cli },
      { pid: 20, ppid: 90, command: "Electron /profile/engine-packs/codex/bin/codex.js" },
      { pid: 21, ppid: 20, command: cli },
      { pid: 30, ppid: 1, command: "/other-profile/engine-packs/codex/cli" },
      { pid: 40, ppid: 1, command: "/usr/local/bin/codex" },
      { pid: 50, ppid: 1, command: "/Applications/ChatGPT.app/codex" },
      { pid: 60, ppid: 1, command: "/app/resources/sidecars/opencode" },
    ];
    assert.deepEqual(orphanedManagedRuntimeProcesses(rows, "/profile").map(p => p.pid), [11, 12]);
  });
});
