import { describe, expect, test } from "bun:test";

import {
  popDesignUndoHistory,
  pushDesignUndoHistory,
  shouldHydrateDesignSource,
} from "../src/react-app/domains/session/design/design-undo-history";

describe("Design undo history", () => {
  test("pops distinct snapshots in order across consecutive undos", () => {
    let history: string[] = [];
    history = pushDesignUndoHistory(history, "A");
    history = pushDesignUndoHistory(history, "B");
    history = pushDesignUndoHistory(history, "C");

    const first = popDesignUndoHistory(history, "D");
    expect(first.previous).toBe("C");
    expect(first.history).toEqual(["A", "B"]);

    const second = popDesignUndoHistory(first.history, first.previous ?? "");
    expect(second.previous).toBe("B");
    expect(second.history).toEqual(["A"]);
  });

  test("drops duplicate and current snapshots instead of producing invisible undos", () => {
    let history: string[] = [];
    history = pushDesignUndoHistory(history, "A");
    history = pushDesignUndoHistory(history, "B");
    history = pushDesignUndoHistory(history, "B");

    expect(history).toEqual(["A", "B"]);
    expect(popDesignUndoHistory(history, "B")).toEqual({ previous: "A", history: [] });
  });

  test("does not replace the editor session when a save echoes the current draft", () => {
    expect(shouldHydrateDesignSource(false, "saved draft", "saved draft")).toBe(false);
    expect(shouldHydrateDesignSource(false, "external update", "current draft")).toBe(true);
    expect(shouldHydrateDesignSource(true, "same source", "same source")).toBe(true);
  });
});
