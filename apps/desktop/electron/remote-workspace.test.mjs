import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ipollowalkWorkspaceDisplayName,
  selectiPolloWalkWorkspaceForConnection,
} from "./remote-workspace.mjs";

describe("selectiPolloWalkWorkspaceForConnection", () => {
  it("selects the active worker workspace when no directory is provided", () => {
    const selected = selectiPolloWalkWorkspaceForConnection(
      {
        activeId: "ws_active",
        items: [
          { id: "ws_first", path: "/workspace/first" },
          { id: "ws_active", path: "/workspace/active" },
        ],
      },
      null,
    );

    assert.equal(selected?.id, "ws_active");
  });

  it("falls back to the first workspace when activeId is missing", () => {
    const selected = selectiPolloWalkWorkspaceForConnection(
      {
        items: [
          { id: "ws_first", path: "/workspace/first" },
          { id: "ws_second", path: "/workspace/second" },
        ],
      },
      "",
    );

    assert.equal(selected?.id, "ws_first");
  });

  it("selects a workspace whose path matches the requested remote directory", () => {
    const selected = selectiPolloWalkWorkspaceForConnection(
      {
        activeId: "ws_other",
        items: [
          { id: "ws_other", path: "/workspace/other" },
          { id: "ws_demo", path: "/home/user/workspaces/demo" },
        ],
      },
      "/home/user/workspaces/demo/",
    );

    assert.equal(selected?.id, "ws_demo");
  });

  it("selects by opencode directory when workers expose it there", () => {
    const selected = selectiPolloWalkWorkspaceForConnection(
      {
        items: [
          {
            id: "ws_demo",
            path: "/workspace",
            opencode: { directory: "/home/user/workspaces/demo" },
          },
        ],
      },
      "/home/user/workspaces/demo",
    );

    assert.equal(selected?.id, "ws_demo");
  });

  it("returns null when a requested directory is not present", () => {
    const selected = selectiPolloWalkWorkspaceForConnection(
      { items: [{ id: "ws_demo", path: "/workspace/demo" }] },
      "/workspace/missing",
    );

    assert.equal(selected, null);
  });

  it("reads legacy workspaces arrays", () => {
    const selected = selectiPolloWalkWorkspaceForConnection(
      { activeId: "ws_legacy", workspaces: [{ id: "ws_legacy", path: "/workspace" }] },
      null,
    );

    assert.equal(selected?.id, "ws_legacy");
  });
});

describe("ipollowalkWorkspaceDisplayName", () => {
  it("prefers display fields before id", () => {
    assert.equal(
      ipollowalkWorkspaceDisplayName({
        id: "ws_demo",
        name: "Worker project",
        displayName: "Demo",
      }),
      "Demo",
    );
  });
});
