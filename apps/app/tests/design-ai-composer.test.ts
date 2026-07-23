import { describe, expect, test } from "bun:test";

import * as sessionSurface from "../src/react-app/domains/session/surface/session-surface";

const editorUrl = new URL(
  "../src/react-app/domains/session/surface/composer/editor.tsx",
  import.meta.url,
);
const sessionPageUrl = new URL(
  "../src/react-app/domains/session/chat/session-page.tsx",
  import.meta.url,
);

describe("Design AI composer integration", () => {
  test("converts one Design token into a structured composer part", () => {
    expect(sessionSurface.parseComposerParts).toBeFunction();
    if (typeof sessionSurface.parseComposerParts !== "function") return;
    const parts = sessionSurface.parseComposerParts("[[design-ai:design-ai-1]] make it blue", {
      mentions: {},
      pasteParts: [],
      designSelectionLabel: () => "H1 路 Original",
    });

    expect(parts).toContainEqual({
      type: "design-selection",
      contextId: "design-ai-1",
      label: "H1 路 Original",
    });
    expect(parts).toContainEqual({ type: "text", text: " make it blue" });
  });

  test("replaces the previous Design token without changing the current prompt", () => {
    expect(sessionSurface.replaceDesignSelectionToken).toBeFunction();
    if (typeof sessionSurface.replaceDesignSelectionToken !== "function") return;
    expect(
      sessionSurface.replaceDesignSelectionToken(
        "[[design-ai:design-ai-old]] make it blue",
        "[[design-ai:design-ai-new]]",
      ),
    ).toBe("make it blue\n[[design-ai:design-ai-new]] ");
  });

  test("renders a Design token as an atomic purple chip", async () => {
    const source = await Bun.file(editorUrl).text();

    expect(source).toContain("composer-design-selection");
    expect(source).toContain('data-composer-token", "design-selection"');
    expect(source).toContain('contentEditable = "false"');
    expect(source).toContain("violet");
    expect(source).toContain("ComposerDesignSelectionNode");
  });

  test("wires Ask AI through the composer draft store and focuses the prompt", async () => {
    const source = await Bun.file(sessionPageUrl).text();

    expect(source).toContain("onAskAi={handleDesignAskAi}");
    expect(source).toContain("useComposerStateStore.getState()");
    expect(source).toContain("replaceDesignSelectionToken");
    expect(source).toContain('new Event("ipollowork:focusPrompt")');
  });
});
