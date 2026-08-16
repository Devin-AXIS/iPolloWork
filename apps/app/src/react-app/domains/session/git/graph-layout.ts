/**
 * Pure git-graph swimlane layout.
 *
 * Input is the commit DAG produced by the Electron main process
 * (`git rev-list --parents --all`) plus ref → commit mapping. This module is
 * deliberately framework-free so the layout algorithm can be unit-tested
 * without React/DOM.
 */

export type GraphCommit = {
  sha: string;
  parents: string[];
};

export type GraphRef = {
  sha: string;
  refname: string;
  head: boolean;
};

export type LayoutCommit = GraphCommit & {
  row: number;
  lane: number;
  refs: GraphRef[];
};

export type GraphLayout = {
  rows: LayoutCommit[];
  laneCount: number;
};

/**
 * Greedy lane assignment based on parent inheritance:
 *   - a commit inherits its FIRST parent's lane (linear history stays in one
 *     column);
 *   - the second+ parent of a merge opens a new lane;
 *   - a lane whose owner has already been placed can be reused for a fresh
 *     branch.
 *
 * Invariants:
 * - every row index equals its position in the input order (0..n-1);
 * - every lane index is a non-negative integer in [0, laneCount);
 * - a commit's lane never changes once assigned;
 * - every commit with at least one parent inherits that parent's lane unless
 *   the parent's lane is still owned by an unplaced commit and a second
 *   parent forces a fork.
 */
export function layoutGraph(commits: GraphCommit[], refs: GraphRef[] = []): GraphLayout {
  const refsBySha = new Map<string, GraphRef[]>();
  for (const ref of refs) {
    const list = refsBySha.get(ref.sha) ?? [];
    list.push(ref);
    refsBySha.set(ref.sha, list);
  }

  const laneOf = new Map<string, number>();
  const laneOwner: (string | undefined)[] = [];
  const placed = new Set<string>();
  let laneCount = 0;

  const freeLaneOrNew = () => {
    for (let i = 0; i < laneCount; i++) {
      const owner = laneOwner[i];
      if (owner === undefined || placed.has(owner)) return i;
    }
    const lane = laneCount++;
    laneOwner.push(undefined);
    return lane;
  };

  const claimLane = (sha: string) => {
    const existing = laneOf.get(sha);
    if (existing !== undefined) return existing;
    const lane = freeLaneOrNew();
    laneOf.set(sha, lane);
    laneOwner[lane] = sha;
    return lane;
  };

  // A fresh lane that never reuses a sibling's lane; used only when a commit
  // forks away from a parent whose lane is already occupied by a sibling.
  const claimFreshLane = () => {
    const lane = laneCount++;
    laneOwner.push(undefined);
    return lane;
  };

  const rows: LayoutCommit[] = [];
  commits.forEach((commit, row) => {
    const firstParent = commit.parents[0];
    let lane: number;
    const alreadyAssigned = laneOf.get(commit.sha);
    if (alreadyAssigned !== undefined) {
      // The commit was reserved as a parent earlier; keep its lane.
      lane = alreadyAssigned;
    } else if (
      firstParent !== undefined
      && laneOf.has(firstParent)
      && laneOwner[laneOf.get(firstParent)!] === firstParent
    ) {
      // Inherit the first parent's lane (linear continuation) — but only if
      // the parent still occupies that lane. A sibling branch that already
      // inherited it forces this branch into its own fresh lane.
      lane = laneOf.get(firstParent)!;
    } else if (firstParent !== undefined && laneOf.has(firstParent)) {
      // Parent's lane is held by a sibling branch; fork to a fresh lane so
      // the two branches remain visually distinct.
      lane = claimFreshLane();
    } else {
      lane = freeLaneOrNew();
    }
    placed.add(commit.sha);
    laneOf.set(commit.sha, lane);
    laneOwner[lane] = commit.sha;
    rows.push({
      ...commit,
      row,
      lane,
      refs: refsBySha.get(commit.sha) ?? [],
    });
    // Reserve lanes for parents not yet assigned. The first parent shares
    // this lane (unless it already has one); second+ parents fork to new
    // lanes so merges become visible.
    commit.parents.forEach((parent, index) => {
      if (laneOf.has(parent)) return;
      if (index === 0) {
        laneOf.set(parent, lane);
        laneOwner[lane] = parent;
      } else {
        claimLane(parent);
      }
    });
  });

  return { rows, laneCount };
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function shortRef(refname: string): string {
  return refname.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");
}
