import { beforeEach, describe, expect, test } from "bun:test";

import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";

describe("session activity store", () => {
  beforeEach(() => {
    useSessionActivityStore.setState({
      recordsByWorkspaceId: {},
      statusesByWorkspaceId: {},
    });
  });

  test("clears a session back to idle when a non-running status arrives", () => {
    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", { type: "busy" });
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");

    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", { type: "idle" });
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("idle");
  });

  test("keeps a terminal error visible across a trailing idle event and clears it for the next run", () => {
    const store = useSessionActivityStore.getState();
    store.setRunStatus("ws_1", "ses_1", { type: "busy" });
    store.setError("ws_1", "ses_1", "provider failed");
    store.setRunStatus("ws_1", "ses_1", { type: "idle" });

    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("error");
    expect(useSessionActivityStore.getState().getSessionError("ws_1", "ses_1")).toBe("provider failed");

    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", { type: "busy" });
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");
    expect(useSessionActivityStore.getState().getSessionError("ws_1", "ses_1")).toBeNull();
  });
});
