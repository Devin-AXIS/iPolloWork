import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const queuedMessagesPanelSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/modals/queued-messages-panel.tsx"),
  "utf8",
);

describe("composer queue behavior", () => {
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

    expect(busyActions).toContain("onClick={canSend ? props.onQueue : undefined}");
    expect(busyActions).toContain('title={t("composer.queue_hint")}');
    expect(busyActions).not.toContain("onSteer");
    expect(composerSource).not.toContain("onSteer:");
  });

  test("drains queued drafts one at a time", () => {
    expect(sessionSurfaceSource).not.toContain("function mergeDrafts(");
    expect(sessionSurfaceSource).toContain("const next = queuedDrafts[0]");
    expect(sessionSurfaceSource).toContain("removeQueuedDraftFromStore(props.sessionId, 0)");
    expect(sessionSurfaceSource).toContain("await sendDraft(next, next.attachments)");
    expect(sessionSurfaceSource).toContain("prependQueuedDrafts(props.sessionId, [next])");
  });

  test("keeps queued drafts when stopping the active run", () => {
    const abortHandler = sessionSurfaceSource.slice(
      sessionSurfaceSource.indexOf("const handleAbort = useCallback"),
      sessionSurfaceSource.indexOf("const handleDismissError = useCallback"),
    );

    expect(abortHandler).not.toContain("clearQueuedDrafts");
    expect(abortHandler).toContain("await abortSessionSafe(");
    expect(sessionSurfaceSource).toContain('if (chatStreaming || liveStatus.type !== "idle") return;');
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

    expect(successfulSend).toContain("if (!dispatched) {");
    expect(successfulSend.replaceAll("\r\n", "\n")).not.toContain("\n      setSending(false);\n");
    expect(sender.slice(sender.indexOf("} catch (nextError)"))).toContain("setSending(false)");
    expect(sessionSurfaceSource).toContain("runActivityObservedRef.current = true");
    expect(sessionSurfaceSource).toContain("if (!runActivityObservedRef.current && !assistantOutputAfterAwaitStart) return;");
    expect(sessionSurfaceSource).not.toContain('if (liveStatus.type === "idle") {\n      setSending(false);');
  });

  test("renders the queued list in a floating panel above the composer", () => {
    expect(queuedMessagesPanelSource).toContain("absolute bottom-full left-0 right-0");
    expect(queuedMessagesPanelSource).toContain("bg-dls-surface");
  });

  test("does not expose drag reordering for queued messages", () => {
    expect(sessionSurfaceSource).not.toContain("reorderQueuedDraft");
    expect(queuedMessagesPanelSource).not.toContain("draggable");
    expect(queuedMessagesPanelSource).not.toContain("onDragStart");
    expect(queuedMessagesPanelSource).not.toContain("onDrop");
  });
});
