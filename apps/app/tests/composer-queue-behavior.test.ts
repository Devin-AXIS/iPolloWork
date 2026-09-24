import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveSessionRenderModel } from "../src/react-app/domains/session/sync/transition-controller";

const editorSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/editor.tsx"),
  "utf8",
);
const composerSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/composer.tsx"),
  "utf8",
);
const sessionSurfaceSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/surface/session-surface.tsx"),
  "utf8",
);
const sessionRouteSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/shell/session-route.tsx"),
  "utf8",
);
const queuedMessagesPanelSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/modals/queued-messages-panel.tsx"),
  "utf8",
);

describe("composer queue behavior", () => {
  test("plugin messages share the composer queue instead of dispatching a parallel turn", () => {
    const page = readFileSync(resolve(import.meta.dir, "../src/react-app/domains/session/chat/session-page.tsx"), "utf8");
    const sender = page.slice(page.indexOf("  const sendWorkspaceAppMessage ="), page.indexOf("  const launcherDesignPath ="));
    expect(sender).toContain("appendQueuedDraft(props.selectedSessionId,");
    expect(sender).not.toContain("sendSessionDraft(");
    expect(sender).toContain("capability:");
    expect(sender).toContain("accepted: true");
  });
  test("never lets keyboard modifiers bypass the queue", () => {
    const submitPlugin = editorSource.slice(
      editorSource.indexOf("function SubmitPlugin"),
      editorSource.indexOf("const PASTE_CHIP_LINE_THRESHOLD"),
    );

    expect(submitPlugin).toContain("void onSubmitRef.current();");
    expect(submitPlugin).not.toContain("metaKey");
    expect(submitPlugin).not.toContain("ctrlKey");
    expect(submitPlugin).not.toContain("queue:");
  });

  test("uses queue as the primary busy action", () => {
    const busyActions = composerSource.slice(
      composerSource.indexOf("{props.busy ? ("),
      composerSource.indexOf("{props.busy ? (") + 4000,
    );

    expect(busyActions).toContain("{canSend ? (");
    expect(busyActions).toContain("onPointerDown={handleActionPointerDown}");
    expect(busyActions).toContain("onClick={handleActionClick}");
    expect(busyActions).toContain("onClick={props.onStop}");
    expect(busyActions).toContain('title={t("composer.queue_hint")}');
    expect(busyActions).not.toContain("onSteer");
    expect(composerSource).not.toContain("onSteer:");
  });

  test("keeps Enter as submit while the visible session refreshes in the background", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "session-current",
      renderedSessionId: "session-current",
      hasSnapshot: true,
      isFetching: true,
      isError: false,
    })).toEqual({
      intendedSessionId: "session-current",
      renderedSessionId: "session-current",
      transitionState: "idle",
      renderSource: "live",
    });

    const submitPlugin = editorSource.slice(
      editorSource.indexOf("function SubmitPlugin"),
      editorSource.indexOf("const PASTE_CHIP_LINE_THRESHOLD"),
    );
    expect(submitPlugin).toContain("if (props.disabled) {");
    expect(submitPlugin).toContain("event?.preventDefault();");
    expect(submitPlugin.indexOf("event?.shiftKey")).toBeLessThan(submitPlugin.indexOf("if (props.disabled)"));
  });

  test("keeps the empty idle submit actionable and explains why it cannot send", () => {
    const idleAction = composerSource.slice(
      composerSource.indexOf('<Tooltip open={emptySubmitHintOpen}>'),
      composerSource.indexOf('<Tooltip open={emptySubmitHintOpen}>') + 3000,
    );

    expect(idleAction).toContain("onPointerDown={handleActionPointerDown}");
    expect(idleAction).toContain("onClick={handleActionClick}");
    expect(composerSource).toContain("if (!canSend) {");
    expect(composerSource).toContain("showEmptySubmitHint();");
    expect(idleAction).toContain("disabled={props.disabled}");
    expect(idleAction).not.toContain("disabled={props.disabled || !canSend}");
    expect(idleAction).toContain('"bg-gray-9 text-white hover:bg-gray-10"');
    expect(idleAction).toContain('t("composer.empty_submit_hint")');
  });

  test("keeps drafting available while model readiness blocks submission", () => {
    expect(composerSource).toContain("inputDisabled?: boolean");
    expect(composerSource).toContain("const editorDisabled = props.inputDisabled ?? props.disabled;");
    expect(composerSource).toContain("disabled={editorDisabled}");
    expect(composerSource).toContain("submitDisabled={props.disabled}");
    expect(editorSource).toContain("submitDisabled?: boolean;");
    expect(editorSource).toContain("disabled={props.submitDisabled ?? props.disabled}");
    expect(sessionSurfaceSource).toContain("inputDisabled={false}");
    expect(sessionSurfaceSource).toContain('disabled={model.transitionState !== "idle" || Boolean(props.modelUnavailable)}');
  });

  test("treats a turn error as recoverable instead of failing the session route", () => {
    const renderModel = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf("const model = deriveSessionRenderModel"),
      sessionSurfaceSource.indexOf("const buildDraft", sessionSurfaceSource.indexOf("const model = deriveSessionRenderModel")),
    );
    const errorBoundary = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf('if (sessionActivityStatus !== "error") return;'),
      sessionSurfaceSource.indexOf('if (sessionActivityStatus !== "error") return;') + 900,
    );

    expect(renderModel).toContain("isError: snapshotQuery.isError");
    expect(renderModel).not.toContain("Boolean(error)");
    expect(errorBoundary).toContain("pendingVideoDeliveryRef.current = null");
    expect(errorBoundary).toContain("pendingArtifactCompletionRef.current = null");
    expect(errorBoundary).toContain("setAwaitingAssistantBaseline(null)");
    expect(errorBoundary).toContain("setSending(false)");
  });

  test("drains queued drafts one at a time", () => {
    expect(sessionSurfaceSource).not.toContain("function mergeDrafts(");
    expect(sessionSurfaceSource).toContain("const next = queuedDrafts[0]");
    expect(sessionSurfaceSource).toContain("removeQueuedDraftFromStore(props.sessionId, 0)");
    expect(sessionSurfaceSource).toContain("await sendDraft(next, next.attachments)");
    expect(sessionSurfaceSource).toContain("prependQueuedDrafts(props.sessionId, [next])");
  });

  test("keeps follow-ups queued until the active turn passes artifact validation", () => {
    const idleCompletion = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf("const timeout = window.setTimeout(() => {", sessionSurfaceSource.indexOf("const handleDismissError")),
      sessionSurfaceSource.indexOf("const dispatchNextQueuedDraft = useCallback"),
    );
    const queueDrainStart = sessionSurfaceSource.indexOf("const dispatchNextQueuedDraft = useCallback");
    const queueDrain = sessionSurfaceSource.slice(
      queueDrainStart,
      sessionSurfaceSource.indexOf("const handleAttachFiles", queueDrainStart),
    );

    expect(idleCompletion.indexOf("pendingArtifactCompletionRef.current")).toBeLessThan(
      idleCompletion.indexOf("assistantOutputAfterAwaitStart && !latestAssistantCompleted"),
    );
    expect(idleCompletion).toContain("void validatePendingArtifactCompletion()");
    expect(idleCompletion).toContain("void validatePendingVideoDelivery()");
    expect(queueDrain).toContain("if (pendingArtifactCompletionRef.current || pendingVideoDeliveryRef.current) return;");
    expect(queueDrain.indexOf("pendingArtifactCompletionRef.current")).toBeLessThan(
      queueDrain.indexOf("removeQueuedDraftFromStore(props.sessionId, 0)"),
    );
  });

  test("keeps queued drafts when stopping the active run", () => {
    const abortHandler = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf("const handleAbort = useCallback"),
      sessionSurfaceSource.indexOf("const handleDismissError = useCallback"),
    );

    expect(abortHandler).not.toContain("clearQueuedDrafts");
    expect(abortHandler).not.toContain("promptDispatchInFlightRef");
    expect(abortHandler).toContain("promptDispatchAbortRef.current?.abort()");
    expect(abortHandler).toContain("await props.conversation.abort(");
    expect(abortHandler).toContain("pendingVideoDeliveryRef.current = null");
    expect(abortHandler).toContain("pendingArtifactCompletionRef.current = null");
    expect(abortHandler).toContain("settleInterruptedSessionRun(");
    expect(abortHandler).toContain("activeClientUserMessageIdRef.current");
    expect(abortHandler.indexOf("settleInterruptedSessionRun(")).toBeLessThan(
      abortHandler.indexOf("promptDispatchAbortRef.current?.abort()"),
    );
    expect(abortHandler).toContain("setStopAcknowledged(true)");
    expect(sessionSurfaceSource).toContain('if (chatStreaming || liveStatus.type !== "idle") return;');
  });

  test("cancels prompt preflight so an immediate stop cannot dispatch a later artifact run", () => {
    const sender = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf("const sendDraft = useCallback"),
      sessionSurfaceSource.indexOf("const clearComposer = useCallback"),
    );
    const routeSender = sessionRouteSource.slice(
      sessionRouteSource.indexOf("onSendDraft: async"),
      sessionRouteSource.indexOf("onDraftChange:", sessionRouteSource.indexOf("onSendDraft: async")),
    );

    expect(sender).toContain("const dispatchAbort = new AbortController()");
    expect(sender).toContain("signal: dispatchAbort.signal");
    expect(routeSender).toContain("if (await stopDispatchIfRequested()) return false;");
    expect(routeSender).toContain("signal: dispatchSignal");
    expect(routeSender.indexOf("if (await stopDispatchIfRequested()) return false;")).toBeLessThan(
      routeSender.indexOf("prompt: () => conversation.sendPrompt"),
    );
  });

  test("keeps the composer busy until the active run reports idle", () => {
    const sender = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf("const sendDraft = useCallback"),
      sessionSurfaceSource.indexOf("const clearComposer = useCallback"),
    );
    const successfulSend = sender.slice(
      sender.indexOf("try {"),
      sender.indexOf("} catch (nextError)"),
    );

    expect(successfulSend).toContain("if (!dispatched && !dispatchAbort.signal.aborted) {");
    expect(successfulSend.replaceAll("\r\n", "\n")).not.toContain("\n      setSending(false);\n");
    expect(sender.slice(sender.indexOf("} catch (nextError)"))).toContain("setSending(false)");
    expect(sessionSurfaceSource).toContain("runActivityObservedRef.current = true");
    expect(sessionSurfaceSource).toContain("if (!runActivityObservedRef.current && !assistantOutputAfterAwaitStart) return;");
    expect(sessionSurfaceSource).not.toContain('if (liveStatus.type === "idle") {\n      setSending(false);');
  });

  test("clears the submitted composer before waiting for dispatch", () => {
    const sendHandler = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf("const handleSend = useCallback"),
      sessionSurfaceSource.indexOf("// Queue: hold the draft locally"),
    );

    expect(sendHandler.indexOf("clearComposer();")).toBeLessThan(sendHandler.indexOf("await sendDraft("));
    expect(sendHandler).toContain("restoreComposerSessionIfEmpty(props.sessionId, submittedComposerState)");
  });

  test("renders the queued list as part of the composer surface", () => {
    expect(queuedMessagesPanelSource).toContain("border-b border-dls-border/70 bg-transparent");
    expect(queuedMessagesPanelSource).not.toContain("absolute bottom-full");
    expect(queuedMessagesPanelSource).not.toContain("shadow-");
  });

  test("offers native mid-turn guidance only when the active engine supports it", () => {
    const conversationEngineSource = readFileSync(
      resolve(import.meta.dir, "../src/react-app/domains/session/engine/conversation-engine.ts"),
      "utf8",
    );
    const codexEngineSource = readFileSync(
      resolve(import.meta.dir, "../src/react-app/domains/session/engine/codex-harness-conversation-engine.ts"),
      "utf8",
    );
    const deepSeekEngineSource = readFileSync(
      resolve(import.meta.dir, "../src/react-app/domains/session/engine/deepseek-harness-conversation-engine.ts"),
      "utf8",
    );
    const openCodeEngineSource = readFileSync(
      resolve(import.meta.dir, "../src/react-app/domains/session/engine/opencode-conversation-engine.ts"),
      "utf8",
    );
    const codexRouteSource = readFileSync(
      resolve(import.meta.dir, "../../server/src/routes/codex-harness.ts"),
      "utf8",
    );

    expect(conversationEngineSource).toContain("steerPrompt?(input: ConversationPromptInput)");
    expect(codexEngineSource).toContain('client.call<{ turnId: string }>("turn/steer"');
    expect(codexEngineSource).toContain("expectedTurnId: turnId");
    expect(deepSeekEngineSource).toContain('mode: "steer"');
    expect(openCodeEngineSource).not.toContain("steerPrompt");
    expect(codexRouteSource).toContain('"turn/steer"');
    expect(sessionSurfaceSource).toContain("onSteer={props.onSteerDraft ? steerQueuedDraft : undefined}");
    expect(queuedMessagesPanelSource).toContain('t("composer.steer_queued")');
    expect(queuedMessagesPanelSource).toContain("<Send size={14} strokeWidth={1.75}");
    expect(queuedMessagesPanelSource).toContain("text-sm font-medium text-gray-11");
  });

  test("does not expose drag reordering for queued messages", () => {
    expect(sessionSurfaceSource).not.toContain("reorderQueuedDraft");
    expect(queuedMessagesPanelSource).not.toContain("draggable");
    expect(queuedMessagesPanelSource).not.toContain("onDragStart");
    expect(queuedMessagesPanelSource).not.toContain("onDrop");
  });
});
