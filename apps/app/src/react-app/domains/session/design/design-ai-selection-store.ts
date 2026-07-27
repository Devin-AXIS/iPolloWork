import { create } from "zustand";

import type { DesignAiSelectionContext, DesignAiUndoCheckpoint } from "./design-ai-selection";

type DesignAiSelectionStatus = "pending" | "running" | "completing" | "completed" | "failed";

type CompleteDesignAiSelection = {
  afterHtml: string;
  afterUpdatedAt: number | null;
};

type RebaseDesignAiSelection = {
  beforeHtml: string;
  baseUpdatedAt: number | null;
};

type DesignAiSelectionStore = {
  contexts: Record<string, DesignAiSelectionContext>;
  statuses: Record<string, DesignAiSelectionStatus>;
  undoCheckpoints: Record<string, Record<string, DesignAiUndoCheckpoint[]>>;
  createContext: (context: DesignAiSelectionContext) => void;
  rebasePendingContext: (contextId: string, baseline: RebaseDesignAiSelection) => boolean;
  markRunning: (contextId: string) => void;
  claimCompletion: (contextId: string) => boolean;
  complete: (contextId: string, result: CompleteDesignAiSelection) => void;
  completeWithoutChange: (contextId: string) => void;
  fail: (contextId: string) => void;
  latestUndoCheckpoint: (sessionId: string, filePath: string) => DesignAiUndoCheckpoint | undefined;
  popUndoCheckpoint: (sessionId: string, filePath: string) => DesignAiUndoCheckpoint | undefined;
  resetSession: (sessionId: string) => void;
};

function copyContext(context: DesignAiSelectionContext): DesignAiSelectionContext {
  return {
    ...context,
    target: {
      ...context.target,
      styles: { ...context.target.styles },
    },
  };
}

function checkpointFor(
  context: DesignAiSelectionContext,
  result: CompleteDesignAiSelection,
): DesignAiUndoCheckpoint {
  return {
    contextId: context.id,
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
    filePath: context.filePath,
    baseUpdatedAt: context.baseUpdatedAt,
    beforeHtml: context.beforeHtml,
    afterHtml: result.afterHtml,
    afterUpdatedAt: result.afterUpdatedAt,
  };
}

export const useDesignAiSelectionStore = create<DesignAiSelectionStore>((set, get) => ({
  contexts: {},
  statuses: {},
  undoCheckpoints: {},
  createContext: (context) => set((state) => {
    if (state.contexts[context.id]) return state;
    return {
      contexts: { ...state.contexts, [context.id]: copyContext(context) },
      statuses: { ...state.statuses, [context.id]: "pending" },
    };
  }),
  rebasePendingContext: (contextId, baseline) => {
    let rebased = false;
    set((state) => {
      const context = state.contexts[contextId];
      if (!context || state.statuses[contextId] !== "pending") return state;
      rebased = true;
      return {
        contexts: {
          ...state.contexts,
          [contextId]: copyContext({ ...context, ...baseline }),
        },
      };
    });
    return rebased;
  },
  markRunning: (contextId) => set((state) => {
    if (!state.contexts[contextId] || state.statuses[contextId] !== "pending") return state;
    return { statuses: { ...state.statuses, [contextId]: "running" } };
  }),
  claimCompletion: (contextId) => {
    let claimed = false;
    set((state) => {
      if (!state.contexts[contextId] || state.statuses[contextId] !== "running") return state;
      claimed = true;
      return { statuses: { ...state.statuses, [contextId]: "completing" } };
    });
    return claimed;
  },
  complete: (contextId, result) => set((state) => {
    const context = state.contexts[contextId];
    if (!context || state.statuses[contextId] !== "completing") return state;
    const checkpointsForSession = state.undoCheckpoints[context.sessionId] ?? {};
    const checkpointsForFile = checkpointsForSession[context.filePath] ?? [];

    return {
      statuses: { ...state.statuses, [contextId]: "completed" },
      undoCheckpoints: {
        ...state.undoCheckpoints,
        [context.sessionId]: {
          ...checkpointsForSession,
          [context.filePath]: [...checkpointsForFile, checkpointFor(context, result)],
        },
      },
    };
  }),
  completeWithoutChange: (contextId) => set((state) => {
    if (!state.contexts[contextId] || state.statuses[contextId] !== "completing") return state;
    return { statuses: { ...state.statuses, [contextId]: "completed" } };
  }),
  fail: (contextId) => set((state) => {
    const status = state.statuses[contextId];
    if (!state.contexts[contextId] || (status !== "pending" && status !== "running" && status !== "completing")) return state;
    return { statuses: { ...state.statuses, [contextId]: "failed" } };
  }),
  latestUndoCheckpoint: (sessionId, filePath) => {
    const checkpoints = get().undoCheckpoints[sessionId]?.[filePath];
    return checkpoints?.[checkpoints.length - 1];
  },
  popUndoCheckpoint: (sessionId, filePath) => {
    const checkpoint = get().latestUndoCheckpoint(sessionId, filePath);
    if (!checkpoint) return undefined;

    set((state) => {
      const checkpointsForSession = state.undoCheckpoints[sessionId];
      const checkpointsForFile = checkpointsForSession?.[filePath];
      if (!checkpointsForSession || !checkpointsForFile) return state;
      const remaining = checkpointsForFile.slice(0, -1);
      const nextSession = { ...checkpointsForSession };
      if (remaining.length === 0) delete nextSession[filePath];
      else nextSession[filePath] = remaining;
      const undoCheckpoints = { ...state.undoCheckpoints };
      if (Object.keys(nextSession).length === 0) delete undoCheckpoints[sessionId];
      else undoCheckpoints[sessionId] = nextSession;
      return { undoCheckpoints };
    });

    return checkpoint;
  },
  resetSession: (sessionId) => set((state) => {
    const contexts = Object.fromEntries(
      Object.entries(state.contexts).filter(([, context]) => context.sessionId !== sessionId),
    );
    const statuses = Object.fromEntries(
      Object.entries(state.statuses).filter(([contextId]) => contexts[contextId]),
    );
    const undoCheckpoints = { ...state.undoCheckpoints };
    delete undoCheckpoints[sessionId];
    return { contexts, statuses, undoCheckpoints };
  }),
}));
