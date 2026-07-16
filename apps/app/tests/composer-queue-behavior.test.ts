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

describe("composer queue behavior", () => {
  test("queues plain Enter and reserves Cmd/Ctrl+Enter for immediate send", () => {
    expect(editorSource).toContain(
      "queue: !(event?.metaKey === true || event?.ctrlKey === true)",
    );
  });

  test("uses queue as the primary busy action", () => {
    const busyActions = composerSource.slice(
      composerSource.indexOf("{props.busy ? ("),
      composerSource.indexOf("{props.busy ? (") + 4000,
    );

    expect(busyActions).toContain("onClick={canSend ? props.onQueue : undefined}");
    expect(busyActions).toContain('title={t("composer.queue_hint")}');
    expect(busyActions).toContain("onClick={() => void props.onSteer()}");
  });

  test("drains queued drafts one at a time", () => {
    expect(sessionSurfaceSource).not.toContain("function mergeDrafts(");
    expect(sessionSurfaceSource).toContain("const next = queuedDrafts[0]");
    expect(sessionSurfaceSource).toContain("removeQueuedDraftFromStore(props.sessionId, 0)");
    expect(sessionSurfaceSource).toContain("await sendDraft(next, next.attachments)");
    expect(sessionSurfaceSource).toContain("prependQueuedDrafts(props.sessionId, [next])");
  });
});
