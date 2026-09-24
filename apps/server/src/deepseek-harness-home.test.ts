import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import { deepSeekHarnessHome, resolveLegacyDeepSeekHarnessWorkspaceId } from "./deepseek-harness-runtime.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

function workspace(id: string): WorkspaceInfo {
  return {
    id,
    name: id,
    path: join(tmpdir(), id),
    engineId: DEEPSEEK_HARNESS_ENGINE_ID,
  } as WorkspaceInfo;
}

function config(root: string, workspaces: WorkspaceInfo[]): ServerConfig {
  return { configPath: join(root, "server.json"), workspaces } as ServerConfig;
}

test("pins the legacy DSH home when a newly created project changes workspace order", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-dsh-home-"));
  try {
    const oldWorkspace = workspace("ws_old");
    const newWorkspace = workspace("ws_new");
    const initial = config(root, [oldWorkspace]);
    expect(resolveLegacyDeepSeekHarnessWorkspaceId(initial, oldWorkspace)).toBe("ws_old");

    const reordered = config(root, [newWorkspace, oldWorkspace]);
    const owner = resolveLegacyDeepSeekHarnessWorkspaceId(reordered, newWorkspace);
    expect(owner).toBe("ws_old");
    expect(deepSeekHarnessHome(reordered, oldWorkspace, undefined, owner))
      .toBe(join(root, "deepseek-harness"));
    expect(deepSeekHarnessHome(reordered, newWorkspace, undefined, owner))
      .toBe(join(root, "deepseek-harness-workspaces", "ws_new"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers legacy ownership from existing dedicated homes on upgrade", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-dsh-home-upgrade-"));
  try {
    const oldWorkspace = workspace("ws_old");
    const newWorkspace = workspace("ws_new");
    await mkdir(join(root, "deepseek-harness-workspaces", "ws_new"), { recursive: true });
    const reordered = config(root, [newWorkspace, oldWorkspace]);
    expect(resolveLegacyDeepSeekHarnessWorkspaceId(reordered, newWorkspace)).toBe("ws_old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
