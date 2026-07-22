import { describe, expect, test } from "bun:test";

const legacyManifest = {
  schemaVersion: 1,
  id: "legacy-extension",
  name: "Legacy Extension",
  description: "An existing extension without package metadata.",
  source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
  resources: [],
};

const packageManifest = {
  schemaVersion: 1,
  id: "acme-research",
  name: "Acme Research",
  description: "Research with Acme's independent service.",
  source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
  package: {
    version: "1.2.3",
    publisher: { id: "acme", name: "Acme" },
    compatibility: { ipollowork: ">=0.17.0", opencode: ">=1.18.0" },
    updateId: "acme/research",
    entrypoints: { opencode: ".opencode/plugins/acme-research.ts" },
  },
  permissions: [
    { id: "network", reason: "Connect to the Acme research API." },
    { id: "workspace-read", reason: "Read selected workspace files." },
  ],
  authorization: {
    required: true,
    methods: [{
      id: "api-key",
      kind: "secret-form",
      label: "API key",
      fields: [{ id: "apiKey", label: "API key", secret: true, required: true }],
    }],
  },
  resources: [
    { type: "opencode-plugin", id: "acme-runtime", path: ".opencode/plugins/acme-research.ts", required: true },
    { type: "skill", id: "acme-search", path: ".opencode/skills/acme-search/SKILL.md", required: true },
    { type: "mcp", id: "acme-mcp", path: ".opencode/mcps/acme.json", required: false },
  ],
};

describe("plugin package manifest", () => {
  test("accepts the complete Figma example package", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const manifest = await Bun.file(new URL("../../../examples/plugin-packages/figma/ipollowork.plugin.json", import.meta.url)).json();

    const result = validatePluginPackageManifest(manifest);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    expect(result.manifest.id).toBe("figma");
    expect(result.manifest.resources.filter((resource) => resource.type === "skill")).toHaveLength(12);
    expect(result.manifest.resources.some((resource) => resource.type === "mcp" && resource.mcpServerName === "figma")).toBe(true);
  });

  test("accepts current extension manifests and additive self-contained packages", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");

    const legacy = validatePluginPackageManifest(legacyManifest);
    const packaged = validatePluginPackageManifest(packageManifest);

    expect(legacy.success).toBe(true);
    if (!legacy.success) throw new Error("Expected the legacy manifest to stay valid");
    expect(legacy.manifest.id).toBe(legacyManifest.id);
    expect(legacy.manifest.source.format).toBe("ipollowork-builtin");
    expect(legacy.manifest.resources).toEqual([]);
    expect(legacy.manifest.package).toBeUndefined();
    expect(packaged.success).toBe(true);
    if (!packaged.success) throw new Error("Expected the package manifest to be valid");
    expect(packaged.manifest.package?.version).toBe("1.2.3");
    expect(packaged.manifest.resources.map((resource) => resource.type)).toEqual(["opencode-plugin", "skill", "mcp"]);
    expect(packaged.manifest.authorization?.methods.map((method) => method.kind)).toEqual(["secret-form"]);
  });

  test("returns actionable issue paths for unsafe or malformed package metadata", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const invalid = {
      ...packageManifest,
      package: {
        ...packageManifest.package,
        version: "latest",
        compatibility: { ipollowork: "eventually" },
        entrypoints: { opencode: "../outside.ts" },
      },
      permissions: [{ id: "read-everything", reason: "Too broad" }],
      authorization: {
        required: true,
        methods: [{
          id: "api-key",
          kind: "secret-form",
          label: "API key",
          envKey: "ACME_API_KEY",
          fields: [],
        }],
      },
      resources: [
        packageManifest.resources[0],
        { ...packageManifest.resources[0], path: ".opencode/plugins/duplicate.ts" },
      ],
    };

    const result = validatePluginPackageManifest(invalid);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected validation issues");
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "package.version",
      "package.compatibility.ipollowork",
      "package.entrypoints.opencode",
      "permissions.0.id",
      "authorization.methods.0.envKey",
      "authorization.methods.0.fields",
      "resources.1.id",
    ]));
  });

  test("accepts a minimal package with no authorization", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const minimal = {
      ...legacyManifest,
      id: "minimal-plugin",
      source: { format: "opencode-plugin", origin: "local", trusted: false },
      package: {
        version: "0.1.0",
        updateId: "local/minimal-plugin",
        entrypoints: { opencode: ".opencode/plugins/minimal.ts" },
      },
      resources: [{ type: "opencode-plugin", id: "minimal-runtime", path: ".opencode/plugins/minimal.ts", required: true }],
    };

    const result = validatePluginPackageManifest(minimal);

    expect(result.success).toBe(true);
  });

  test("accepts a declarative package made only of MCP and skill resources", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const declarative = {
      ...legacyManifest,
      id: "figma",
      source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
      package: {
        version: "2.0.13",
        updateId: "figma/official-workflows",
        entrypoints: {},
      },
      resources: [
        { type: "mcp", id: "figma-mcp", path: ".opencode/mcps/figma.json", required: true },
        {
          type: "skill",
          id: "figma-design-to-code",
          path: ".opencode/skills/figma-design-to-code/SKILL.md",
          requires: ["resource:figma-mcp"],
          required: true,
        },
      ],
    };

    expect(validatePluginPackageManifest(declarative).success).toBe(true);
  });

  test("rejects package identities reserved by built-in extension actions", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");

    const result = validatePluginPackageManifest({ ...packageManifest, id: "storage" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected the built-in ID to be reserved");
    expect(result.issues).toContainEqual({ path: "id", message: "is reserved by a built-in extension" });
  });

  test("validates declared relationships between skills, services, actions, and authorization", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const related = {
      ...packageManifest,
      package: {
        ...packageManifest.package,
        entrypoints: { service: "service/research.ts" },
      },
      resources: [
        {
          type: "skill",
          id: "research-workflow",
          path: "skills/research/SKILL.md",
          requires: ["service:research-service", "authorization:api-key"],
          provides: ["workflow:research"],
        },
        {
          type: "local-service",
          id: "research-service",
          path: "service/research.ts",
          requires: ["authorization:api-key"],
          provides: ["action:search"],
          actions: [{ id: "search", title: "Search", description: "Search research." }],
        },
      ],
    };

    expect(validatePluginPackageManifest(related).success).toBe(true);
    const invalid = validatePluginPackageManifest({
      ...related,
      resources: [
        related.resources[0],
        { ...related.resources[1], requires: ["authorization:missing"], provides: ["action:missing"] },
      ],
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error("Expected invalid dependency diagnostics");
    expect(invalid.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "resources.1.requires.0",
      "resources.1.provides.0",
    ]));
  });
});
