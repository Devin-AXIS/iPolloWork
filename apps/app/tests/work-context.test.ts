import { describe, expect, test } from "bun:test";

import {
  canonicalWorkspaceForWorkContext,
  enterpriseWorkContextId,
  filterWorkspacesForWorkContext,
  normalizeWorkContextId,
  PERSONAL_WORK_CONTEXT_ID,
  workContextIdsEqual,
} from "../src/app/lib/work-context";

describe("work context identity", () => {
  const workspaces = [
    { id: "personal-a", path: "/Users/test/iPolloWork", workspaceType: "local" as const, workContextId: null },
    { id: "legacy-personal", path: "/Users/test/iPolloWork/.ipollowork/workstations/old", workspaceType: "local" as const },
    { id: "enterprise-a", path: "/Users/test/.ipollowork/work-contexts/ent_alpha", workspaceType: "local" as const, workContextId: "enterprise:ent_alpha" as const },
    { id: "enterprise-a-old", path: "/Users/test/iPolloWork/.ipollowork/workstations/enterprise-old", workspaceType: "local" as const, workContextId: "enterprise:ent_alpha" as const },
    { id: "enterprise-b", path: "/Users/test/.ipollowork/work-contexts/ent_beta", workspaceType: "local" as const, workContextId: "enterprise:ent_beta" as const },
  ];

  test("treats unmarked legacy workspaces as Personal", () => {
    expect(filterWorkspacesForWorkContext(workspaces, PERSONAL_WORK_CONTEXT_ID).map((item) => item.id)).toEqual([
      "personal-a",
      "legacy-personal",
    ]);
  });

  test("returns only the exact enterprise workspace", () => {
    expect(filterWorkspacesForWorkContext(workspaces, enterpriseWorkContextId("ent_alpha")).map((item) => item.id)).toEqual([
      "enterprise-a",
      "enterprise-a-old",
    ]);
  });

  test("keeps one canonical Personal space instead of a historical workstation", () => {
    expect(canonicalWorkspaceForWorkContext(
      workspaces,
      PERSONAL_WORK_CONTEXT_ID,
      ["legacy-personal"],
    )?.id).toBe("personal-a");
  });

  test("keeps the dedicated Enterprise context path instead of an older workstation", () => {
    expect(canonicalWorkspaceForWorkContext(
      workspaces,
      enterpriseWorkContextId("ent_alpha"),
      ["enterprise-a-old"],
    )?.id).toBe("enterprise-a");
  });

  test("rejects malformed or obsolete context values", () => {
    expect(normalizeWorkContextId("enterprise:ent_alpha")).toBe("enterprise:ent_alpha");
    expect(normalizeWorkContextId("team:old")).toBeNull();
    expect(normalizeWorkContextId("enterprise:alpha")).toBeNull();
  });

  test("treats null and missing context markers as the same Personal identity", () => {
    expect(workContextIdsEqual(null, undefined)).toBe(true);
    expect(workContextIdsEqual(undefined, PERSONAL_WORK_CONTEXT_ID)).toBe(true);
    expect(workContextIdsEqual(null, enterpriseWorkContextId("ent_alpha"))).toBe(false);
  });
});
