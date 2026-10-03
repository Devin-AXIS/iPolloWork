import { beforeEach, describe, expect, test } from "bun:test";

import type { ComposerDraft } from "../src/app/types";
import {
  getComposerDraft,
  getComposerQueuedDrafts,
  useComposerStateStore,
} from "../src/react-app/domains/session/surface/composer-state-store";
import { deriveComposerInputHistory } from "../src/react-app/domains/session/surface/session-render-state";

function reset() {
  useComposerStateStore.setState({ sessions: {}, queuedDrafts: {}, pausedQueues: {} });
}

function draft(text: string): ComposerDraft {
  return {
    mode: "prompt",
    parts: [{ type: "text", text }],
    attachments: [],
    text,
    resolvedText: text,
    command: undefined,
  };
}

describe("composer state store", () => {
  beforeEach(reset);

  test("scopes queued drafts by session", () => {
    const { appendQueuedDraft } = useComposerStateStore.getState();
    appendQueuedDraft("session-a", draft("queued in A"));
    appendQueuedDraft("session-b", draft("queued in B"));

    const state = useComposerStateStore.getState();
    expect(getComposerQueuedDrafts(state, "session-a").map((item) => item.text)).toEqual(["queued in A"]);
    expect(getComposerQueuedDrafts(state, "session-b").map((item) => item.text)).toEqual(["queued in B"]);
  });

  test("clearing composer input does not clear queued drafts", () => {
    const { appendQueuedDraft, clearSession, setDraft } = useComposerStateStore.getState();
    setDraft("session-a", "in-progress draft");
    appendQueuedDraft("session-a", draft("queued follow-up"));

    clearSession("session-a");

    expect(getComposerQueuedDrafts(useComposerStateStore.getState(), "session-a").map((item) => item.text)).toEqual([
      "queued follow-up",
    ]);
  });

  test("removing a queued draft only affects the target session", () => {
    const { appendQueuedDraft, removeQueuedDraft } = useComposerStateStore.getState();
    appendQueuedDraft("session-a", draft("first A"));
    appendQueuedDraft("session-a", draft("second A"));
    appendQueuedDraft("session-b", draft("only B"));

    removeQueuedDraft("session-a", 0);
    expect(getComposerQueuedDrafts(useComposerStateStore.getState(), "session-a").map((item) => item.text)).toEqual([
      "second A",
    ]);
    expect(getComposerQueuedDrafts(useComposerStateStore.getState(), "session-b").map((item) => item.text)).toEqual([
      "only B",
    ]);
  });

  test("stopping pauses only the current session queue and preserves its order", () => {
    const store = useComposerStateStore.getState();
    store.appendQueuedDraft("session-a", draft("first"));
    store.appendQueuedDraft("session-a", draft("second"));
    store.appendQueuedDraft("session-b", draft("other"));
    store.setQueuePaused("session-a", true);

    const paused = useComposerStateStore.getState();
    expect(paused.pausedQueues).toEqual({ "session-a": true });
    expect(getComposerQueuedDrafts(paused, "session-a").map((item) => item.text)).toEqual(["first", "second"]);
    expect(getComposerQueuedDrafts(paused, "session-b").map((item) => item.text)).toEqual(["other"]);

    store.setQueuePaused("session-a", false);
    expect(useComposerStateStore.getState().pausedQueues).toEqual({});
  });

  test("editing a queued prompt moves it to an empty composer without touching the rest", () => {
    const store = useComposerStateStore.getState();
    store.appendQueuedDraft("session-a", draft("edit me"));
    store.appendQueuedDraft("session-a", draft("keep me"));
    store.setQueuePaused("session-a", true);
    store.setDraft("session-a", "current text");
    expect(store.moveQueuedDraftToComposer("session-a", 0)).toBe(false);
    expect(getComposerQueuedDrafts(useComposerStateStore.getState(), "session-a")).toHaveLength(2);

    store.setDraft("session-a", "");
    expect(store.moveQueuedDraftToComposer("session-a", 0)).toBe(true);
    expect(getComposerDraft(useComposerStateStore.getState(), "session-a")).toBe("edit me");
    expect(getComposerQueuedDrafts(useComposerStateStore.getState(), "session-a").map((item) => item.text)).toEqual(["keep me"]);
    expect(useComposerStateStore.getState().pausedQueues["session-a"]).toBe(true);
  });

  test("restores a failed submitted draft only while the composer is still empty", () => {
    const { clearSession, restoreSessionIfEmpty, setDraft } = useComposerStateStore.getState();
    const submitted = { draft: "original prompt", attachments: [], mentions: {}, pasteParts: [] };

    setDraft("session-a", submitted.draft);
    clearSession("session-a");
    restoreSessionIfEmpty("session-a", submitted);
    expect(getComposerDraft(useComposerStateStore.getState(), "session-a")).toBe("original prompt");

    clearSession("session-a");
    setDraft("session-a", "next prompt");
    restoreSessionIfEmpty("session-a", submitted);
    expect(getComposerDraft(useComposerStateStore.getState(), "session-a")).toBe("next prompt");
  });

  test("derives input recall history from persisted user messages", () => {
    const messages = [
      { id: "user-1", role: "user" as const, parts: [{ type: "text" as const, text: "first prompt" }] },
      { id: "assistant-1", role: "assistant" as const, parts: [{ type: "text" as const, text: "answer" }] },
      { id: "user-2", role: "user" as const, parts: [{ type: "text" as const, text: "second prompt" }] },
      { id: "user-3", role: "user" as const, parts: [{ type: "text" as const, text: "second prompt" }] },
    ];

    expect(deriveComposerInputHistory(messages)).toEqual(["first prompt", "second prompt"]);
  });
});
