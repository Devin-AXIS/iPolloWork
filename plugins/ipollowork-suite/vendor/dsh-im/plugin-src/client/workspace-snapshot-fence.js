import * as React from 'react';

/** Keep every full-snapshot response ordered behind the latest client mutation. */
export function useWorkspaceSnapshotFence() {
  const state = React.useRef({ version: 0, pendingMutations: 0 });
  return React.useMemo(() => Object.freeze({
    beginStatus() {
      return state.current.pendingMutations === 0 ? state.current.version : null;
    },
    canCommitStatus(version) {
      return version !== null
        && state.current.pendingMutations === 0
        && state.current.version === version;
    },
    beginMutation() {
      state.current.pendingMutations += 1;
      state.current.version += 1;
      return state.current.version;
    },
    canCommitMutation(version) {
      return state.current.version === version;
    },
    endMutation() {
      state.current.pendingMutations = Math.max(0, state.current.pendingMutations - 1);
      return state.current.pendingMutations === 0;
    },
  }), []);
}
