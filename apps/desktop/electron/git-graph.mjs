// Git graph DAG builder: commit DAG + ref mapping for the swimlane panel.
// Extracted from main.mjs into a factory so it can be unit-tested in
// isolation against real or fake git executables.
import { spawnSync } from "node:child_process";

const GIT_GRAPH_TIMEOUT_MS = 30_000;

export function createGitGraph({ spawnSync: spawnSyncImpl = spawnSync } = {}) {
  function runGitInWorkspace(cwd, args) {
    const result = spawnSyncImpl("git", args, {
      cwd,
      encoding: "utf8",
      timeout: GIT_GRAPH_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "" },
    });
    if (result.error) {
      if (result.error.code === "ENOENT") throw new Error("git executable not found");
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`git ${args[0]} failed: ${String(result.stderr ?? "").trim().slice(0, 400)}`);
    }
    return String(result.stdout ?? "");
  }

  // Build a lightweight commit DAG for the workspace repo: commit hashes with
  // their parents plus branch/tag refs. Uses `rev-list --parents` for exact
  // edges and `for-each-ref` for ref → commit mapping. Bounded by an optional
  // maxCommits to keep huge repos renderable.
  function buildGitGraph(cwd, maxCommits = 2000) {
    const revListOutput = runGitInWorkspace(cwd, [
      "rev-list", "--parents", "--all", "--max-count", String(maxCommits),
    ]);
    const commits = [];
    for (const line of revListOutput.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const sha = parts[0];
      const parents = parts.slice(1);
      commits.push({ sha, parents });
    }

    const refsOutput = runGitInWorkspace(cwd, [
      "for-each-ref", "refs/heads", "refs/remotes",
      "--format=%(objectname)%00%(refname)%00%(HEAD)", "--merged", "HEAD",
    ]);
    const refs = [];
    for (const line of refsOutput.split("\n")) {
      if (!line.trim()) continue;
      const [sha, refname, headFlag] = line.trim().split("\0");
      if (!sha || !refname) continue;
      const head = headFlag === "*";
      refs.push({ sha, refname, head });
    }

    const count = commits.length;
    const headShas = new Set(refs.filter((ref) => ref.head).map((ref) => ref.sha));

    // Detect truncation: rev-list --max-count cannot tell us whether more
    // commits exist, so ask for the total once.
    let truncated = false;
    let totalCount = null;
    if (commits.length > 0) {
      try {
        const countOutput = runGitInWorkspace(cwd, ["rev-list", "--all", "--count"]);
        const parsed = Number.parseInt(String(countOutput).trim(), 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          totalCount = parsed;
          truncated = parsed > commits.length;
        }
      } catch {
        // Total-count probe failed; leave truncated=false.
      }
    }

    return {
      ok: true,
      repoRoot: cwd,
      count,
      totalCount,
      truncated,
      commits,
      refs,
      headShas: [...headShas],
    };
  }

  return { runGitInWorkspace, buildGitGraph };
}
