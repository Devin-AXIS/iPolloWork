import { describe, expect, test } from "bun:test";

import type { iPolloWorkPluginPackageItem } from "../src/app/lib/ipollowork-server";
import { resolveInstalledPluginContributions } from "../src/react-app/plugin-ui/plugin-ui-contributions";
import { parsePluginPackageManifest } from "@ipollowork/types/plugins";

describe("plugin UI contributions", () => {
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
      nativeWorkspaces: [],
    });
    expect(resolveInstalledPluginContributions([{ ...item, disabledResourceIds: ["canvas"] }]).workspaceApps).toHaveLength(0);
  });

  test("activates trusted native workspaces only through installed packages", async () => {
    const manifest = parsePluginPackageManifest(await Bun.file(new URL("../../../examples/plugin-packages/design-agent/ipollowork.plugin.json", import.meta.url)).json());
    const item: iPolloWorkPluginPackageItem = {
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.package?.version ?? "0.2.0",
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

    expect(resolveInstalledPluginContributions([item]).nativeWorkspaces).toMatchObject([{
      pluginId: "design-agent",
      kind: "design",
    }]);
    expect(resolveInstalledPluginContributions([{
      ...item,
      manifest: { ...manifest, source: { ...manifest.source, origin: "local", trusted: false } },
    }]).nativeWorkspaces).toEqual([]);
    expect(resolveInstalledPluginContributions([{
      ...item,
      engineCompatibility: [{ ...item.engineCompatibility[0]!, status: "unsupported" }],
    }]).nativeWorkspaces).toEqual([]);
  });
});
