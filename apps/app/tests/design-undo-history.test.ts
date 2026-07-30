import { describe, expect, test } from "bun:test";

import {
  popDesignUndoHistory,
  pushDesignUndoHistory,
  shouldHydrateDesignSource,
} from "../src/react-app/domains/session/design/design-undo-history";

describe("Design undo history", () => {
  test("pops distinct snapshots in order across consecutive undos", () => {
    let history = pushDesignUndoHistory([], { html: "A", tokenCss: "tokens-a" });
    history = pushDesignUndoHistory(history, { html: "B", tokenCss: "tokens-b" });
    history = pushDesignUndoHistory(history, { html: "C", tokenCss: "tokens-c" });

    const first = popDesignUndoHistory(history, { html: "D", tokenCss: "tokens-d" });
    expect(first.previous).toEqual({ html: "C", tokenCss: "tokens-c" });
    expect(first.history).toEqual([
      { html: "A", tokenCss: "tokens-a" },
      { html: "B", tokenCss: "tokens-b" },
    ]);

    const second = popDesignUndoHistory(first.history, first.previous ?? { html: "", tokenCss: "" });
    expect(second.previous).toEqual({ html: "B", tokenCss: "tokens-b" });
    expect(second.history).toEqual([{ html: "A", tokenCss: "tokens-a" }]);
  });

  test("drops duplicate and current snapshots instead of producing invisible undos", () => {
    const snapshotA = { html: "A", tokenCss: "tokens-a" };
    const snapshotB = { html: "B", tokenCss: "tokens-b" };
    let history = pushDesignUndoHistory([], snapshotA);
    history = pushDesignUndoHistory(history, snapshotB);
    history = pushDesignUndoHistory(history, snapshotB);

    expect(history).toEqual([snapshotA, snapshotB]);
    expect(popDesignUndoHistory(history, snapshotB)).toEqual({ previous: snapshotA, history: [] });
  });

  test("keeps HTML-identical theme changes as distinct snapshots", () => {
    const beforeTheme = { html: "<main>Design</main>", tokenCss: "theme-a", restoreTokenCss: true };
    const afterTheme = { html: "<main>Design</main>", tokenCss: "theme-b" };
    const history = pushDesignUndoHistory(
      pushDesignUndoHistory([], beforeTheme),
      afterTheme,
    );

    expect(history).toEqual([beforeTheme, afterTheme]);
    expect(popDesignUndoHistory(history, afterTheme)).toEqual({
      previous: beforeTheme,
      history: [],
    });
  });

  test("keeps the newest mutation scope when the state snapshot is deduplicated", () => {
    const state = { html: "<main>Design</main>", tokenCss: "theme-a" };
    const history = pushDesignUndoHistory(
      pushDesignUndoHistory([], state),
      { ...state, restoreTokenCss: true },
    );

    expect(history).toEqual([{ ...state, restoreTokenCss: true }]);
  });

  test("skips an HTML-identical canvas snapshot after an unrelated token edit", () => {
    const history = pushDesignUndoHistory([], {
      html: "<main>Current</main>",
      tokenCss: "theme-a",
    });

    expect(popDesignUndoHistory(history, {
      html: "<main>Current</main>",
      tokenCss: "theme-b",
    })).toEqual({
      previous: undefined,
      history: [],
    });
  });

  test("does not replace the editor session when a save echoes the current draft", () => {
    expect(shouldHydrateDesignSource(false, "saved draft", "saved draft")).toBe(false);
    expect(shouldHydrateDesignSource(false, "external update", "current draft")).toBe(true);
    expect(shouldHydrateDesignSource(true, "same source", "same source")).toBe(true);
  });
});
