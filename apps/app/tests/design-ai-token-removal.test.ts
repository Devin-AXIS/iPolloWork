import { describe, expect, test } from "bun:test";

import { removeComposerDesignSelectionToken } from "../src/react-app/domains/session/surface/composer/design-selection-token";

const editorUrl = new URL(
  "../src/react-app/domains/session/surface/composer/editor.tsx",
  import.meta.url,
);

describe("Design AI composer token removal", () => {
  test("removes only the selected element chip from the prompt", () => {
    expect(removeComposerDesignSelectionToken(
      "Keep this copy\n[[design-ai:design-ai-1]] ",
      "design-ai-1",
    )).toBe("Keep this copy");
  });

  test("offers a visible mouse removal control", async () => {
    const source = await Bun.file(editorUrl).text();

    expect(source).toContain("data-design-selection-remove");
    expect(source).toContain("Remove selected element from Ask AI");
    expect(source).toContain("removeComposerDesignSelectionToken(valueRef.current, contextId)");
  });
});
