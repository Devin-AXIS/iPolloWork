import { describe, expect, test } from "bun:test";

import type { WorkspaceInfo } from "../src/app/lib/desktop-types";
import {
  mapDesktopWorkspace,
  mergeRouteWorkspaces,
  resolveKnownWorkspaceId,
} from "../src/react-app/shell/route-workspaces";

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

  test("falls through from a stale remembered workspace to a current server workspace", () => {
    const workspaces = [mapDesktopWorkspace(localWorkspace("ws_live", "/Users/example/current"))];

    expect(resolveKnownWorkspaceId(workspaces, ["ws_stale", "ws_live"])).toBe("ws_live");
  });
});
