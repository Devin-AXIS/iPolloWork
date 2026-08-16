import assert from "node:assert/strict";
import { test } from "node:test";

import { createGitGraph } from "./git-graph.mjs";

// A fake spawnSync that returns canned git output keyed by command.
function gitWithOutput({ revList, refs, count }) {
  const calls = [];
  const spawnSyncImpl = (_cmd, args) => {
    calls.push(args);
    const stdoutFor = () => {
      if (args[0] === "rev-list" && args.includes("--max-count")) return revList;
      if (args[0] === "rev-list" && args.includes("--count")) return count ?? "";
      if (args[0] === "for-each-ref") return refs ?? "";
      return "";
    };
    return { status: 0, stdout: stdoutFor(), stderr: "" };
  };
  return { graph: createGitGraph({ spawnSync: spawnSyncImpl }), calls };
}

test("buildGitGraph parses commit DAG with parents", () => {
  const { graph } = gitWithOutput({
    revList: "aaa111 parent1 parent2\nbbb222 parent3\nccc333\n",
    refs: "",
    count: "3",
  });
  const result = graph.buildGitGraph("/repo");
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.deepEqual(result.commits[0], { sha: "aaa111", parents: ["parent1", "parent2"] });
  assert.deepEqual(result.commits[2], { sha: "ccc333", parents: [] });
});

test("buildGitGraph maps refs and HEAD flag", () => {
  const { graph } = gitWithOutput({
    revList: "aaa111 parent1\n",
    refs: "aaa111\x00refs/heads/main\x00*\naaa111\x00refs/remotes/origin/main\x00 \n",
    count: "1",
  });
  const result = graph.buildGitGraph("/repo");
  assert.deepEqual(result.headShas, ["aaa111"]);
  assert.deepEqual(result.refs, [
    { sha: "aaa111", refname: "refs/heads/main", head: true },
    { sha: "aaa111", refname: "refs/remotes/origin/main", head: false },
  ]);
});

test("buildGitGraph reports truncation when total exceeds window", () => {
  const { graph } = gitWithOutput({
    revList: "aaa111\nbbb222\n",
    refs: "",
    count: "100",
  });
  const result = graph.buildGitGraph("/repo", 2);
  assert.equal(result.truncated, true);
  assert.equal(result.totalCount, 100);
  assert.equal(result.count, 2);
});

test("buildGitGraph is not truncated when total fits in window", () => {
  const { graph } = gitWithOutput({
    revList: "aaa111\nbbb222\n",
    refs: "",
    count: "2",
  });
  const result = graph.buildGitGraph("/repo", 2000);
  assert.equal(result.truncated, false);
  assert.equal(result.totalCount, 2);
});

test("buildGitGraph tolerates a failing total-count probe", () => {
  const spawnSyncImpl = (_cmd, args) => {
    if (args[0] === "rev-list" && args.includes("--count")) {
      return { status: 128, stdout: "", stderr: "fatal: permission" };
    }
    return { status: 0, stdout: "aaa111\n", stderr: "" };
  };
  const graph = createGitGraph({ spawnSync: spawnSyncImpl });
  const result = graph.buildGitGraph("/repo");
  assert.equal(result.ok, true);
  assert.equal(result.truncated, false);
  assert.equal(result.totalCount, null);
});

test("buildGitGraph propagates git failure", () => {
  const spawnSyncImpl = (_cmd, _args) => ({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
  const graph = createGitGraph({ spawnSync: spawnSyncImpl });
  assert.throws(() => graph.buildGitGraph("/not-a-repo"), /not a git repository/);
});
