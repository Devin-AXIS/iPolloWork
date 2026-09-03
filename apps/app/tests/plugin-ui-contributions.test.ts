import { describe, expect, test } from "bun:test";

import type { iPolloWorkPluginPackageItem } from "../src/app/lib/ipollowork-server";
import { resolveInstalledPluginContributions } from "../src/react-app/plugin-ui/plugin-ui-contributions";
import {
  parsePluginPackageManifest,
  parsePluginUiInspectorContext,
} from "@ipollowork/types/plugins";

describe("plugin UI contributions", () => {
  test("parses the shared Workspace App inspector contract", () => {
    expect(parsePluginUiInspectorContext({
      schemaVersion: 1,
      title: "Image settings",
      updateTool: "set_prompt",
      submitTool: "generate_or_edit",
      submitLabel: "Generate image",
      fields: [
        { id: "prompt", label: "Instruction", control: "textarea", value: "" },
        { id: "quality", label: "Quality", control: "select", value: "auto", live: true, options: [
          { value: "auto", label: "Auto" },
          { value: "future", label: "Future", disabled: true },
        ] },
      ],
    })).toMatchObject({ title: "Image settings", fields: [{ id: "prompt" }, { id: "quality" }] });
    expect(parsePluginUiInspectorContext({
      schemaVersion: 1,
      title: "Broken",
      updateTool: "set_prompt",
      submitTool: "generate_or_edit",
      submitLabel: "Run",
      fields: [{ id: "quality", label: "Quality", control: "checkbox", value: "auto" }],
    })).toBeNull();
  });

  test("resolves enabled workspace, settings, and conversation surfaces from one package", async () => {
    const manifest = parsePluginPackageManifest(await Bun.file(new URL("../../../examples/plugin-packages/workspace-canvas/ipollowork.plugin.json", import.meta.url)).json());
    const item: iPolloWorkPluginPackageItem = {
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.package?.version ?? "1.0.0",
      enabled: true,
      disabledResourceIds: [],
      previousVersion: null,
      manifest,
      integrity: { sha256: "0".repeat(64), status: "unsigned" },
      activeEngineId: "opencode",
      engineCompatibility: [{
        engineId: "opencode",
        status: "ready",
        supportedResourceIds: manifest.resources.map((resource) => resource.id),
        unsupportedResourceIds: [],
        unsupportedRequiredResourceIds: [],
        unsupportedCapabilityIds: [],
        nativeEngineOnly: false,
      }],
    };

    const result = resolveInstalledPluginContributions([item]);

    expect(result.workspaceApps).toHaveLength(1);
    expect(result.settingsPages).toHaveLength(1);
    expect(result.conversationTemplates).toMatchObject([{ mode: "work", label: "Plan on a canvas" }]);
    expect(resolveInstalledPluginContributions([{ ...item, enabled: false }])).toEqual({
      workspaceApps: [],
      settingsPages: [],
      conversationTemplates: [],
    });
    expect(resolveInstalledPluginContributions([{ ...item, disabledResourceIds: ["canvas"] }]).workspaceApps).toHaveLength(0);
  });

  test("does not treat built-in Design and Video workspaces as plugin contributions", async () => {
    const manifest = parsePluginPackageManifest(await Bun.file(new URL("../../../examples/plugin-packages/design-agent/ipollowork.plugin.json", import.meta.url)).json());
    const legacyManifest = parsePluginPackageManifest({
      ...manifest,
      contributions: [{
        type: "session-side-panel",
        ref: "ipollowork.design.panel",
        label: "Design",
        location: "session-right-pane",
      }],
    });
    const item: iPolloWorkPluginPackageItem = {
      pluginId: legacyManifest.id,
      name: legacyManifest.name,
      version: legacyManifest.package?.version ?? "0.2.0",
      enabled: true,
      disabledResourceIds: [],
      previousVersion: null,
      manifest: legacyManifest,
      integrity: { sha256: "0".repeat(64), status: "unsigned" },
      activeEngineId: "opencode",
      engineCompatibility: [{
        engineId: "opencode",
        status: "ready",
        supportedResourceIds: legacyManifest.resources.map((resource) => resource.id),
        unsupportedResourceIds: [],
        unsupportedRequiredResourceIds: [],
        unsupportedCapabilityIds: [],
        nativeEngineOnly: false,
      }],
    };

    expect(resolveInstalledPluginContributions([item])).toEqual({
      workspaceApps: [],
      settingsPages: [],
      conversationTemplates: [],
    });
  });
});
