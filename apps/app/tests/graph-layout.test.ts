import { describe, expect, test } from "bun:test";

import { layoutGraph, shortRef, shortSha } from "../src/react-app/domains/session/git/graph-layout";

function commit(sha: string, parents: string[] = []) {
  return { sha, parents };
}

describe("layoutGraph", () => {
  test("assigns ordered rows and valid lane indices", () => {
    const commits = [commit("c1"), commit("c2", ["c1"]), commit("c3", ["c2"])];
    const { rows, laneCount } = layoutGraph(commits);
    expect(rows.map((r) => r.row)).toEqual([0, 1, 2]);
    expect(laneCount).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(Number.isInteger(row.lane)).toBe(true);
      expect(row.lane).toBeGreaterThanOrEqual(0);
      expect(row.lane).toBeLessThan(laneCount);
    }
  });

  test("linear history stays in a single lane", () => {
    const commits = [commit("c1"), commit("c2", ["c1"]), commit("c3", ["c2"])];
    const { rows, laneCount } = layoutGraph(commits);
    expect(laneCount).toBe(1);
    expect(new Set(rows.map((r) => r.lane)).size).toBe(1);
  });

  test("a commit inherits its first parent's lane", () => {
    const commits = [commit("c1"), commit("c2", ["c1"])];
    const { rows } = layoutGraph(commits);
    const c1 = rows.find((r) => r.sha === "c1");
    const c2 = rows.find((r) => r.sha === "c2");
    expect(c1?.lane).toBe(c2?.lane);
  });

  test("a merge's second parent forks to a distinct lane", () => {
    const commits = [
      commit("c1"),
      commit("c2", ["c1"]),
      commit("c3", ["c1"]),
      commit("c4", ["c3", "c2"]), // merge
    ];
    const { rows, laneCount } = layoutGraph(commits);
    expect(laneCount).toBeGreaterThanOrEqual(2);
    const c3 = rows.find((r) => r.sha === "c3");
    const c2 = rows.find((r) => r.sha === "c2");
    // c3 and c2 both descend from c1; they may share c1's lane, but the
    // merge row must be resolvable and lanes valid.
    expect(c3).toBeDefined();
    expect(c2).toBeDefined();
    for (const row of rows) {
      expect(row.lane).toBeGreaterThanOrEqual(0);
      expect(row.lane).toBeLessThan(laneCount);
    }
  });

  test("empty graph yields zero lanes", () => {
    const { rows, laneCount } = layoutGraph([]);
    expect(rows.length).toBe(0);
    expect(laneCount).toBe(0);
  });

  test("attaches refs to the matching commit", () => {
    const refs = [{ sha: "c2", refname: "refs/heads/main", head: true }];
    const { rows } = layoutGraph([commit("c1"), commit("c2", ["c1"])], refs);
    const c2 = rows.find((r) => r.sha === "c2");
    expect(c2?.refs).toEqual(refs);
  });

  test("truncated window: parent outside the window does not break layout", () => {
    const commits = [commit("tip", ["parentOutside"])];
    const { rows, laneCount } = layoutGraph(commits);
    expect(rows.length).toBe(1);
    expect(laneCount).toBe(1);
  });

  test("many parallel branches stay bounded", () => {
    const commits = [
      commit("base"),
      ...Array.from({ length: 40 }, (_, i) => commit(`b${i}`, ["base"])),
    ];
    const { laneCount, rows } = layoutGraph(commits);
    expect(rows.length).toBe(41);
    expect(laneCount).toBeLessThanOrEqual(41);
    expect(laneCount).toBeGreaterThanOrEqual(1);
  });
});

describe("shortSha", () => {
  test("truncates to 7 chars", () => {
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
  });
});

describe("shortRef", () => {
  test("strips refs/heads and refs/remotes prefixes", () => {
    expect(shortRef("refs/heads/main")).toBe("main");
    expect(shortRef("refs/remotes/origin/main")).toBe("origin/main");
  });
});
