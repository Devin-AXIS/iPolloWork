import { describe, expect, test } from "bun:test";

import type { iPolloWorkExtensionManifest } from "../src/app/extensions";
import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
} from "../src/app/lib/ipollowork-server";
import { isPluginPackageReady } from "../src/app/lib/plugin-package-readiness";

function pluginPackage(options: {
  enabled?: boolean;
  authorization?: iPolloWorkExtensionManifest["authorization"];
  resources?: iPolloWorkExtensionManifest["resources"];
} = {}): iPolloWorkPluginPackageItem {
  return {
    pluginId: "test-extension",
    name: "Test Extension",
    version: "1.0.0",
    enabled: options.enabled ?? true,
    disabledResourceIds: [],
    previousVersion: null,
    manifest: {
      schemaVersion: 2,
      id: "test-extension",
      name: "Test Extension",
      description: "Test extension",
      source: { format: "ipollowork-extension-manifest", trusted: false, origin: "workspace" },
      resources: options.resources ?? [],
      authorization: options.authorization,
    },
    integrity: { sha256: "test", status: "unsigned" },
    activeEngineId: "opencode",
    engineCompatibility: [{
      engineId: "opencode",
      status: "ready",
      supportedResourceIds: (options.resources ?? []).map((resource) => resource.id),
      unsupportedResourceIds: [],
      unsupportedRequiredResourceIds: [],
      unsupportedCapabilityIds: [],
      nativeEngineOnly: false,
    }],
  };
}

function authorizationState(ready: boolean): iPolloWorkPluginAuthorizationState {
  return {
    required: true,
    ready,
    requiredMethodIds: ["api-key"],
    methods: [],
    connections: [],
    flows: [],
  };
}

const apiKeyAuthorization: NonNullable<iPolloWorkExtensionManifest["authorization"]> = {
  required: true,
  methods: [{
    id: "api-key",
    connectionId: "api-key",
    kind: "secret-form",
    label: "API key",
    fields: [{ id: "api-key", label: "API key", secret: true, required: true }],
  }],
};

describe("plugin package readiness", () => {
  test("shows enabled extensions that do not require authorization", () => {
    expect(isPluginPackageReady(pluginPackage(), undefined, {})).toBe(true);
    expect(isPluginPackageReady(pluginPackage({ enabled: false }), undefined, {})).toBe(false);
  });

  test("keeps older server plugin payloads usable before compatibility metadata is available", () => {
    const item = pluginPackage();
    delete item.activeEngineId;
    delete item.engineCompatibility;

    expect(isPluginPackageReady(item, undefined, {})).toBe(true);
  });

  test("hides packages unsupported by the active engine", () => {
    const item = pluginPackage();
    item.engineCompatibility[0]!.status = "unsupported";
    expect(isPluginPackageReady(item, undefined, {})).toBe(false);
  });

  test("requires declared plugin authorization to be ready", () => {
    const item = pluginPackage({ authorization: apiKeyAuthorization });

    expect(isPluginPackageReady(item, authorizationState(false), {})).toBe(false);
    expect(isPluginPackageReady(item, authorizationState(true), {})).toBe(true);
  });

  test("requires OAuth MCP resources to be connected", () => {
    const item = pluginPackage({
      resources: [{ type: "mcp", id: "service-mcp", mcpServerName: "service", oauth: true }],
    });

    expect(isPluginPackageReady(item, undefined, {})).toBe(false);
    expect(isPluginPackageReady(item, undefined, { service: { status: "connected" } })).toBe(true);
  });
});
