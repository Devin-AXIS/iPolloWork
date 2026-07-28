import { describe, expect, test } from "bun:test";

import {
  enterpriseWorkContextId,
  filterWorkspacesForWorkContext,
  normalizeWorkContextId,
  PERSONAL_WORK_CONTEXT_ID,
} from "../src/app/lib/work-context";

describe("work context identity", () => {
  const workspaces = [
    { id: "personal-a", workContextId: null },
    { id: "legacy-personal" },
    { id: "enterprise-a", workContextId: "enterprise:ent_alpha" as const },
    { id: "enterprise-b", workContextId: "enterprise:ent_beta" as const },
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
    ]);
  });

  test("rejects malformed or obsolete context values", () => {
    expect(normalizeWorkContextId("enterprise:ent_alpha")).toBe("enterprise:ent_alpha");
    expect(normalizeWorkContextId("team:old")).toBeNull();
    expect(normalizeWorkContextId("enterprise:alpha")).toBeNull();
  });
});
