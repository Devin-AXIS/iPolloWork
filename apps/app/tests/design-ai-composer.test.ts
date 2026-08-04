import { describe, expect, test } from "bun:test";

import * as composerDraft from "../src/react-app/domains/session/surface/composer/composer-draft";

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
    expect(composerDraft.parseComposerParts).toBeFunction();
    if (typeof composerDraft.parseComposerParts !== "function") return;
    const parts = composerDraft.parseComposerParts("[[design-ai:design-ai-1]] make it blue", {
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
    expect(composerDraft.replaceDesignSelectionToken).toBeFunction();
    if (typeof composerDraft.replaceDesignSelectionToken !== "function") return;
    expect(
      composerDraft.replaceDesignSelectionToken(
        "[[design-ai:design-ai-old]] make it blue",
        "[[design-ai:design-ai-new]]",
      ),
    ).toBe("make it blue\n[[design-ai:design-ai-new]] ");
  });

  test("preserves a Design selection draft when prompt submission fails", () => {
    expect(composerDraft.shouldPreserveComposerDraftAfterSendFailure).toBeFunction();
    if (typeof composerDraft.shouldPreserveComposerDraftAfterSendFailure !== "function") return;

    expect(composerDraft.shouldPreserveComposerDraftAfterSendFailure({
      mode: "prompt",
      parts: [{ type: "design-selection", contextId: "design-ai-1", label: "H1 Original" }],
      attachments: [],
      text: "[[design-ai:design-ai-1]] Make it blue.",
    })).toBe(true);
    expect(composerDraft.shouldPreserveComposerDraftAfterSendFailure({
      mode: "prompt",
      parts: [{ type: "text", text: "Ordinary prompt" }],
      attachments: [],
      text: "Ordinary prompt",
    })).toBe(false);
  });

  test("uses the composer, not the queue, as the sole retry surface for a failed queued Design draft", () => {
    expect(composerDraft.failedDraftRetrySurface).toBeFunction();
    if (typeof composerDraft.failedDraftRetrySurface !== "function") return;

    const designDraft = {
      mode: "prompt" as const,
      parts: [{ type: "design-selection" as const, contextId: "design-ai-1", label: "H1 Original" }],
      attachments: [],
      text: "[[design-ai:design-ai-1]] Make it blue.",
    };
    const ordinaryDraft = {
      mode: "prompt" as const,
      parts: [{ type: "text" as const, text: "Ordinary prompt" }],
      attachments: [],
      text: "Ordinary prompt",
    };

    expect(composerDraft.failedDraftRetrySurface(designDraft)).toBe("composer");
    expect(composerDraft.failedDraftRetrySurface(ordinaryDraft)).toBe("queue");
  });

  test("renders a Design token as an atomic purple chip", async () => {
    const source = await Bun.file(editorUrl).text();

    expect(source).toContain("composer-design-selection");
    expect(source).toContain('data-composer-token", "design-selection"');
    expect(source).toContain('contentEditable = "false"');
    expect(source).toContain("violet");
    expect(source).toContain("ComposerDesignSelectionNode");
  });

  test("lets the user remove a Design token from its inline icon", async () => {
    const source = await Bun.file(editorUrl).text();
    const backspaceCommand = source.indexOf(
      "KEY_BACKSPACE_COMMAND",
      source.indexOf("KEY_BACKSPACE_COMMAND") + 1,
    );
    const arrowLeftCommand = source.indexOf(
      "KEY_ARROW_LEFT_COMMAND",
      source.indexOf("KEY_ARROW_LEFT_COMMAND") + 1,
    );
    const backspaceHandler = source.slice(
      backspaceCommand,
      arrowLeftCommand,
    );

    expect(source).toContain("data-design-selection-remove-key");
    expect(source).toContain("Remove design selection:");
    expect(source).toContain("function DesignSelectionDeletePlugin");
    expect(source).toContain("$getNodeByKey(key)");
    expect(source).toContain("<DesignSelectionDeletePlugin disabled={props.disabled} />");
    expect(backspaceHandler).not.toContain("previous instanceof ComposerPastedTextNode || previous instanceof ComposerDesignSelectionNode");
    expect(backspaceHandler).toContain("if (previous instanceof ComposerDesignSelectionNode) return true;");
  });

  test("wires Ask AI through the composer draft store and focuses the prompt", async () => {
    const source = await Bun.file(sessionPageUrl).text();

    expect(source).toContain("onAskAi={handleDesignAskAi}");
    expect(source).toContain("useComposerStateStore.getState()");
    expect(source).toContain("replaceDesignSelectionToken");
    expect(source).toContain('new Event("ipollowork:focusPrompt")');
  });
});
