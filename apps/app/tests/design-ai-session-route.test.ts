import { beforeEach, describe, expect, test } from "bun:test";

import type { ComposerDraft } from "../src/app/types";
import * as sessionRoute from "../src/react-app/shell/session-route";
import type { DesignAiSelectionContext } from "../src/react-app/domains/session/design/design-ai-selection";
import { useDesignAiSelectionStore } from "../src/react-app/domains/session/design/design-ai-selection-store";

const routeUrl = new URL("../src/react-app/shell/session-route.tsx", import.meta.url);
const runtimeUrl = new URL(
  "../src/react-app/domains/session/sync/runtime-sync.tsx",
  import.meta.url,
);

const lifecycleContext: DesignAiSelectionContext = {
  id: "design-ai-lifecycle",
  sessionId: "ses_1",
  workspaceId: "workspace_1",
  filePath: "design/ses_1/index.html",
  baseUpdatedAt: 11,
  beforeHtml: "<h1>Original</h1>",
  target: {
    tag: "h1",
    label: "H1 Original",
    locator: "body > h1:nth-of-type(1)",
    text: "Original",
    src: "",
    alt: "",
    styles: { color: "black" },
  },
};

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
      { sessionId: "ses_1", workspaceId: "workspace_1" },
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
    expect(source).toContain("claimCompletion(context.id)");
    expect(source).toContain("after.content !== context.beforeHtml");
    expect(source).toContain("afterUpdatedAt: after.updatedAt ?? null");
    expect(source).toContain("completeWithoutChange(context.id)");
    expect(source).toContain("onSessionStatus={handleSessionStatus}");
  });

  test("rejects missing and foreign Design contexts before synthetic expansion", async () => {
    const store = useDesignAiSelectionStore.getState();
    store.createContext(lifecycleContext);
    const draft = (contextId: string): ComposerDraft => ({
      mode: "prompt",
      parts: [{ type: "design-selection", contextId, label: "H1 Original" }],
      attachments: [],
      text: "",
    });

    await expect(sessionRoute.draftToParts(
      draft(lifecycleContext.id),
      "C:/workspace",
      useDesignAiSelectionStore,
      { sessionId: "ses_2", workspaceId: "workspace_1" },
    )).rejects.toThrow("does not belong to this session");
    await expect(sessionRoute.draftToParts(
      draft(lifecycleContext.id),
      "C:/workspace",
      useDesignAiSelectionStore,
      { sessionId: "ses_1", workspaceId: "workspace_2" },
    )).rejects.toThrow("does not belong to this workspace");
    await expect(sessionRoute.draftToParts(
      draft("missing"),
      "C:/workspace",
      useDesignAiSelectionStore,
      { sessionId: "ses_1", workspaceId: "workspace_1" },
    )).rejects.toThrow("is no longer available");
  });

  test("rejects drafts with more than one unique Design selection", async () => {
    const second = { ...lifecycleContext, id: "design-ai-lifecycle-second" };
    const store = useDesignAiSelectionStore.getState();
    store.createContext(lifecycleContext);
    store.createContext(second);
    const draft: ComposerDraft = {
      mode: "prompt",
      parts: [
        { type: "design-selection", contextId: lifecycleContext.id, label: "H1 Original" },
        { type: "design-selection", contextId: second.id, label: "P Original" },
      ],
      attachments: [],
      text: "",
    };

    await expect(sessionRoute.draftToParts(
      draft,
      "C:/workspace",
      useDesignAiSelectionStore,
      { sessionId: "ses_1", workspaceId: "workspace_1" },
    )).rejects.toThrow("Only one Design element can be edited at a time");
  });

  test("expands repeated copies of the same Design token only once", async () => {
    const store = useDesignAiSelectionStore.getState();
    store.createContext(lifecycleContext);
    const parts = await sessionRoute.draftToParts({
      mode: "prompt",
      parts: [
        { type: "design-selection", contextId: lifecycleContext.id, label: "H1 Original" },
        { type: "design-selection", contextId: lifecycleContext.id, label: "H1 Original" },
        { type: "text", text: "Make it blue." },
      ],
      attachments: [],
      text: "",
    }, "C:/workspace", useDesignAiSelectionStore, { sessionId: "ses_1", workspaceId: "workspace_1" });

    expect(parts).toEqual([
      expect.objectContaining({ type: "text", synthetic: true }),
      { type: "text", text: "Make it blue." },
    ]);
  });

  test("notifies once when an idle Design turn made no change", async () => {
    const source = await Bun.file(routeUrl).text();

    expect(source).toContain('toast.info("No Design change was detected.")');
    expect(source).toContain("completeWithoutChange(context.id)");
    expect(source.indexOf('toast.info("No Design change was detected.")')).toBeGreaterThan(source.indexOf("completeWithoutChange(context.id)"));
  });

  test("marks all preflighted contexts failed when prompt submission rejects", async () => {
    const second = { ...lifecycleContext, id: "design-ai-lifecycle-2" };
    const store = useDesignAiSelectionStore.getState();
    store.createContext(lifecycleContext);
    store.createContext(second);

    await expect(sessionRoute.promptDesignSelectionContexts({
      contexts: [lifecycleContext, second],
      workspaceClient: {
        readWorkspaceFile: async () => ({ content: "<h1>Original</h1>", updatedAt: 11 }),
        writeWorkspaceFile: async () => ({ updatedAt: 12 }),
      },
      prompt: async () => { throw new Error("prompt failed"); },
      designSelectionStore: useDesignAiSelectionStore,
    })).rejects.toThrow("prompt failed");

    expect(useDesignAiSelectionStore.getState().statuses).toMatchObject({
      [lifecycleContext.id]: "failed",
      [second.id]: "failed",
    });
  });

  test("marks every selected context failed when preflight cannot read the file", async () => {
    const second = { ...lifecycleContext, id: "design-ai-lifecycle-3" };
    const store = useDesignAiSelectionStore.getState();
    store.createContext(lifecycleContext);
    store.createContext(second);

    await expect(sessionRoute.promptDesignSelectionContexts({
      contexts: [lifecycleContext, second],
      workspaceClient: {
        readWorkspaceFile: async () => { throw new Error("read failed"); },
        writeWorkspaceFile: async () => ({ updatedAt: 12 }),
      },
      prompt: async () => ({ error: undefined }),
      designSelectionStore: useDesignAiSelectionStore,
    })).rejects.toThrow("read failed");

    expect(useDesignAiSelectionStore.getState().statuses).toMatchObject({
      [lifecycleContext.id]: "failed",
      [second.id]: "failed",
    });
  });

  test("threads the optional session status callback through the React runtime", async () => {
    const source = await Bun.file(runtimeUrl).text();

    expect(source).toContain("onSessionStatus?:");
    expect(source).toContain("onSessionStatus: props.onSessionStatus");
  });
});
