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
});
