import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEmbeddedServer } from "./embedded.js";
import * as managedOpencode from "./managed-opencode.js";
import { forwardedProxyEnv, offlineFirstOpencodeEnv } from "./managed-opencode.js";

describe("managed OpenCode conversations", () => {
  test("serves OpenCode conversations in native-default projects from a neutral daemon directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipollowork-managed-conversation-"));
    const projectRoot = join(root, "project");
    const neutralRoot = join(root, "managed-opencode-workdir");
    const configPath = join(root, "server.json");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(configPath, JSON.stringify({ host: "127.0.0.1", port: 0, token: "test-token", hostToken: "host-token", approval: { mode: "auto" },
      workspaces: [
        { id: "native-project", path: projectRoot, workspaceType: "local", engineId: "codex-harness" },
        { id: "remote-project", path: "/remote/project", workspaceType: "remote", engineId: "deepseek-harness" },
      ],
    }));
    const directories: Array<string | null> = [];
    const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/session" && request.method === "POST") {
        directories.push(request.headers.get("x-opencode-directory"));
        return Response.json({ id: "managed-conversation", title: "New conversation", directory: projectRoot, time: { created: Date.now(), updated: Date.now() } });
      }
      return Response.json({});
    } });
    const spawn = spyOn(managedOpencode, "createManagedOpencodeServer").mockImplementation(async (options) => ({
      url: `http://127.0.0.1:${engine.port}`, username: "managed-user", password: "managed-password", pid: null,
      execution: { command: "opencode", args: [], cwd: options.cwd, env: [] },
      close: async () => {},
    }));
    let handle: Awaited<ReturnType<typeof startEmbeddedServer>> | undefined;
    try {
      handle = await startEmbeddedServer({ configPath, workspaces: [], manageOpencode: true, opencodeCwd: neutralRoot, logRequests: false });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(handle.managedOpencodeExecution?.cwd).toBe(neutralRoot);
      const local = handle.config.workspaces.find((workspace) => workspace.id === "native-project");
      const remote = handle.config.workspaces.find((workspace) => workspace.id === "remote-project");
      expect(local).toMatchObject({ engineId: "codex-harness", baseUrl: `http://127.0.0.1:${engine.port}`, directory: projectRoot });
      expect(remote?.baseUrl).toBeUndefined();
      expect(remote?.directory).toBeUndefined();
      const runtimeConfigPath = spawn.mock.calls[0]?.[0].env?.OPENCODE_CONFIG;
      if (!runtimeConfigPath) throw new Error("Managed runtime config must be supplied");
      expect(JSON.parse(await readFile(runtimeConfigPath, "utf8"))).toHaveProperty("agent.ipollowork");
      const created = await fetch(`${handle.url}/workspace/native-project/sessions`, {
        method: "POST", headers: { authorization: `Bearer ${handle.config.token}`, "content-type": "application/json" },
        body: JSON.stringify({ engineId: "opencode" }),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ item: { id: "managed-conversation", engineId: "opencode", directory: projectRoot } });
      expect(directories).toEqual([projectRoot]);
      expect(local?.engineId).toBe("codex-harness");
    } finally {
      await handle?.stop();
      spawn.mockRestore();
      engine.stop(true);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe("forwardedProxyEnv", () => {
  test("forwards only non-empty proxy settings", () => {
    expect(forwardedProxyEnv({
      HTTPS_PROXY: "  http://127.0.0.1:7890  ",
      NO_PROXY: "localhost,127.0.0.1",
      HTTP_PROXY: " ",
      IPOLLOWORK_SERVER_TOKEN: "must-not-be-forwarded",
    })).toEqual({
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1",
    });
  });

  test("keeps lowercase variants and Node proxy opt-in", () => {
    expect(forwardedProxyEnv({
      https_proxy: "http://127.0.0.1:7890",
      no_proxy: "localhost",
      NODE_USE_ENV_PROXY: "1",
    })).toEqual({
      https_proxy: "http://127.0.0.1:7890",
      no_proxy: "localhost",
      NODE_USE_ENV_PROXY: "1",
    });
  });
});

describe("offlineFirstOpencodeEnv", () => {
  test("disables startup network fetches by default", () => {
    expect(offlineFirstOpencodeEnv({})).toEqual({
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    });
  });

  test("uses the local development catalog and preserves explicit overrides", () => {
    expect(offlineFirstOpencodeEnv({ IPOLLOWORK_DEV_MODE: "1" })).toEqual({
      OPENCODE_MODELS_URL: "http://localhost:8791/models",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    });
    expect(offlineFirstOpencodeEnv({
      OPENCODE_MODELS_URL: "https://models.example.test/catalog.json",
      OPENCODE_DISABLE_AUTOUPDATE: "0",
      OPENCODE_DISABLE_MODELS_FETCH: "0",
    })).toEqual({
      OPENCODE_MODELS_URL: "https://models.example.test/catalog.json",
      OPENCODE_DISABLE_AUTOUPDATE: "0",
      OPENCODE_DISABLE_MODELS_FETCH: "0",
    });
  });
});
