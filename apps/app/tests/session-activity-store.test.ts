import { beforeEach, describe, expect, test } from "bun:test";

import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";

describe("session activity store", () => {
  beforeEach(() => {
    useSessionActivityStore.setState({
      recordsByWorkspaceId: {},
      statusesByWorkspaceId: {},
    });
  });

  test("keeps one run active across a transient idle status until the terminal event", () => {
    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", { type: "busy" });
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");
    expect(useSessionActivityStore.getState().getRunOutcome("ws_1", "ses_1")).toBe("running");
    const startedAt = useSessionActivityStore.getState().recordsByWorkspaceId.ws_1?.ses_1?.runStartedAt;
    expect(typeof startedAt).toBe("number");

    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", { type: "idle" });
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("idle");
    expect(useSessionActivityStore.getState().getRunOutcome("ws_1", "ses_1")).toBe("running");
    expect(useSessionActivityStore.getState().recordsByWorkspaceId.ws_1?.ses_1?.runStartedAt).toBe(startedAt);

    useSessionActivityStore.getState().finishRun("ws_1", "ses_1", "completed");
    expect(useSessionActivityStore.getState().getRunOutcome("ws_1", "ses_1")).toBe("completed");
    const endedAt = useSessionActivityStore.getState().recordsByWorkspaceId.ws_1?.ses_1?.runEndedAt;
    expect(typeof endedAt).toBe("number");
    useSessionActivityStore.getState().finishRun("ws_1", "ses_1", "completed");
    expect(useSessionActivityStore.getState().recordsByWorkspaceId.ws_1?.ses_1?.runEndedAt).toBe(endedAt);

    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", { type: "busy" });
    expect(useSessionActivityStore.getState().getRunOutcome("ws_1", "ses_1")).toBe("running");
    useSessionActivityStore.getState().finishRun("ws_1", "ses_1", "stopped");
    expect(useSessionActivityStore.getState().getRunOutcome("ws_1", "ses_1")).toBe("stopped");
  });

  test("keeps a terminal error visible across a trailing idle event and clears it for the next run", () => {
    const store = useSessionActivityStore.getState();
    store.setRunStatus("ws_1", "ses_1", { type: "busy" });
    store.setError("ws_1", "ses_1", "provider failed");
    store.setRunStatus("ws_1", "ses_1", { type: "idle" });

    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("error");
    expect(useSessionActivityStore.getState().getSessionError("ws_1", "ses_1")).toBe("provider failed");
    expect(useSessionActivityStore.getState().getRunOutcome("ws_1", "ses_1")).toBe("failed");

    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", { type: "busy" });
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");
    expect(useSessionActivityStore.getState().getSessionError("ws_1", "ses_1")).toBeNull();
  });

  test("uses directory activity to promote runs without settling newer live state", () => {
    const store = useSessionActivityStore.getState();
    store.seedWorkspaceSessions("ws_dsh", [{ id: "ses_dsh", dsh: { running: true } }]);
    store.seedWorkspaceSessions("ws_codex", [{ id: "ses_codex", codex: { status: "active" } }]);

    expect(useSessionActivityStore.getState().getStatus("ws_dsh", "ses_dsh")).toBe("thinking");
    expect(useSessionActivityStore.getState().getStatus("ws_codex", "ses_codex")).toBe("thinking");

    store.seedWorkspaceSessions("ws_dsh", [{ id: "ses_dsh", dsh: { running: false } }]);
    store.seedWorkspaceSessions("ws_codex", [{ id: "ses_codex", codex: { status: "notLoaded" } }]);
    expect(useSessionActivityStore.getState().getStatus("ws_dsh", "ses_dsh")).toBe("thinking");
    expect(useSessionActivityStore.getState().getStatus("ws_codex", "ses_codex")).toBe("thinking");

    store.setRunStatus("ws_dsh", "ses_dsh", { type: "idle" });
    store.setRunStatus("ws_codex", "ses_codex", { type: "idle" });
    expect(useSessionActivityStore.getState().getStatus("ws_dsh", "ses_dsh")).toBe("idle");
    expect(useSessionActivityStore.getState().getStatus("ws_codex", "ses_codex")).toBe("idle");
  });

  test("a stale busy directory row cannot reopen a completed turn", () => {
    const store = useSessionActivityStore.getState();
    store.setRunStatus("ws", "session", { type: "busy" });
    store.finishRun("ws", "session", "completed");
    const timing = useSessionActivityStore.getState().recordsByWorkspaceId.ws.session;
    store.seedWorkspaceSessions("ws", [{ id: "session", dsh: { running: true } }]);
    expect(store.getRunOutcome("ws", "session")).toBe("completed");
    expect(useSessionActivityStore.getState().recordsByWorkspaceId.ws.session.runEndedAt).toBe(timing.runEndedAt);
    store.setRunStatus("ws", "session", { type: "busy" });
    expect(store.getRunOutcome("ws", "session")).toBe("running");
  });
});
