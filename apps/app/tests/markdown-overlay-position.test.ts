import { describe, expect, test } from "bun:test";

import { resolveMarkdownOverlayPosition } from "../src/react-app/domains/session/artifacts/markdown-overlay-position";
import { getSlashMenuPosition } from "../src/react-app/domains/session/artifacts/markdown-editor-overlays";

describe("Markdown editor overlay positioning", () => {
  const editor = { left: 40, top: 20, right: 340, bottom: 420, width: 300, height: 400 };

  test("keeps a selection toolbar inside a narrow editor", () => {
    const position = resolveMarkdownOverlayPosition(
      { left: 42, top: 120, right: 70, bottom: 140, width: 28, height: 20 },
      editor,
      { width: 420, height: 40 },
    );

    expect(position.left).toBe(8);
    expect(position.maxWidth).toBe(284);
    expect(position.left + Math.min(420, position.maxWidth)).toBeLessThanOrEqual(292);
  });

  test("flips below when the top edge has no room", () => {
    const position = resolveMarkdownOverlayPosition(
      { left: 140, top: 22, right: 180, bottom: 42, width: 40, height: 20 },
      editor,
      { width: 240, height: 56 },
    );

    expect(position.placement).toBe("below");
    expect(position.top).toBe(28);
  });

  test("limits tall image editors to the available height", () => {
    const position = resolveMarkdownOverlayPosition(
      { left: 280, top: 380, right: 330, bottom: 400, width: 50, height: 20 },
      editor,
      { width: 320, height: 520 },
    );

    expect(position.top).toBe(8);
    expect(position.maxHeight).toBe(384);
  });

  test("keeps the slash menu inside a very short editor", () => {
    const position = getSlashMenuPosition(
      { left: 40, top: 20, right: 340, bottom: 80, width: 300, height: 60 },
      { left: 100, top: 42, right: 110, bottom: 62 },
      12,
    );

    expect(position.top).toBe(8);
    expect(position.maxHeight).toBe(44);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(52);
  });
});
