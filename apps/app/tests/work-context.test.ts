import { describe, expect, test } from "bun:test";

import {
  enterpriseWorkContextId,
  filterWorkspacesForWorkContext,
  normalizeWorkContextId,
  PERSONAL_WORK_CONTEXT_ID,
  workContextIdsEqual,
} from "../src/app/lib/work-context";

describe("work context identity", () => {
  const workspaces = [
    { id: "personal-a", path: "/Users/test/iPolloWork", workspaceType: "local" as const, workContextId: null },
    { id: "personal-b", path: "/Users/test/ClientWork", workspaceType: "local" as const },
    { id: "enterprise-a", path: "/Users/test/MedicalOne", workspaceType: "local" as const, workContextId: "enterprise:ent_alpha" as const },
    { id: "enterprise-a-two", path: "/Users/test/MedicalTwo", workspaceType: "local" as const, workContextId: "enterprise:ent_alpha" as const },
    { id: "enterprise-b", path: "/Users/test/.ipollowork/work-contexts/ent_beta", workspaceType: "local" as const, workContextId: "enterprise:ent_beta" as const },
  ];

  test("keeps every Personal project", () => {
    expect(filterWorkspacesForWorkContext(workspaces, PERSONAL_WORK_CONTEXT_ID).map((item) => item.id)).toEqual([
      "personal-a",
      "personal-b",
    ]);
  });

  test("keeps every project in the exact Enterprise space", () => {
    expect(filterWorkspacesForWorkContext(workspaces, enterpriseWorkContextId("ent_alpha")).map((item) => item.id)).toEqual([
      "enterprise-a",
      "enterprise-a-two",
    ]);
  });

  test("rejects malformed or obsolete context values", () => {
    expect(normalizeWorkContextId("enterprise:ent_alpha")).toBe("enterprise:ent_alpha");
    expect(normalizeWorkContextId("team:old")).toBeNull();
    expect(normalizeWorkContextId("enterprise:alpha")).toBeNull();
  });

  test("treats the legacy enterprise container as a default workspace without hiding user projects", () => {
    const contextId = enterpriseWorkContextId("ent_beta");
    const projects = filterWorkspacesForWorkContext([
      ...workspaces,
      { id: "user-project", path: "/Users/test/Client", workspaceType: "local", workContextId: contextId },
      { id: "nested-project", path: "/Users/test/.ipollowork/work-contexts/ent_beta/client", workspaceType: "local", workContextId: contextId },
    ], contextId);
    expect(projects.find(project => project.id === "enterprise-b")?.isDefault).toBe(true);
    expect(projects.filter(project => !project.isDefault).map(project => project.id)).toEqual(["user-project", "nested-project"]);
  });

  test("recognizes a Windows legacy enterprise container with trailing separators", () => {
    const projects = filterWorkspacesForWorkContext([{ path: "C:\\Users\\test\\.ipollowork\\work-contexts\\ent_beta\\", workContextId: enterpriseWorkContextId("ent_beta") }], enterpriseWorkContextId("ent_beta"));
    expect(projects[0]?.isDefault).toBe(true);
  });

  test("treats null and missing context markers as the same Personal identity", () => {
    expect(workContextIdsEqual(null, undefined)).toBe(true);
    expect(workContextIdsEqual(undefined, PERSONAL_WORK_CONTEXT_ID)).toBe(true);
    expect(workContextIdsEqual(null, enterpriseWorkContextId("ent_alpha"))).toBe(false);
  });
});
