import { describe, expect, test } from "bun:test";

import { bundledPluginPackageIds } from "./plugin-package-catalog.js";
import type { PluginPackageManifest } from "./plugin-package-manifest.js";

const HAN_TEXT_RE = /\p{Script=Han}/u;

function expectEnglishText(base: unknown, english: string | undefined, path: string): void {
  if (typeof base !== "string" || !HAN_TEXT_RE.test(base)) return;
  expect(english, `${path} requires an English translation`).toBeDefined();
  expect(HAN_TEXT_RE.test(english ?? ""), `${path} English translation must not contain Han text`).toBe(false);
}

function expectCompleteEnglishLocalization(manifest: PluginPackageManifest): void {
  const english = manifest.localization?.translations.en;
  expect(manifest.localization?.defaultLocale).toBe("zh");
  expect(english).toBeDefined();
  if (!english) return;

  expectEnglishText(manifest.name, english.name, "name");
  expectEnglishText(manifest.description, english.description, "description");
  expectEnglishText(manifest.category, english.category, "category");
  expectEnglishText(manifest.composer?.prompt, english.composer?.prompt, "composer.prompt");
  expectEnglishText(manifest.setup?.instructions, english.setup?.instructions, "setup.instructions");
  expectEnglishText(manifest.setup?.primaryCta, english.setup?.primaryCta, "setup.primaryCta");
  expectEnglishText(manifest.setup?.secondaryCta, english.setup?.secondaryCta, "setup.secondaryCta");

  manifest.resources.forEach((resource) => {
    const translation = english.resources?.[resource.id];
    expectEnglishText(resource.label, translation?.label, `resources.${resource.id}.label`);
    expectEnglishText(resource.description, translation?.description, `resources.${resource.id}.description`);
  });
  manifest.permissions?.forEach((permission) => {
    expectEnglishText(permission.reason, english.permissions?.[permission.id]?.reason, `permissions.${permission.id}.reason`);
  });
  manifest.authorization?.methods.forEach((method) => {
    const translation = english.authorizationMethods?.[method.id];
    expectEnglishText(method.label, translation?.label, `authorizationMethods.${method.id}.label`);
    expectEnglishText(method.description, translation?.description, `authorizationMethods.${method.id}.description`);
    if (method.kind !== "secret-form") return;
    method.fields.forEach((field) => {
      const fieldTranslation = translation?.fields?.[field.id];
      expectEnglishText(field.label, fieldTranslation?.label, `authorizationMethods.${method.id}.fields.${field.id}.label`);
      expectEnglishText(field.description, fieldTranslation?.description, `authorizationMethods.${method.id}.fields.${field.id}.description`);
      expectEnglishText(field.placeholder, fieldTranslation?.placeholder, `authorizationMethods.${method.id}.fields.${field.id}.placeholder`);
    });
  });
}

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
  test("accepts localized display metadata and rejects invalid locale references", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const localized = {
      ...packageManifest,
      localization: {
        defaultLocale: "zh",
        translations: {
          en: {
            description: "Independent Acme research workflows.",
            resources: { "acme-search": { label: "Acme Search" } },
            permissions: { network: { reason: "Connect to Acme." } },
            authorizationMethods: {
              "api-key": {
                label: "API key",
                fields: { apiKey: { label: "API key" } },
              },
            },
          },
        },
      },
    };

    expect(validatePluginPackageManifest(localized).success).toBe(true);

    const invalid = validatePluginPackageManifest({
      ...localized,
      localization: {
        defaultLocale: "english",
        translations: {
          en: {
            description: " ",
            resources: { missing: { label: "Missing" } },
            permissions: { missing: { reason: "Missing" } },
            authorizationMethods: {
              missing: { label: "Missing" },
              "api-key": { fields: { missing: { label: "Missing" } } },
            },
          },
        },
      },
    });

    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error("Expected invalid localization metadata to be rejected");
    expect(invalid.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "localization.defaultLocale",
      "localization.translations.en.description",
      "localization.translations.en.resources.missing",
      "localization.translations.en.permissions.missing",
      "localization.translations.en.authorizationMethods.missing",
      "localization.translations.en.authorizationMethods.api-key.fields.missing",
    ]));
  });

  test("ships complete English display metadata for every bundled package", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    for (const pluginId of bundledPluginPackageIds) {
      const value = await Bun.file(new URL(`../../../examples/plugin-packages/${pluginId}/ipollowork.plugin.json`, import.meta.url)).json();
      const result = validatePluginPackageManifest(value);
      expect(result.success, pluginId).toBe(true);
      if (!result.success) throw new Error(`${pluginId}: ${JSON.stringify(result.issues)}`);
      expectCompleteEnglishLocalization(result.manifest);
    }
  });

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

  test("accepts every migrated MCP service package with its managed skills", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const packages = [
      { id: "notion", skills: 4, oauth: true },
      { id: "linear", skills: 4, oauth: true },
      { id: "sentry", skills: 4, oauth: true },
      { id: "stripe", skills: 4, oauth: true },
      { id: "context7", skills: 2, oauth: false },
    ];

    for (const expected of packages) {
      const manifest = await Bun.file(new URL(`../../../examples/plugin-packages/${expected.id}/ipollowork.plugin.json`, import.meta.url)).json();
      const result = validatePluginPackageManifest(manifest);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(`${expected.id}: ${JSON.stringify(result.issues)}`);
      expect(result.manifest.id).toBe(expected.id);
      expect(result.manifest.resources.filter((resource) => resource.type === "skill")).toHaveLength(expected.skills);
      expect(result.manifest.resources.find((resource) => resource.type === "mcp")).toMatchObject({
        mcpServerName: expected.id,
        oauth: expected.oauth,
      });
    }
  });

  test("accepts the bundled GitHub service with four independently managed skills", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const manifest = await Bun.file(new URL("../../../examples/plugin-packages/github/ipollowork.plugin.json", import.meta.url)).json();

    const result = validatePluginPackageManifest(manifest);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    expect(result.manifest.id).toBe("github");
    expect(result.manifest.resources.filter((resource) => resource.type === "skill")).toHaveLength(4);
    const service = result.manifest.resources.find((resource) => resource.type === "local-service");
    expect(service?.actions).toHaveLength(11);
    expect(service?.actions?.filter((action) => action.effect === "write").map((action) => action.id)).toEqual([
      "create-pull-request",
      "post-comment",
      "resolve-review-thread",
    ]);
    expect(result.manifest.authorization?.methods.map((method) => method.id)).toEqual(["github-token"]);
  });

  test("accepts the bundled WeChat Official Account service with seven independently managed skills", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const manifest = await Bun.file(new URL("../../../examples/plugin-packages/wechat-official/ipollowork.plugin.json", import.meta.url)).json();

    const result = validatePluginPackageManifest(manifest);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    expect(result.manifest.id).toBe("wechat-official");
    expect(result.manifest.resources.filter((resource) => resource.type === "skill")).toHaveLength(7);
    const service = result.manifest.resources.find((resource) => resource.type === "local-service");
    expect(service?.actions).toHaveLength(18);
    expect(service?.actions?.find((action) => action.id === "reply-comment")).toMatchObject({ effect: "write" });
    expect(service?.actions?.find((action) => action.id === "delete-comment")).toMatchObject({ effect: "destructive" });
    expect(result.manifest.authorization?.methods).toMatchObject([{
      id: "wechat-official-account",
      kind: "secret-form",
      fields: [{ id: "appId", secret: false }, { id: "appSecret", secret: true }],
    }]);
  });

  test("accepts the official Design and Video Agent packages without owning related global skills", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const designManifest = await Bun.file(new URL("../../../examples/plugin-packages/design-agent/ipollowork.plugin.json", import.meta.url)).json();
    const videoManifest = await Bun.file(new URL("../../../examples/plugin-packages/video-agent/ipollowork.plugin.json", import.meta.url)).json();

    const design = validatePluginPackageManifest(designManifest);
    const video = validatePluginPackageManifest(videoManifest);

    expect(design.success).toBe(true);
    if (!design.success) throw new Error(JSON.stringify(design.issues));
    expect(video.success).toBe(true);
    if (!video.success) throw new Error(JSON.stringify(video.issues));
    expect(design.manifest.resources.map((resource) => resource.type)).toEqual(["skill", "skill"]);
    expect(video.manifest.resources.map((resource) => resource.type)).toEqual(["skill", "skill"]);
    expect(video.manifest.relatedSkills).toContain("hyperframes-cli");
    expect(video.manifest.relatedSkills).toContain("media-use");
    expect(video.manifest.resources.map((resource) => resource.id)).not.toContain("hyperframes-cli");
    expect(design.manifest.contributions).toBeUndefined();
    expect(video.manifest.contributions).toBeUndefined();
    expect(design.manifest.source).toMatchObject({ origin: "builtin", trusted: true });
    expect(video.manifest.source).toMatchObject({ origin: "builtin", trusted: true });
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
        version: "2.0.16",
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

  test("keeps related skills outside the package-owned lifecycle", async () => {
    const { validatePluginPackageManifest } = await import("./plugin-package-manifest.js");
    const related = validatePluginPackageManifest({
      ...packageManifest,
      relatedSkills: ["hyperframes-cli", "media-use"],
    });

    expect(related.success).toBe(true);
    if (!related.success) throw new Error(JSON.stringify(related.issues));
    expect(related.manifest.relatedSkills).toEqual(["hyperframes-cli", "media-use"]);
    expect(related.manifest.resources.map((resource) => resource.id)).not.toContain("hyperframes-cli");

    const duplicate = validatePluginPackageManifest({
      ...packageManifest,
      relatedSkills: ["acme-search", "acme-search"],
    });
    expect(duplicate.success).toBe(false);
    if (duplicate.success) throw new Error("Expected related skill diagnostics");
    expect(duplicate.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "relatedSkills.0",
      "relatedSkills.1",
    ]));
  });
});
