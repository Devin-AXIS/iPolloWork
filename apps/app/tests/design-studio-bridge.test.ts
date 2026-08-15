import { describe, expect, test } from "bun:test";

import {
  DESIGN_STUDIO_HOST_CHANNEL,
  designStudioAskAiPrompt,
  designStudioAskAiRequest,
  isDesignStudioHostMessage,
  type DesignAiSelectionContext,
} from "@ipollowork/design-studio";

const context: DesignAiSelectionContext = {
  id: "design-ai-bridge",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  filePath: "design/session-1/index.html",
  baseUpdatedAt: 42,
  beforeHtml: "<main>private full document</main>",
  target: {
    tag: "h1",
    label: "H1 · Product launch",
    locator: "body > main > h1:nth-of-type(1)",
    text: "Product launch",
    src: "",
    alt: "",
    styles: { color: "rgb(23, 23, 23)" },
  },
};

describe("Design Studio host bridge", () => {
  test("stages only bounded selection context across the host boundary", () => {
    const request = designStudioAskAiRequest(context);
    expect("beforeHtml" in request).toBe(false);
    expect(request.filePath).toBe(context.filePath);
    expect(request.target.locator).toBe(context.target.locator);
  });

  test("recognizes the versioned ask-ai envelope", () => {
    expect(isDesignStudioHostMessage({
      channel: DESIGN_STUDIO_HOST_CHANNEL,
      type: "ask-ai",
      request: designStudioAskAiRequest(context),
    })).toBe(true);
    expect(isDesignStudioHostMessage({ channel: "other", type: "ask-ai", request: {} })).toBe(false);
  });

  test("creates a reviewable file-and-locator prompt without embedding the document", () => {
    const prompt = designStudioAskAiPrompt(designStudioAskAiRequest(context));
    expect(prompt).toContain(context.filePath);
    expect(prompt).toContain(context.target.locator);
    expect(prompt).not.toContain(context.beforeHtml);
    expect(prompt).toEndWith("My requested change:");
  });
});
