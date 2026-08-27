import { describe, expect, test } from "bun:test";

import type { WorkspaceInfo } from "../src/app/lib/desktop-types";
import {
  isDefaultSessionTitle,
  sessionTitleFromFirstPrompt,
} from "../src/app/lib/session-title";
import {
  buildTaskPaletteSessionOptions,
  describeSidecarLaunchBlockedError,
  describeWorkspaceUnavailableTitle,
  mapDesktopWorkspace,
  mergeRouteWorkspaces,
  orderRouteWorkspaces,
  partitionInitialWorkspaceLoads,
  reconcilePendingCreatedSessions,
  toProjectSessionLists,
  resolveKnownWorkspaceId,
  userVisibleSessionsByWorkspaceId,
} from "../src/react-app/shell/route-workspaces";
import type { RouteSession } from "../src/react-app/shell/route-workspaces";

function routeSession(id: string, values: Partial<RouteSession> = {}): RouteSession {
  return { id, ...values } as RouteSession;
}

function localWorkspace(id: string, path: string): WorkspaceInfo {
  return {
    id,
    name: id,
    path,
    preset: "starter",
    workspaceType: "local",
  };
}

function remoteWorkspace(id: string): WorkspaceInfo {
  return {
    id,
    name: id,
    path: "",
    preset: "starter",
    workspaceType: "remote",
    remoteType: "ipollowork",
    baseUrl: "https://worker.example.com",
  };
}

describe("route workspaces", () => {
  test("attributes launch failures to the selected workspace engine", () => {
    expect(describeWorkspaceUnavailableTitle({
      message: "spawn EPERM",
      engineId: "codex-harness",
    })).toBe("Codex Harness launch blocked");
    expect(describeWorkspaceUnavailableTitle({
      message: "spawn EPERM",
      engineId: "deepseek-harness",
    })).toBe("DeepSeek Harness launch blocked");
    expect(describeWorkspaceUnavailableTitle({
      message: "spawn EPERM",
      engineId: "opencode",
    })).toBe("OpenCode launch blocked");
    expect(describeSidecarLaunchBlockedError("codex-harness")).toContain("Codex Harness runtime");
    expect(describeSidecarLaunchBlockedError("codex-harness")).not.toContain("opencode.exe");
  });

  test("derives a stable sidebar title from the first user request", () => {
    expect(sessionTitleFromFirstPrompt("  给我做一个阿里巴巴相关的 PPT\n和 10 秒视频  ")).toBe(
      "给我做一个阿里巴巴相关的 PPT 和 10 秒视频",
    );
    expect(sessionTitleFromFirstPrompt("一".repeat(60))).toBe(`${"一".repeat(47)}…`);
    expect(isDefaultSessionTitle("New conversation")).toBe(true);
    expect(isDefaultSessionTitle("新建会话")).toBe(true);
    expect(isDefaultSessionTitle("阿里巴巴 PPT 和视频")).toBe(false);
  });

  test("uses the running server registry instead of stale local desktop records", () => {
    const server = [localWorkspace("ws_live", "/Users/example/current")];
    const desktop = [
      mapDesktopWorkspace(localWorkspace("ws_stale", "/Users/example/legacy")),
      mapDesktopWorkspace(remoteWorkspace("ws_remote")),
    ];

    expect(mergeRouteWorkspaces(server, desktop).map((workspace) => workspace.id)).toEqual([
      "ws_live",
      "ws_remote",
    ]);
  });

  test("keeps desktop local workspaces before a local server registry exists", () => {
    const desktop = [mapDesktopWorkspace(localWorkspace("ws_local", "/Users/example/local"))];

    expect(mergeRouteWorkspaces([], desktop).map((workspace) => workspace.id)).toEqual(["ws_local"]);
  });

  test("preserves the desktop default-workspace marker when merging a server project", () => {
    const server = [localWorkspace("ws_default", "/Users/example/iPolloWork")];
    const desktop = [mapDesktopWorkspace({
      ...localWorkspace("ws_default", "/Users/example/iPolloWork"),
      isDefault: true,
    })];

    expect(mergeRouteWorkspaces(server, desktop)[0]?.isDefault).toBe(true);
  });

  test("keeps existing project positions stable and appends newly discovered projects", () => {
    const workspaces = [
      mapDesktopWorkspace(localWorkspace("selected", "/workspace/selected")),
      mapDesktopWorkspace(localWorkspace("new", "/workspace/new")),
      mapDesktopWorkspace(localWorkspace("older", "/workspace/older")),
    ];

    expect(orderRouteWorkspaces(workspaces, ["older", "selected"]).map((workspace) => workspace.id)).toEqual([
      "older",
      "selected",
      "new",
    ]);
  });

  test("falls through from a stale remembered workspace to a current server workspace", () => {
    const workspaces = [mapDesktopWorkspace(localWorkspace("ws_live", "/Users/example/current"))];

    expect(resolveKnownWorkspaceId(workspaces, ["ws_stale", "ws_live"])).toBe("ws_live");
  });

  test("selects the current workspace task directory and defers every other missing workspace", () => {
    const workspaces = [
      mapDesktopWorkspace(localWorkspace("selected", "/workspace/selected")),
      mapDesktopWorkspace(localWorkspace("cached", "/workspace/cached")),
      mapDesktopWorkspace(localWorkspace("missing", "/workspace/missing")),
    ];

    const result = partitionInitialWorkspaceLoads(
      workspaces,
      "selected",
      new Set(["cached"]),
    );

    expect(result.selected.map((workspace) => workspace.id)).toEqual(["selected"]);
    expect(result.deferred.map((workspace) => workspace.id)).toEqual(["missing"]);
  });

  test("filters delegated child sessions while retaining user-visible sessions", () => {
    const sessions = {
      ws: [
        routeSession("delegated-executor", { parentID: "parent", agent: "executor" }),
        routeSession("delegated-general", { parentID: "parent", agent: "general" }),
        routeSession("root-agent", { agent: "executor" }),
        routeSession("user-branch", { parentID: "parent", agent: "orchestrator" }),
        routeSession("legacy-branch", { parentID: "parent" }),
      ],
    };

    expect(userVisibleSessionsByWorkspaceId(sessions).ws.map((session) => session.id)).toEqual([
      "root-agent",
      "user-branch",
      "legacy-branch",
    ]);
  });

  test("filters blank default sessions from user-visible history", () => {
    const sessions = {
      ws: [
        routeSession("blank-generated", {
          title: "New session - 2026-08-06T04:00:00.000Z",
          time: { created: 1000, updated: 1000 },
        }),
        routeSession("blank-localized", {
          title: "新建会话",
          time: { created: 2000, updated: 2000 },
        }),
        routeSession("blank-legacy-english", {
          title: "New conversation",
          time: { created: 2500, updated: 2500 },
        }),
        routeSession("blank-legacy-chinese", {
          title: "新会话",
          time: { created: 2750, updated: 2750 },
        }),
        routeSession("active-default", {
          title: "New session - 2026-08-06T04:00:00.000Z",
          time: { created: 3000, updated: 3500 },
        }),
        routeSession("named-empty", {
          title: "Real work",
          time: { created: 4000, updated: 4000 },
        }),
        routeSession("named-active", {
          title: "Real work",
          time: { created: 5000, updated: 5500 },
        }),
      ],
    };

    expect(userVisibleSessionsByWorkspaceId(sessions).ws.map((session) => session.id)).toEqual([
      "active-default",
      "named-active",
    ]);
  });

  test("keeps a locally started new session visible until the runtime index catches up", () => {
    const fetched = [routeSession("started-locally", {
      title: "New session - 2026-08-26T00:00:00.000Z",
      time: { created: 1000, updated: 1000 },
    })];
    const optimistic = [routeSession("started-locally", {
      title: "DSH 首条消息会话保留验证",
      time: { created: 1000, updated: 1001 },
    })];

    const waiting = reconcilePendingCreatedSessions(
      fetched,
      optimistic,
      { "started-locally": 2000 },
      3000,
    );
    expect(waiting.sessions).toEqual(optimistic);
    expect(waiting.pending).toEqual({ "started-locally": 2000 });
    expect(userVisibleSessionsByWorkspaceId({ ws: waiting.sessions }).ws).toEqual(optimistic);

    const indexed = reconcilePendingCreatedSessions(
      [routeSession("started-locally", {
        title: "DSH 首条消息会话保留验证",
        time: { created: 1000, updated: 1100 },
      })],
      optimistic,
      waiting.pending,
      4000,
    );
    expect(indexed.pending).toEqual({});
  });

  test("requires an exact orchestrator agent to retain delegated children", () => {
    const sessions = {
      ws: [
        routeSession("whitespace-agent", { parentID: "parent", agent: "   " }),
        routeSession("wrapped-orchestrator", { parentID: "parent", agent: " orchestrator " }),
        routeSession("exact-orchestrator", { parentID: "parent", agent: "orchestrator" }),
      ],
    };

    expect(userVisibleSessionsByWorkspaceId(sessions).ws.map((session) => session.id)).toEqual([
      "whitespace-agent",
      "exact-orchestrator",
    ]);
  });

  test("provides one visible collection for sidebar, switcher, and search", () => {
    const raw = {
      ws: [
        routeSession("hidden", { parentID: "parent", agent: "executor" }),
        routeSession("visible", { parentID: "parent", agent: "orchestrator" }),
      ],
    };
    const workspace = mapDesktopWorkspace(localWorkspace("ws", "/Users/example/current"));
    const visible = userVisibleSessionsByWorkspaceId(raw);
    const projects = toProjectSessionLists([workspace], visible, {}, new Set());

    expect(projects[0]?.sessions).toBe(visible.ws);
    expect(visible.ws.map((session) => session.id)).toEqual(["visible"]);
  });

  test("excludes delegated children from the session-switcher and search inputs", () => {
    const workspace = mapDesktopWorkspace(localWorkspace("ws", "/Users/example/current"));
    const sessions = {
      ws: [
        routeSession("hidden", { parentID: "parent", agent: "executor", title: "Internal child" }),
        routeSession("visible", { parentID: "parent", agent: "orchestrator", title: "User task" }),
      ],
    };
    const options = buildTaskPaletteSessionOptions(
      [workspace],
      sessions,
      "ws",
    );

    expect(options.map((option) => option.sessionId)).toEqual(["visible"]);
    expect(options[0]?.searchText).toContain("user task");
  });
});
