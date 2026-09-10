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
          { value: "api", label: "API · Not connected", action: "open-authorizations" },
        ] },
      ],
    })).toMatchObject({
      title: "Image settings",
      fields: [{ id: "prompt" }, { id: "quality", options: [
        { value: "auto" },
        { value: "future", disabled: true },
        { value: "api", action: "open-authorizations" },
      ] }],
    });
    expect(parsePluginUiInspectorContext({
      schemaVersion: 1,
      title: "Broken",
      updateTool: "set_prompt",
      submitTool: "generate_or_edit",
      submitLabel: "Run",
      fields: [{ id: "quality", label: "Quality", control: "checkbox", value: "auto" }],
    })).toBeNull();
  });

  test("image inspector controls require import and preview tools without changing existing controls", () => {
    const context = {
      schemaVersion: 1, title: "视频参数", updateTool: "set_parameters", submitTool: "generate_or_edit", submitLabel: "生成视频",
      fields: [{ id: "firstFrame", label: "首帧图片", control: "image", value: "video/session/assets/first.png",
        media: { kind: "image", importTool: "import_media", readTool: "read_media" } }],
    };
    expect(parsePluginUiInspectorContext(context)?.fields[0]).toEqual(context.fields[0]);
    const field = context.fields[0];
    expect(parsePluginUiInspectorContext({ ...context, fields: [{ ...field, media: undefined }] })).toBeNull();
    expect(parsePluginUiInspectorContext({ ...context, fields: [{ ...field, media: { ...field.media, readTool: undefined } }] })).toBeNull();
    expect(parsePluginUiInspectorContext({ ...context, fields: [{ ...field, media: { ...field.media, kind: "video" } }] })).toBeNull();
    expect(parsePluginUiInspectorContext({ ...context, fields: [{ ...field, media: { ...field.media, importTool: "../shell" } }] })).toBeNull();
    expect(parsePluginUiInspectorContext({ ...context, fields: [{ ...field, control: "textarea", media: { kind: "video", importTool: "import_media" } }] })).not.toBeNull();
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

  test("discovers installed UI resources without explicit contributions and respects placement and availability", async () => {
    const canvas = await Bun.file(new URL("../../../examples/plugin-packages/workspace-canvas/ipollowork.plugin.json", import.meta.url)).json();
    const manifest = parsePluginPackageManifest({ ...canvas, id: "operations-console", name: "运营工作台", contributions: [],
      resources: canvas.resources.map(resource => ({ ...resource, id: "workbench", label: "运营工作台", path: "ui/workbench.html" })),
    });
    const item: iPolloWorkPluginPackageItem = {
      pluginId: manifest.id, name: manifest.name, version: "0.2.0", enabled: true,
      disabledResourceIds: [], previousVersion: null, manifest,
      integrity: { sha256: "0".repeat(64), status: "unsigned" },
    };
    const surfaces = resolveInstalledPluginContributions([item]).workspaceApps;
    expect(surfaces).toMatchObject([{
      id: "operations-console:workspace-app:workbench",
      pluginId: "operations-console", label: "运营工作台",
      resource: { type: "ui", id: "workbench", path: "ui/workbench.html" },
    }]);
    expect(resolveInstalledPluginContributions([]).workspaceApps).toEqual([]);
    expect(resolveInstalledPluginContributions([{ ...item, enabled: false }]).workspaceApps).toEqual([]);
    expect(resolveInstalledPluginContributions([{ ...item, disabledResourceIds: ["workbench"] }]).workspaceApps).toEqual([]);
    expect(resolveInstalledPluginContributions([{ ...item, manifest: {
      ...manifest, resources: manifest.resources.filter((entry) => entry.type !== "ui"),
    } }]).workspaceApps).toEqual([]);
    const explicitlyPlaced = resolveInstalledPluginContributions([{ ...item, manifest: {
      ...manifest, contributions: [{ type: "workspace-app", ref: "workbench", label: "运营工作台" }],
    } }]).workspaceApps;
    expect(explicitlyPlaced).toHaveLength(1);
    expect(explicitlyPlaced[0]).toMatchObject({ id: surfaces[0].id, label: "运营工作台" });
    const settingsOnly = resolveInstalledPluginContributions([{ ...item, manifest: {
      ...manifest, contributions: [{ type: "settings-page", ref: "workbench" }],
    } }]);
    expect(settingsOnly.workspaceApps).toEqual([]);
    expect(settingsOnly.settingsPages).toHaveLength(1);
    expect(resolveInstalledPluginContributions([{ ...item, activeEngineId: "opencode", engineCompatibility: [{
      engineId: "opencode", status: "partial", supportedResourceIds: ["operations-worker"],
      unsupportedResourceIds: ["workbench"], unsupportedRequiredResourceIds: [],
      unsupportedCapabilityIds: [], nativeEngineOnly: false,
    }] }]).workspaceApps).toEqual([]);
  });

  test("discovers service workbenches without a UI resource and never bypasses disabled UI", async () => {
    const canvas = parsePluginPackageManifest(await Bun.file(new URL("../../../examples/plugin-packages/workspace-canvas/ipollowork.plugin.json", import.meta.url)).json());
    const manifest = parsePluginPackageManifest({
      ...canvas, id: "labelu-data-annotation", name: "数据标注实训云", contributions: [],
      resources: [{ type: "local-service", id: "annotation-service", path: "service/dist/data-annotation.mjs",
        actions: [{ id: "open-workbench", title: "打开工作台", description: "启动工作台并返回地址", effect: "read", inputSchema: { type: "object", properties: {} } }] }],
    });
    const item: iPolloWorkPluginPackageItem = {
      pluginId: manifest.id, name: manifest.name, version: "0.3.0", enabled: true,
      disabledResourceIds: [], previousVersion: null, manifest,
      integrity: { sha256: "0".repeat(64), status: "verified" },
    };
    expect(resolveInstalledPluginContributions([item]).workspaceApps).toMatchObject([{
      pluginId: manifest.id, label: "数据标注实训云", action: "open-workbench",
      resource: { type: "local-service", id: "annotation-service" },
    }]);
    expect(resolveInstalledPluginContributions([{ ...item, enabled: false }]).workspaceApps).toEqual([]);
    expect(resolveInstalledPluginContributions([{ ...item, disabledResourceIds: ["annotation-service"] }]).workspaceApps).toEqual([]);
    expect(resolveInstalledPluginContributions([{ ...item, manifest: { ...manifest,
      resources: manifest.resources.map(resource => ({ ...resource, actions: [] })),
    } }]).workspaceApps).toEqual([]);
    const withUi = { ...item, manifest: { ...manifest, resources: [...manifest.resources, ...canvas.resources] } };
    expect(resolveInstalledPluginContributions([withUi]).workspaceApps).toHaveLength(1);
    expect(resolveInstalledPluginContributions([withUi]).workspaceApps[0].resource.type).toBe("ui");
    expect(resolveInstalledPluginContributions([{ ...withUi, disabledResourceIds: ["canvas"] }]).workspaceApps).toEqual([]);
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
