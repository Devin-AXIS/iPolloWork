import { beforeEach, describe, expect, test } from "bun:test";

import type { ComposerDraft } from "../src/app/types";
import * as sessionRoute from "../src/react-app/shell/session-route";
import { useDesignAiSelectionStore } from "../src/react-app/domains/session/design/design-ai-selection-store";

const routeUrl = new URL("../src/react-app/shell/session-route.tsx", import.meta.url);
const runtimeUrl = new URL(
  "../src/react-app/domains/session/sync/runtime-sync.tsx",
  import.meta.url,
);

describe("Design AI session lifecycle", () => {
  beforeEach(() => {
    useDesignAiSelectionStore.getState().resetSession("ses_1");
  });

  test("expands the selected Design chip to a synthetic scoped agent instruction", async () => {
    expect(sessionRoute.draftToParts).toBeFunction();
    if (typeof sessionRoute.draftToParts !== "function") return;

    useDesignAiSelectionStore.getState().createContext({
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
    });
    const draft: ComposerDraft = {
      mode: "prompt",
      parts: [
        { type: "design-selection", contextId: "design-ai-1", label: "H1 · Original" },
        { type: "text", text: "Make it blue." },
      ],
      attachments: [],
      text: "[[design-ai:design-ai-1]] Make it blue.",
    };

    const parts = await sessionRoute.draftToParts(
      draft,
      "C:/workspace",
      useDesignAiSelectionStore,
    );

    expect(parts[0]).toMatchObject({ type: "text", synthetic: true });
    expect(JSON.stringify(parts[0])).toContain("design/ses_1/index.html");
    expect(JSON.stringify(parts[0])).toContain("body > h1:nth-of-type(1)");
    expect(JSON.stringify(parts[0])).toContain("Do not modify any other element");
    expect(parts[1]).toEqual({ type: "text", text: "Make it blue." });
    expect(JSON.stringify(parts)).not.toContain("[[design-ai:");
  });

  test("preflights the Design snapshot before prompt submission and completes only on idle", async () => {
    const source = await Bun.file(routeUrl).text();
    const preflightRead = source.indexOf("readWorkspaceFile(context.workspaceId, context.filePath)");
    const preflightWrite = source.indexOf("content: context.beforeHtml");
    const markRunning = source.indexOf("markRunning(context.id)");
    const prompt = source.indexOf("session.promptAsync({");

    expect(preflightRead).toBeGreaterThan(-1);
    expect(source).toContain("current.updatedAt ?? null");
    expect(source).toContain("baseUpdatedAt: current.updatedAt ?? null");
    expect(preflightWrite).toBeGreaterThan(preflightRead);
    expect(markRunning).toBeGreaterThan(preflightRead);
    expect(prompt).toBeGreaterThan(markRunning);
    expect(source).toContain('update.status.type !== "idle"');
    expect(source).toContain('statuses[context.id] === "running"');
    expect(source).toContain("after.content !== context.beforeHtml");
    expect(source).toContain("afterUpdatedAt: after.updatedAt ?? null");
    expect(source).toContain("completeWithoutChange(context.id)");
    expect(source).toContain("onSessionStatus={handleSessionStatus}");
  });

  test("threads the optional session status callback through the React runtime", async () => {
    const source = await Bun.file(runtimeUrl).text();

    expect(source).toContain("onSessionStatus?:");
    expect(source).toContain("onSessionStatus: props.onSessionStatus");
  });
});
