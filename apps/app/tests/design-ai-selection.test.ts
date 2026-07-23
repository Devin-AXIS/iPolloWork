import { beforeEach, describe, expect, test } from "bun:test";

import {
  designAiSelectionInstruction,
  designAiSelectionToken,
  parseDesignAiSelectionToken,
  type DesignAiSelectionContext,
} from "../src/react-app/domains/session/design/design-ai-selection";
import { useDesignAiSelectionStore } from "../src/react-app/domains/session/design/design-ai-selection-store";

const context: DesignAiSelectionContext = {
  id: "design-ai-1",
  sessionId: "ses_1",
  workspaceId: "workspace_1",
  filePath: "design/ses_1/index.html",
  baseUpdatedAt: 11,
  beforeHtml: "<h1>Original</h1>",
  target: {
    tag: "h1",
    label: "H1 · Original",
    locator: "body > h1:nth-of-type(1)",
    text: "Original",
    src: "",
    alt: "",
    styles: { color: "black" },
  },
};

const panelUrl = new URL(
  "../src/react-app/domains/session/design/design-panel.tsx",
  import.meta.url,
);

describe("Design AI selections", () => {
  beforeEach(() => {
    useDesignAiSelectionStore.getState().resetSession("ses_1");
  });

  test("round-trips a Design selection chip token", () => {
    expect(parseDesignAiSelectionToken(designAiSelectionToken("design-ai-1"))).toBe("design-ai-1");
    expect(parseDesignAiSelectionToken("[design-ai:design-ai-1]")).toBeNull();
  });

  test("restricts the agent instruction to one element in one file", () => {
    const instruction = designAiSelectionInstruction(context);

    expect(instruction).toContain("design/ses_1/index.html");
    expect(instruction).toContain("body > h1:nth-of-type(1)");
    expect(instruction).toContain("Do not modify any other element");
  });

  test("stores an immutable Design selection context", () => {
    const store = useDesignAiSelectionStore.getState();
    store.createContext(context);
    context.target.styles.color = "red";

    expect(useDesignAiSelectionStore.getState().contexts["design-ai-1"]?.target.styles.color).toBe("black");
  });

  test("keeps completed checkpoints in LIFO order", () => {
    const store = useDesignAiSelectionStore.getState();
    store.createContext(context);
    store.complete("design-ai-1", { afterHtml: "<h1>One</h1>", afterUpdatedAt: 13 });

    const secondContext = {
      ...context,
      id: "design-ai-2",
      beforeHtml: "<h1>One</h1>",
      baseUpdatedAt: 13,
    };
    store.createContext(secondContext);
    store.complete("design-ai-2", { afterHtml: "<h1>Two</h1>", afterUpdatedAt: 15 });

    expect(store.latestUndoCheckpoint("ses_1", "design/ses_1/index.html")?.beforeHtml).toContain("One");
    expect(store.popUndoCheckpoint("ses_1", "design/ses_1/index.html")?.beforeHtml).toContain("One");
    expect(store.latestUndoCheckpoint("ses_1", "design/ses_1/index.html")?.beforeHtml).toContain("Original");
  });

  test("completes an unchanged agent turn without creating an undo checkpoint", () => {
    const store = useDesignAiSelectionStore.getState();
    store.createContext(context);
    store.markRunning("design-ai-1");
    store.completeWithoutChange("design-ai-1");

    expect(useDesignAiSelectionStore.getState().statuses["design-ai-1"]).toBe("completed");
    expect(store.latestUndoCheckpoint("ses_1", "design/ses_1/index.html")).toBeUndefined();
  });

  test("does not duplicate a checkpoint when completion is delivered twice", () => {
    const store = useDesignAiSelectionStore.getState();
    store.createContext(context);
    store.markRunning("design-ai-1");
    store.complete("design-ai-1", { afterHtml: "<h1>One</h1>", afterUpdatedAt: 13 });
    store.complete("design-ai-1", { afterHtml: "<h1>One</h1>", afterUpdatedAt: 13 });

    expect(useDesignAiSelectionStore.getState().undoCheckpoints.ses_1?.[context.filePath]).toHaveLength(1);
  });

  test("writes the AI pre-image with the post-agent revision during undo", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("baseUpdatedAt: checkpoint.afterUpdatedAt");
    expect(source).toContain("Could not undo the AI Design change because the file changed");
    expect(source).toContain("popUndoCheckpoint(sessionId, activePagePath)");
    expect(source).toContain("checkpoint.afterHtml");
    expect(source).toContain("const restored = await client.readWorkspaceFile(workspaceId, activePagePath)");
    expect(source).toContain("setPreviewRevision((current) => current + 1)");
  });

  test("removes every context and checkpoint for a reset session", () => {
    const store = useDesignAiSelectionStore.getState();
    store.createContext(context);
    store.markRunning("design-ai-1");
    store.complete("design-ai-1", { afterHtml: "<h1>One</h1>", afterUpdatedAt: 13 });
    store.fail("design-ai-1");
    store.resetSession("ses_1");

    expect(useDesignAiSelectionStore.getState().contexts["design-ai-1"]).toBeUndefined();
    expect(store.latestUndoCheckpoint("ses_1", "design/ses_1/index.html")).toBeUndefined();
  });
});
