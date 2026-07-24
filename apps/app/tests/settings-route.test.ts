import { describe, expect, test } from "bun:test";

import { parseSettingsPath } from "../src/react-app/shell/settings-route";

describe("settings route parsing", () => {
  test("redirects the settings root to preferences while keeping the overview route available", () => {
    expect(parseSettingsPath("/settings")).toEqual({ tab: "preferences", redirectPath: "preferences" });
    expect(parseSettingsPath("/settings/general")).toEqual({ tab: "general", redirectPath: null });
  });

  test("recognizes the Connect settings tab", () => {
    expect(parseSettingsPath("/settings/connect")).toEqual({ tab: "connect", redirectPath: null });
    expect(parseSettingsPath("/workspace/workspace_1/settings/connect")).toEqual({
      tab: "connect",
      redirectPath: null,
    });
  });

  test("recognizes the Authorization Center settings tab", () => {
    expect(parseSettingsPath("/settings/authorizations")).toEqual({
      tab: "authorizations",
      redirectPath: null,
    });
    expect(parseSettingsPath("/workspace/workspace_1/settings/authorizations")).toEqual({
      tab: "authorizations",
      redirectPath: null,
    });
  });
});
