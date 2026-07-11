/**
 * Side-effect proof for the ipollowalk.json -> runtime.sqlite migration.
 *
 * The user-facing experience (open app, create workspace, read config) must be
 * unchanged; these server-level checks only witness the expected side effects:
 *   - workspace creation writes the ipollowalk config to the runtime DB, NOT to
 *     `.opencode/ipollowalk.json`.
 *   - GET /config still returns the same ipollowalk payload shape (version,
 *     workspace, authorizedRoots).
 *   - a legacy on-disk `.opencode/ipollowalk.json` (pre-migration install) is
 *     migrated into the DB on read and remains effective (back-compat).
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readiPolloWalkWorkspaceConfig } from "./ipollowalk-workspace-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  } satisfies ServerConfig;
}

async function withSandbox(fn: (input: { root: string; config: ServerConfig }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "ipollowalk-config-migration-"));
  const previousDb = process.env.IPOLLOWALK_RUNTIME_DB;
  process.env.IPOLLOWALK_RUNTIME_DB = join(root, "runtime.sqlite");
  try {
    await fn({ root, config: serverConfig(root) });
  } finally {
    if (previousDb === undefined) delete process.env.IPOLLOWALK_RUNTIME_DB;
    else process.env.IPOLLOWALK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("ipollowalk config DB migration", () => {
  test("creating a workspace seeds the runtime DB and writes no ipollowalk.json", async () => {
    await withSandbox(async ({ root, config }) => {
      const server = (await startServer(config)) as Served;
      try {
        const workspacePath = join(root, "ws-create");
        const create = await fetch(`http://127.0.0.1:${server.port}/workspaces/local`, {
          method: "POST",
          headers: { "x-ipollowalk-host-token": config.hostToken, "content-type": "application/json" },
          body: JSON.stringify({ folderPath: workspacePath, name: "ws-create", preset: "starter" }),
        });
        expect(create.status).toBe(201);

        const created = (await create.json()) as { workspaces: Array<{ id: string; path: string }> };
        const workspace = created.workspaces.find((w) => resolve(w.path) === resolve(workspacePath));
        expect(workspace).toBeTruthy();
        const workspaceId = workspace!.id;

        // Side effect 1: NO legacy file on disk.
        expect(await fileExists(join(workspacePath, ".opencode", "ipollowalk.json"))).toBe(false);

        // Side effect 2: the config landed in the runtime DB with the expected
        // metadata (authorizedRoots is security-relevant; must survive).
        const stored = await readiPolloWalkWorkspaceConfig(config, workspaceId);
        expect(stored.version).toBe(1);
        expect(stored.authorizedRoots).toEqual([resolve(workspacePath)]);
        expect((stored.workspace as { preset?: string } | undefined)?.preset).toBe("starter");

        // Side effect 3: the user-facing GET /config payload is intact.
        const configRes = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspaceId}/config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(configRes.status).toBe(200);
        const body = (await configRes.json()) as { ipollowalk: Record<string, unknown> };
        expect(body.ipollowalk.version).toBe(1);
        expect(body.ipollowalk.authorizedRoots).toEqual([resolve(workspacePath)]);
      } finally {
        await server.stop(true);
      }
    });
  });

  test("back-compat: a legacy ipollowalk.json is migrated into the DB on read", async () => {
    await withSandbox(async ({ root, config }) => {
      const workspacePath = join(root, "ws-legacy");
      const workspaceId = "ws_legacy_fixture";
      await mkdir(join(workspacePath, ".opencode"), { recursive: true });
      // Pre-migration install: a real file, empty DB.
      await writeFile(
        join(workspacePath, ".opencode", "ipollowalk.json"),
        JSON.stringify({
          version: 1,
          workspace: { name: "Legacy", preset: "starter" },
          authorizedRoots: [workspacePath],
          blueprint: { emptyState: { title: "Legacy starter" } },
        }, null, 2) + "\n",
        "utf8",
      );

      const legacyConfig: ServerConfig = {
        ...config,
        workspaces: [
          { id: workspaceId, name: "Legacy", path: workspacePath, preset: "starter", workspaceType: "local" },
        ],
        authorizedRoots: [workspacePath],
      };

      const server = (await startServer(legacyConfig)) as Served;
      try {
        // Before read: DB has no row.
        expect(Object.keys(await readiPolloWalkWorkspaceConfig(legacyConfig, workspaceId)).length).toBe(0);

        // User reads config -> migrate-on-read copies file contents into the DB.
        const configRes = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspaceId}/config`, {
          headers: { authorization: `Bearer ${legacyConfig.token}` },
        });
        expect(configRes.status).toBe(200);
        const body = (await configRes.json()) as { ipollowalk: Record<string, unknown> };
        // The legacy marker is honored (user-visible config unchanged).
        expect((body.ipollowalk.workspace as { name?: string } | undefined)?.name).toBe("Legacy");
        expect((body.ipollowalk.blueprint as { emptyState?: { title?: string } } | undefined)?.emptyState?.title)
          .toBe("Legacy starter");

        // Side effect: the legacy contents now live in the DB.
        const stored = await readiPolloWalkWorkspaceConfig(legacyConfig, workspaceId);
        expect((stored.workspace as { name?: string } | undefined)?.name).toBe("Legacy");
        expect(stored.authorizedRoots).toEqual([workspacePath]);
      } finally {
        await server.stop(true);
      }
    });
  });

  test("existing local workspace without legacy file gets default DB config on read", async () => {
    await withSandbox(async ({ root, config }) => {
      const workspacePath = join(root, "ws-existing-no-file");
      const workspaceId = "ws_existing_no_file";
      await mkdir(workspacePath, { recursive: true });

      const existingConfig: ServerConfig = {
        ...config,
        workspaces: [
          { id: workspaceId, name: "Existing", path: workspacePath, preset: "starter", workspaceType: "local" },
        ],
        authorizedRoots: [workspacePath],
      };

      const server = (await startServer(existingConfig)) as Served;
      try {
        expect(await fileExists(join(workspacePath, ".opencode", "ipollowalk.json"))).toBe(false);
        expect(Object.keys(await readiPolloWalkWorkspaceConfig(existingConfig, workspaceId)).length).toBe(0);

        const configRes = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspaceId}/config`, {
          headers: { authorization: `Bearer ${existingConfig.token}` },
        });
        expect(configRes.status).toBe(200);
        const body = (await configRes.json()) as { ipollowalk: Record<string, unknown> };
        expect(body.ipollowalk.version).toBe(1);
        expect(body.ipollowalk.authorizedRoots).toEqual([workspacePath]);
        expect((body.ipollowalk.workspace as { preset?: string } | undefined)?.preset).toBe("starter");

        const stored = await readiPolloWalkWorkspaceConfig(existingConfig, workspaceId);
        expect(stored.authorizedRoots).toEqual([workspacePath]);
      } finally {
        await server.stop(true);
      }
    });
  });
});
