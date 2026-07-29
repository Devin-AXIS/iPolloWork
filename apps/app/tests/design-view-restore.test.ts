import { describe, expect, test } from "bun:test";

import {
  acceptsDesignDeckMessage,
  expectsDesignRestoreFrame,
  restoredSelectionLocator,
  shouldIgnoreDesignDraftMessage,
  type DesignViewRestore,
} from "../src/react-app/domains/session/design/design-view-restore";

const pending = (overrides: Partial<DesignViewRestore> = {}): DesignViewRestore => ({
  id: "undo-2",
  targetSource: "B",
  previewRevision: 7,
  frameRevision: "design/page.html:7",
  frameLoaded: false,
  frameRestored: false,
  deckRestored: false,
  deckIndex: 3,
  frameScrollX: 12,
  frameScrollY: 34,
  panLeft: 56,
  panTop: 78,
  selectionLocator: "body > main > h1",
  ...overrides,
});

describe("Design undo view restoration", () => {
  test("accepts ordinary deck messages when no restore is pending", () => {
    expect(acceptsDesignDeckMessage(null, { index: 0, viewRevision: "" })).toBe(true);
  });

  test("rejects initial and stale deck reports until the restored index is acknowledged", () => {
    expect(acceptsDesignDeckMessage(pending(), { index: 0, viewRevision: "" })).toBe(false);
    expect(acceptsDesignDeckMessage(pending({ frameLoaded: true }), { index: 3, viewRevision: "undo-1" })).toBe(false);
    expect(acceptsDesignDeckMessage(pending({ frameLoaded: true }), { index: 0, viewRevision: "undo-2" })).toBe(false);
    expect(acceptsDesignDeckMessage(pending({ frameLoaded: true }), { index: 3, viewRevision: "undo-2" })).toBe(true);
  });

  test("accepts a hydrated replacement iframe after its frame revision advances", () => {
    expect(expectsDesignRestoreFrame(pending(), "A", 7)).toBe(false);
    expect(expectsDesignRestoreFrame(pending(), "B", 6)).toBe(false);
    expect(expectsDesignRestoreFrame(pending(), "B", 7)).toBe(true);
    // Asset hydration creates a second iframe after undo. That later frame
    // must finish the same restore rather than leaving undo locked.
    expect(expectsDesignRestoreFrame(pending(), "B", 8, "design/page.html:8")).toBe(true);
    expect(expectsDesignRestoreFrame(pending(), "B", 7, "design/page.html:6")).toBe(false);
    expect(expectsDesignRestoreFrame(pending(), "B", 7, "design/page.html:7")).toBe(true);
  });

  test("blocks queued draft messages until the replacement frame has finished restoring", () => {
    expect(shouldIgnoreDesignDraftMessage(pending())).toBe(true);
    expect(shouldIgnoreDesignDraftMessage(pending({ frameLoaded: true }))).toBe(true);
    expect(shouldIgnoreDesignDraftMessage(null)).toBe(false);
  });

  test("restores the saved locator only after the correct iframe and deck view are ready", () => {
    expect(restoredSelectionLocator(pending())).toBeNull();
    expect(restoredSelectionLocator(pending({ frameLoaded: true, frameRestored: true }))).toBeNull();
    expect(restoredSelectionLocator(pending({ frameLoaded: true, frameRestored: true, deckRestored: true }))).toBe("body > main > h1");
    expect(restoredSelectionLocator(pending({ frameLoaded: true, frameRestored: true, deckIndex: null }))).toBe("body > main > h1");
  });
});
