import { create } from "zustand";

import type { ComposerAttachment, ComposerDraft } from "../../../../app/types";
import type { ComposerMentionKind } from "./composer/mention-encoding";

export type ComposerPastePart = {
  id: string;
  label: string;
  text: string;
  lines: number;
};

export type ComposerSessionState = {
  draft: string;
  attachments: ComposerAttachment[];
  mentions: Record<string, ComposerMentionKind>;
  pasteParts: ComposerPastePart[];
};

export type ComposerStateStore = {
  sessions: Record<string, ComposerSessionState>;
  queuedDrafts: Record<string, ComposerDraft[]>;
  pausedQueues: Record<string, boolean>;
  setDraft: (sessionId: string, draft: string) => void;
  setAttachments: (sessionId: string, attachments: ComposerAttachment[]) => void;
  setMentions: (sessionId: string, mentions: Record<string, ComposerMentionKind>) => void;
  setPasteParts: (sessionId: string, pasteParts: ComposerPastePart[]) => void;
  appendQueuedDraft: (sessionId: string, draft: ComposerDraft) => void;
  removeQueuedDraft: (sessionId: string, index: number) => void;
  removeQueuedDrafts: (sessionId: string, indices: number[]) => void;
  prependQueuedDrafts: (sessionId: string, drafts: ComposerDraft[]) => void;
  setQueuePaused: (sessionId: string, paused: boolean) => void;
  moveQueuedDraftToComposer: (sessionId: string, index: number) => boolean;
  clearSession: (sessionId: string) => void;
  restoreSessionIfEmpty: (sessionId: string, session: ComposerSessionState) => void;
};

const EMPTY_ATTACHMENTS: ComposerAttachment[] = [];
const EMPTY_MENTIONS: Record<string, ComposerMentionKind> = {};
const EMPTY_PASTE_PARTS: ComposerPastePart[] = [];
const EMPTY_QUEUED_DRAFTS: ComposerDraft[] = [];

function createEmptyComposerSession(): ComposerSessionState {
  return {
    draft: "",
    attachments: [],
    mentions: {},
    pasteParts: [],
  };
}

function getWritableSession(state: ComposerStateStore, sessionId: string): ComposerSessionState {
  return state.sessions[sessionId] ?? createEmptyComposerSession();
}

function isEmptyComposerSession(session: ComposerSessionState | undefined) {
  return !session
    || (!session.draft
      && session.attachments.length === 0
      && Object.keys(session.mentions).length === 0
      && session.pasteParts.length === 0);
}

export const useComposerStateStore = create<ComposerStateStore>((set) => ({
  sessions: {},
  queuedDrafts: {},
  pausedQueues: {},
  setDraft: (sessionId, draft) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.draft === draft) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, draft } } };
  }),
  setAttachments: (sessionId, attachments) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.attachments === attachments) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, attachments } } };
  }),
  setMentions: (sessionId, mentions) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.mentions === mentions) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, mentions } } };
  }),
  setPasteParts: (sessionId, pasteParts) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.pasteParts === pasteParts) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, pasteParts } } };
  }),
  appendQueuedDraft: (sessionId, draft) => set((state) => {
    const current = state.queuedDrafts[sessionId] ?? EMPTY_QUEUED_DRAFTS;
    return { queuedDrafts: { ...state.queuedDrafts, [sessionId]: [...current, draft] } };
  }),
  removeQueuedDraft: (sessionId, index) => set((state) => {
    const current = state.queuedDrafts[sessionId];
    if (!current) return state;
    const next = current.filter((_, itemIndex) => itemIndex !== index);
    if (next.length === current.length) return state;
    if (next.length > 0) return { queuedDrafts: { ...state.queuedDrafts, [sessionId]: next } };
    const queuedDrafts = { ...state.queuedDrafts };
    const pausedQueues = { ...state.pausedQueues };
    delete queuedDrafts[sessionId];
    delete pausedQueues[sessionId];
    return { queuedDrafts, pausedQueues };
  }),
  removeQueuedDrafts: (sessionId, indices) => set((state) => {
    const current = state.queuedDrafts[sessionId];
    if (!current || indices.length === 0) return state;
    const selected = new Set(indices);
    const next = current.filter((_, itemIndex) => !selected.has(itemIndex));
    if (next.length === current.length) return state;
    if (next.length > 0) return { queuedDrafts: { ...state.queuedDrafts, [sessionId]: next } };
    const queuedDrafts = { ...state.queuedDrafts };
    const pausedQueues = { ...state.pausedQueues };
    delete queuedDrafts[sessionId];
    delete pausedQueues[sessionId];
    return { queuedDrafts, pausedQueues };
  }),
  prependQueuedDrafts: (sessionId, drafts) => set((state) => {
    if (drafts.length === 0) return state;
    const current = state.queuedDrafts[sessionId] ?? EMPTY_QUEUED_DRAFTS;
    return { queuedDrafts: { ...state.queuedDrafts, [sessionId]: [...drafts, ...current] } };
  }),
  setQueuePaused: (sessionId, paused) => set((state) => {
    if (paused && !state.queuedDrafts[sessionId]?.length) return state;
    if (Boolean(state.pausedQueues[sessionId]) === paused) return state;
    const pausedQueues = { ...state.pausedQueues };
    if (paused) pausedQueues[sessionId] = true;
    else delete pausedQueues[sessionId];
    return { pausedQueues };
  }),
  moveQueuedDraftToComposer: (sessionId, index) => {
    let moved = false;
    set((state) => {
      const draft = state.queuedDrafts[sessionId]?.[index];
      if (!draft || !isEmptyComposerSession(state.sessions[sessionId])
        || draft.command || draft.capability || draft.parts.some((part) => part.type !== "text")) return state;
      const remaining = state.queuedDrafts[sessionId].filter((_, itemIndex) => itemIndex !== index);
      const queuedDrafts = { ...state.queuedDrafts };
      const pausedQueues = { ...state.pausedQueues };
      if (remaining.length) queuedDrafts[sessionId] = remaining;
      else {
        delete queuedDrafts[sessionId];
        delete pausedQueues[sessionId];
      }
      moved = true;
      return {
        sessions: { ...state.sessions, [sessionId]: { draft: draft.text, attachments: draft.attachments, mentions: {}, pasteParts: [] } },
        queuedDrafts,
        pausedQueues,
      };
    });
    return moved;
  },
  clearSession: (sessionId) => set((state) => {
    if (!state.sessions[sessionId]) return state;
    const sessions = { ...state.sessions };
    delete sessions[sessionId];
    return { sessions };
  }),
  restoreSessionIfEmpty: (sessionId, session) => set((state) => {
    if (!isEmptyComposerSession(state.sessions[sessionId])) return state;
    return { sessions: { ...state.sessions, [sessionId]: session } };
  }),
}));

export function getComposerDraft(state: ComposerStateStore, sessionId: string): string {
  return state.sessions[sessionId]?.draft ?? "";
}

export function getComposerAttachments(state: ComposerStateStore, sessionId: string): ComposerAttachment[] {
  return state.sessions[sessionId]?.attachments ?? EMPTY_ATTACHMENTS;
}

export function getComposerMentions(state: ComposerStateStore, sessionId: string): Record<string, ComposerMentionKind> {
  return state.sessions[sessionId]?.mentions ?? EMPTY_MENTIONS;
}

export function getComposerPasteParts(state: ComposerStateStore, sessionId: string): ComposerPastePart[] {
  return state.sessions[sessionId]?.pasteParts ?? EMPTY_PASTE_PARTS;
}

export function getComposerQueuedDrafts(state: ComposerStateStore, sessionId: string): ComposerDraft[] {
  return state.queuedDrafts[sessionId] ?? EMPTY_QUEUED_DRAFTS;
}

export function isComposerQueuePaused(state: ComposerStateStore, sessionId: string): boolean {
  return Boolean(state.pausedQueues[sessionId]);
}
