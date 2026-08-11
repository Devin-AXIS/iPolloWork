import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { getCloudSettingsTabs } from "../src/react-app/domains/settings/shell/settings-page";
import { parseSettingsPath } from "../src/react-app/shell/settings-route";

const settingsRouteSource = readFileSync(
  new URL("../src/react-app/shell/settings-route.tsx", import.meta.url),
  "utf8",
);

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

  test("hides Connect from persistent settings navigation", () => {
    expect(getCloudSettingsTabs(false)).toEqual(["cloud-account"]);
    expect(getCloudSettingsTabs(true)).toEqual(["cloud-account", "memory"]);
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

  test("recognizes an installed plugin detail as its own extensions route", () => {
    expect(parseSettingsPath("/workspace/workspace_1/settings/extensions/plugin/figma")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "all",
      pluginPackageId: "figma",
    });
  });

  test("returns to the task that opened settings", () => {
    expect(settingsRouteSource).toContain("workspaceSessionRoute(selectedWorkspaceId, navigationSessionId)");
  });
});
