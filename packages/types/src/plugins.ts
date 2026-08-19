import { z } from "zod";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMPATIBILITY_RE = /^(?:\*|(?:\^|~|>=|<=|>|<)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(?:\|\||-)\s+(?:\^|~|>=|<=|>|<)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)?$/;
const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const ID_RE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const SIMPLE_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const FIELD_ID_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELATION_RE = /^(?:action|authorization|resource|service|workflow):[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const UI_URI_RE = /^ui:\/\/[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const CSP_SOURCE_RE = /^(?:https:\/\/(?:\*\.)?[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)$/;
const RESERVED_EXTENSION_IDS = new Set(["google-workspace", "media-center", "openai-image-generation", "storage"]);
export const PLUGIN_UI_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
export const PLUGIN_UI_HOST_CONTEXT_KEY = "ai.ipollo/workspace";
export const PLUGIN_INSTALL_PACKAGE_EXTENSION = ".ipollowork-plugin";
export const PLUGIN_SOURCE_ARCHIVE_EXTENSION = ".zip";
export const pluginPackageArchiveFormatSchema = z.enum(["install", "source"]);
export type PluginPackageArchiveFormat = z.infer<typeof pluginPackageArchiveFormatSchema>;
export const pluginWorkshopExportFormatSchema = pluginPackageArchiveFormatSchema;
export type PluginWorkshopExportFormat = PluginPackageArchiveFormat;

export function pluginPackageArchiveExtension(format: PluginPackageArchiveFormat): string {
  return format === "install" ? PLUGIN_INSTALL_PACKAGE_EXTENSION : PLUGIN_SOURCE_ARCHIVE_EXTENSION;
}
const PORTABLE_RESOURCE_DIRECTORIES: Record<string, string> = {
  skill: "skills/",
  agent: "agents/",
  command: "commands/",
  mcp: "mcp/",
  "local-service": "service/",
  ui: "ui/",
};

const sourceFormatSchema = z.enum([
  "ipollowork-builtin",
  "ipollowork-extension-manifest",
  "claude-plugin",
  "opencode-plugin",
  "mcp-directory",
  "manual",
]);

const resourceTypeSchema = z.enum([
  "skill",
  "agent",
  "command",
  "tool",
  "mcp",
  "provider",
  "hook",
  "context",
  "secret",
  "file",
  "local-service",
  "native-binary",
  "ui",
]);

const permissionIdSchema = z.enum([
  "network",
  "workspace-read",
  "workspace-write",
  "process",
  "clipboard",
  "notifications",
  "camera",
  "microphone",
  "geolocation",
]);

const reloadReasonSchema = z.enum(["plugins", "skills", "mcp", "config", "agents", "commands"]);
const contributionTypeSchema = z.enum([
  "settings-panel",
  "setup-instructions",
  "composer-prompt",
  "session-side-panel",
  "session-rail-item",
  "control-actions",
  "server-route",
  "native-capability",
  "test-action",
  "workspace-app",
  "settings-page",
  "conversation-template",
]);
const enablementConditionTypeSchema = z.enum([
  "mcp-connected",
  "plugin-loaded",
  "provider-connected",
  "env-set",
  "permission-granted",
  "toggle-enabled",
]);

function safeRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("\\")) return false;
  const normalized = value.replaceAll("\\", "/");
  return !normalized.split("/").some((part) => part === "" || part === "." || part === "..");
}

function secureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

const relativePathSchema = z.string().refine(safeRelativePath, "must be a safe relative path");
const secureUrlSchema = z.string().refine(secureUrl, "must use HTTPS unless it targets localhost");

const serviceActionSchema = z.object({
  id: z.string().regex(SIMPLE_ID_RE),
  title: z.string().min(1),
  description: z.string().min(1),
  effect: z.enum(["read", "write", "destructive"]).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
}).strict();

const relationSchema = z.string().regex(RELATION_RE, "must use kind:id syntax");

const uiResourceMetadataSchema = z.object({
  uri: z.string().regex(UI_URI_RE, "must use a ui:// URI"),
  mimeType: z.literal(PLUGIN_UI_RESOURCE_MIME_TYPE),
  csp: z.object({
    connectDomains: z.array(z.string().regex(CSP_SOURCE_RE)).optional(),
    resourceDomains: z.array(z.string().regex(CSP_SOURCE_RE)).optional(),
    frameDomains: z.array(z.string().regex(CSP_SOURCE_RE)).optional(),
    baseUriDomains: z.array(z.string().regex(CSP_SOURCE_RE)).optional(),
  }).strict().optional(),
  permissions: z.object({
    camera: z.object({}).strict().optional(),
    microphone: z.object({}).strict().optional(),
    geolocation: z.object({}).strict().optional(),
    clipboardWrite: z.object({}).strict().optional(),
  }).strict().optional(),
  prefersBorder: z.boolean().optional(),
}).strict();

const resourceSchema = z.object({
  type: resourceTypeSchema,
  id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  path: relativePathSchema.optional(),
  command: z.array(z.string()).optional(),
  envKey: z.string().optional(),
  packageName: z.string().optional(),
  providerId: z.string().optional(),
  mcpServerName: z.string().optional(),
  oauth: z.boolean().optional(),
  localCommandRef: z.enum(["ipollowork.computerUseMcp", "ipollowork.uiMcp"]).optional(),
  actions: z.array(serviceActionSchema).optional(),
  environment: z.array(z.string().regex(ENV_KEY_RE)).optional(),
  requires: z.array(relationSchema).optional(),
  provides: z.array(relationSchema).optional(),
  required: z.boolean().optional(),
  ui: uiResourceMetadataSchema.optional(),
}).strict();

const secretFieldSchema = z.object({
  id: z.string().regex(FIELD_ID_RE),
  label: z.string().min(1),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  secret: z.boolean().default(true),
  required: z.boolean().default(true),
}).strict();

const secretFormSchema = z.object({
  id: z.string().regex(SIMPLE_ID_RE),
  connectionId: z.string().regex(ID_RE),
  kind: z.literal("secret-form"),
  label: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(secretFieldSchema).min(1),
}).strict();

const oauthPkceSchema = z.object({
  id: z.string().regex(SIMPLE_ID_RE),
  connectionId: z.string().regex(ID_RE),
  kind: z.literal("oauth-pkce"),
  label: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().min(1),
  authorizationUrl: secureUrlSchema,
  tokenUrl: secureUrlSchema,
  scopes: z.array(z.string().min(1)).default([]),
  audience: z.string().optional(),
}).strict();

const deviceCodeSchema = z.object({
  id: z.string().regex(SIMPLE_ID_RE),
  connectionId: z.string().regex(ID_RE),
  kind: z.literal("device-code"),
  label: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().min(1),
  deviceAuthorizationUrl: secureUrlSchema,
  tokenUrl: secureUrlSchema,
  scopes: z.array(z.string().min(1)).default([]),
  qr: z.boolean().optional(),
}).strict();

const hostedBrowserSchema = z.object({
  id: z.string().regex(SIMPLE_ID_RE),
  connectionId: z.string().regex(ID_RE),
  kind: z.literal("hosted-browser"),
  label: z.string().min(1),
  description: z.string().optional(),
  startUrl: secureUrlSchema,
  callbackOrigin: secureUrlSchema,
  exchangeUrl: secureUrlSchema,
  refreshUrl: secureUrlSchema.optional(),
}).strict().superRefine((value, context) => {
  if (new URL(value.startUrl).origin !== new URL(value.callbackOrigin).origin) {
    context.addIssue({ code: "custom", path: ["callbackOrigin"], message: "must match the hosted authorization origin" });
  }
  if (new URL(value.exchangeUrl).origin !== new URL(value.callbackOrigin).origin) {
    context.addIssue({ code: "custom", path: ["exchangeUrl"], message: "must match the hosted authorization origin" });
  }
  if (value.refreshUrl && new URL(value.refreshUrl).origin !== new URL(value.callbackOrigin).origin) {
    context.addIssue({ code: "custom", path: ["refreshUrl"], message: "must match the hosted authorization origin" });
  }
});

export const pluginAuthorizationMethodSchema = z.discriminatedUnion("kind", [
  secretFormSchema,
  oauthPkceSchema,
  deviceCodeSchema,
  hostedBrowserSchema,
]);

const packageSchema = z.object({
  version: z.string().regex(SEMVER_RE, "must be a semantic version"),
  publisher: z.object({
    id: z.string().regex(SIMPLE_ID_RE),
    name: z.string().min(1),
  }).strict().optional(),
  compatibility: z.object({
    ipollowork: z.string().regex(COMPATIBILITY_RE, "must be a supported semantic-version range").optional(),
  }).strict().optional(),
  engines: z.array(z.string().regex(SIMPLE_ID_RE)).min(1).optional(),
  updateId: z.string().regex(ID_RE),
  checksum: z.object({
    algorithm: z.literal("sha256"),
    value: z.string().regex(/^[a-f0-9]{64}$/i),
  }).strict().optional(),
  signature: z.object({
    algorithm: z.literal("ed25519"),
    keyId: z.string().regex(SIMPLE_ID_RE),
    value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, "must be a base64 Ed25519 signature"),
  }).strict().optional(),
}).strict();

const contributionSchema = z.object({
  type: contributionTypeSchema,
  ref: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  location: z.enum(["settings-detail", "composer", "session-right-pane", "session-rail", "server", "native"]).optional(),
  action: z.string().regex(SIMPLE_ID_RE).optional(),
  mode: z.enum(["work", "code", "design", "video"]).optional(),
}).strict();

const setupSchema = z.object({
  instructions: z.string().optional(),
  primaryCta: z.string().optional(),
  secondaryCta: z.string().optional(),
  requiredEnv: z.array(z.string()).optional(),
  testActionRef: z.string().optional(),
}).strict();

const lifecycleSchema = z.object({
  reload: z.array(reloadReasonSchema).optional(),
  detection: z.array(z.string()).optional(),
}).strict();

const enablementConditionSchema = z.object({
  type: enablementConditionTypeSchema,
  ref: z.string(),
  label: z.string(),
}).strict();

const engineCapabilitySchema = z.object({
  id: z.string().regex(SIMPLE_ID_RE),
  kind: z.string().regex(SIMPLE_ID_RE),
  label: z.string().optional(),
  description: z.string().optional(),
  path: relativePathSchema.optional(),
  packageName: z.string().min(1).optional(),
  required: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
}).strict();

const engineBindingSchema = z.object({
  engine: z.string().regex(SIMPLE_ID_RE),
  compatibility: z.string().regex(COMPATIBILITY_RE, "must be a supported semantic-version range").optional(),
  capabilities: z.array(engineCapabilitySchema).default([]),
}).strict();

const localizedTextSchema = z.string().trim().min(1);

const extensionTranslationSchema = z.object({
  name: localizedTextSchema.optional(),
  description: localizedTextSchema.optional(),
  category: localizedTextSchema.optional(),
  composer: z.object({ prompt: localizedTextSchema.optional() }).strict().optional(),
  setup: z.object({
    instructions: localizedTextSchema.optional(),
    primaryCta: localizedTextSchema.optional(),
    secondaryCta: localizedTextSchema.optional(),
  }).strict().optional(),
  resources: z.record(z.string().min(1), z.object({
    label: localizedTextSchema.optional(),
    description: localizedTextSchema.optional(),
  }).strict()).optional(),
  permissions: z.record(z.string().min(1), z.object({
    reason: localizedTextSchema.optional(),
  }).strict()).optional(),
  authorizationMethods: z.record(z.string().min(1), z.object({
    label: localizedTextSchema.optional(),
    description: localizedTextSchema.optional(),
    fields: z.record(z.string().min(1), z.object({
      label: localizedTextSchema.optional(),
      description: localizedTextSchema.optional(),
      placeholder: localizedTextSchema.optional(),
    }).strict()).optional(),
  }).strict()).optional(),
}).strict();

const localizationSchema = z.object({
  defaultLocale: z.string().regex(LOCALE_RE, "must be a valid locale tag"),
  translations: z.record(
    z.string().regex(LOCALE_RE, "must be a valid locale tag"),
    extensionTranslationSchema,
  ).refine((translations) => Object.keys(translations).length > 0, "must contain at least one translation"),
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().regex(SIMPLE_ID_RE),
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1).optional(),
  preview: z.boolean().optional(),
  source: z.object({
    format: sourceFormatSchema,
    trusted: z.boolean(),
    origin: z.enum(["builtin", "den", "workspace", "local"]).optional(),
    reference: z.string().optional(),
  }).strict(),
  icon: z.object({ src: z.string().optional(), simpleIconSlug: z.string().optional() }).strict().optional(),
  composer: z.object({ prompt: z.string() }).strict().optional(),
  setup: setupSchema.optional(),
  resources: z.array(resourceSchema),
  relatedSkills: z.array(z.string().regex(SIMPLE_ID_RE)).optional(),
  contributions: z.array(contributionSchema).optional(),
  lifecycle: lifecycleSchema.optional(),
  enablement: z.array(enablementConditionSchema).optional(),
  engineBindings: z.array(engineBindingSchema).optional(),
  defaultEnabled: z.boolean().optional(),
  defaultHidden: z.boolean().optional(),
  platform: z.array(z.enum(["darwin", "linux", "windows", "web"])).optional(),
  package: packageSchema.optional(),
  localization: localizationSchema.optional(),
  permissions: z.array(z.object({
    id: permissionIdSchema,
    reason: z.string().min(1),
    optional: z.boolean().optional(),
  }).strict()).optional(),
  authorization: z.object({
    required: z.boolean().default(false),
    methods: z.array(pluginAuthorizationMethodSchema),
  }).strict().optional(),
}).strict().superRefine((manifest, context) => {
  if (manifest.package && RESERVED_EXTENSION_IDS.has(manifest.id)) {
    context.addIssue({ code: "custom", path: ["id"], message: "is reserved by a built-in extension" });
  }

  if (manifest.package?.engines && new Set(manifest.package.engines).size !== manifest.package.engines.length) {
    context.addIssue({ code: "custom", path: ["package", "engines"], message: "engine IDs must be unique" });
  }

  const permissionIds = new Set<string>(manifest.permissions?.map((permission) => permission.id) ?? []);
  const resourceIds = new Set<string>();
  manifest.resources.forEach((resource, index) => {
    if (resourceIds.has(resource.id)) {
      context.addIssue({ code: "custom", path: ["resources", index, "id"], message: "resource ID must be unique" });
    }
    resourceIds.add(resource.id);
    const directory = PORTABLE_RESOURCE_DIRECTORIES[resource.type];
    if (resource.path && directory && !resource.path.startsWith(directory)) {
      context.addIssue({ code: "custom", path: ["resources", index, "path"], message: `must stay inside ${directory}` });
    }
    if (resource.type === "mcp" && resource.path && !resource.path.endsWith(".json")) {
      context.addIssue({ code: "custom", path: ["resources", index, "path"], message: "must be a JSON file" });
    }
    if (resource.type === "ui") {
      if (!resource.path) {
        context.addIssue({ code: "custom", path: ["resources", index, "path"], message: "is required for UI resources" });
      } else if (!resource.path.endsWith(".html")) {
        context.addIssue({ code: "custom", path: ["resources", index, "path"], message: "must be an HTML file" });
      }
      if (!resource.ui) {
        context.addIssue({ code: "custom", path: ["resources", index, "ui"], message: "is required for UI resources" });
      } else {
        const csp = resource.ui.csp;
        const requestsNetwork = [csp?.connectDomains, csp?.resourceDomains, csp?.frameDomains, csp?.baseUriDomains]
          .some((domains) => Boolean(domains?.length));
        if (requestsNetwork && !permissionIds.has("network")) {
          context.addIssue({ code: "custom", path: ["resources", index, "ui", "csp"], message: "requires the network package permission" });
        }
        const permissionMap = {
          camera: "camera",
          microphone: "microphone",
          geolocation: "geolocation",
          clipboardWrite: "clipboard",
        } as const;
        Object.entries(permissionMap).forEach(([uiPermission, packagePermission]) => {
          if (resource.ui?.permissions?.[uiPermission as keyof typeof permissionMap] && !permissionIds.has(packagePermission)) {
            context.addIssue({ code: "custom", path: ["resources", index, "ui", "permissions", uiPermission], message: `requires the ${packagePermission} package permission` });
          }
        });
      }
    } else if (resource.ui) {
      context.addIssue({ code: "custom", path: ["resources", index, "ui"], message: "is only supported by UI resources" });
    }
  });

  manifest.contributions?.forEach((contribution, index) => {
    if (contribution.type === "session-side-panel"
      && manifest.package
      && (manifest.source.origin !== "builtin" || !manifest.source.trusted)) {
      context.addIssue({
        code: "custom",
        path: ["contributions", index, "type"],
        message: "native session panels are restricted to trusted built-in packages",
      });
    }
    if (contribution.type === "workspace-app" || contribution.type === "settings-page") {
      if (!contribution.ref) {
        context.addIssue({ code: "custom", path: ["contributions", index, "ref"], message: "is required for UI contributions" });
      } else if (!manifest.resources.some((resource) => resource.id === contribution.ref && resource.type === "ui")) {
        context.addIssue({ code: "custom", path: ["contributions", index, "ref"], message: "must reference a UI resource" });
      }
    }
    if (contribution.type === "conversation-template" && !contribution.prompt?.trim()) {
      context.addIssue({ code: "custom", path: ["contributions", index, "prompt"], message: "is required for conversation templates" });
    }
  });

  const engineIds = new Set<string>();
  manifest.engineBindings?.forEach((binding, bindingIndex) => {
    if (engineIds.has(binding.engine)) {
      context.addIssue({ code: "custom", path: ["engineBindings", bindingIndex, "engine"], message: "engine binding must be unique" });
    }
    engineIds.add(binding.engine);
    const capabilityIds = new Set<string>();
    binding.capabilities.forEach((capability, capabilityIndex) => {
      if (capabilityIds.has(capability.id)) {
        context.addIssue({ code: "custom", path: ["engineBindings", bindingIndex, "capabilities", capabilityIndex, "id"], message: "engine capability ID must be unique" });
      }
      capabilityIds.add(capability.id);
      if (capability.path && !capability.path.startsWith(`engines/${binding.engine}/`)) {
        context.addIssue({
          code: "custom",
          path: ["engineBindings", bindingIndex, "capabilities", capabilityIndex, "path"],
          message: `must stay inside engines/${binding.engine}/`,
        });
      }
    });
  });

  const relatedSkillIds = new Set<string>();
  manifest.relatedSkills?.forEach((skillId, index) => {
    if (resourceIds.has(skillId)) {
      context.addIssue({ code: "custom", path: ["relatedSkills", index], message: "must not duplicate a package-owned resource" });
    }
    if (relatedSkillIds.has(skillId)) {
      context.addIssue({ code: "custom", path: ["relatedSkills", index], message: "related Skill ID must be unique" });
    }
    relatedSkillIds.add(skillId);
  });

  const methodIds = new Set<string>();
  manifest.authorization?.methods.forEach((method, index) => {
    if (methodIds.has(method.id)) {
      context.addIssue({ code: "custom", path: ["authorization", "methods", index, "id"], message: "authorization method ID must be unique" });
    }
    methodIds.add(method.id);
  });

  const methodsById = new Map(manifest.authorization?.methods.map((method) => [method.id, method]) ?? []);
  Object.entries(manifest.localization?.translations ?? {}).forEach(([locale, translation]) => {
    Object.keys(translation.resources ?? {}).forEach((resourceId) => {
      if (!resourceIds.has(resourceId)) {
        context.addIssue({ code: "custom", path: ["localization", "translations", locale, "resources", resourceId], message: "references an unknown resource" });
      }
    });
    Object.keys(translation.permissions ?? {}).forEach((permissionId) => {
      if (!permissionIds.has(permissionId)) {
        context.addIssue({ code: "custom", path: ["localization", "translations", locale, "permissions", permissionId], message: "references an unknown permission" });
      }
    });
    Object.entries(translation.authorizationMethods ?? {}).forEach(([methodId, methodTranslation]) => {
      const method = methodsById.get(methodId);
      if (!method) {
        context.addIssue({ code: "custom", path: ["localization", "translations", locale, "authorizationMethods", methodId], message: "references an unknown authorization method" });
        return;
      }
      const fieldIds = new Set(method.kind === "secret-form" ? method.fields.map((field) => field.id) : []);
      Object.keys(methodTranslation.fields ?? {}).forEach((fieldId) => {
        if (!fieldIds.has(fieldId)) {
          context.addIssue({ code: "custom", path: ["localization", "translations", locale, "authorizationMethods", methodId, "fields", fieldId], message: "references an unknown authorization field" });
        }
      });
    });
  });

  const serviceResources = manifest.resources.filter((resource) => resource.type === "local-service" && resource.path);
  if (manifest.package && serviceResources.length > 1) {
    context.addIssue({ code: "custom", path: ["resources"], message: "package must declare at most one local service" });
  }
  serviceResources.forEach((resource) => {
    if (!resource.actions?.length) {
      context.addIssue({ code: "custom", path: ["resources", manifest.resources.indexOf(resource), "actions"], message: "must declare at least one service action" });
    }
  });

  manifest.resources.forEach((resource, resourceIndex) => {
    const actionIds = new Set<string>();
    resource.actions?.forEach((action, actionIndex) => {
      if (actionIds.has(action.id)) {
        context.addIssue({ code: "custom", path: ["resources", resourceIndex, "actions", actionIndex, "id"], message: "service action ID must be unique" });
      }
      actionIds.add(action.id);
    });

    const seenRelations = new Set<string>();
    for (const property of ["requires", "provides"] as const) {
      resource[property]?.forEach((relation, relationIndex) => {
        if (seenRelations.has(relation)) {
          context.addIssue({ code: "custom", path: ["resources", resourceIndex, property, relationIndex], message: "relationship must be unique" });
        }
        seenRelations.add(relation);
      });
    }

    resource.requires?.forEach((relation, relationIndex) => {
      const separator = relation.indexOf(":");
      const kind = relation.slice(0, separator);
      const id = relation.slice(separator + 1);
      if (kind === "authorization" && !manifest.authorization?.methods.some((method) => method.id === id)) {
        context.addIssue({ code: "custom", path: ["resources", resourceIndex, "requires", relationIndex], message: "references an unknown authorization method" });
      }
      if (kind === "resource" && !manifest.resources.some((candidate) => candidate.id === id)) {
        context.addIssue({ code: "custom", path: ["resources", resourceIndex, "requires", relationIndex], message: "references an unknown resource" });
      }
      if (kind === "service" && !manifest.resources.some((candidate) => candidate.id === id && candidate.type === "local-service")) {
        context.addIssue({ code: "custom", path: ["resources", resourceIndex, "requires", relationIndex], message: "references an unknown local service" });
      }
    });

    resource.provides?.forEach((relation, relationIndex) => {
      if (!relation.startsWith("action:")) return;
      const actionId = relation.slice("action:".length);
      if (!resource.actions?.some((action) => action.id === actionId)) {
        context.addIssue({ code: "custom", path: ["resources", resourceIndex, "provides", relationIndex], message: "references an undeclared service action" });
      }
    });
  });
});

export type PluginAuthorizationMethod = z.infer<typeof pluginAuthorizationMethodSchema>;
export type PluginPackageManifest = z.infer<typeof manifestSchema>;
export type PluginManifest = PluginPackageManifest;
export type PluginReloadReason = z.infer<typeof reloadReasonSchema>;
export type PluginSourceFormat = z.infer<typeof sourceFormatSchema>;
export type PluginSource = PluginManifest["source"];
export type PluginResource = PluginManifest["resources"][number];
export type PluginUiResource = PluginResource & {
  type: "ui";
  path: string;
  ui: z.infer<typeof uiResourceMetadataSchema>;
};
export type PluginWorkshopProjectSummary = {
  directoryId: string;
  packageRoot: string;
  manifest: PluginPackageManifest | null;
  modifiedAt: number;
  error: string | null;
};
export type PluginWorkshopProjectSnapshot = {
  project: PluginWorkshopProjectSummary;
  revision: string;
  ui: {
    resource: PluginUiResource;
    html: string;
  } | null;
};
export type PluginWorkshopSourceBundle = {
  pluginId: string;
  version: string;
  files: Array<{ path: string; contentBase64: string }>;
  preparation: {
    localizedUrls: string[];
    removedNetworkPermission: boolean;
  };
};
export type PluginUiHostContextV1 = {
  schemaVersion: 1;
  pluginId: string;
  resourceId: string;
  surface: "workspace" | "settings";
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string | null;
  /** Present only while an unpacked Plugin Workshop project is being previewed. */
  developmentPreview?: {
    mode: "plugin-workshop";
    revision: string;
  };
};
export type PluginResourceType = PluginResource["type"];
export type PluginContribution = NonNullable<PluginManifest["contributions"]>[number];
export type PluginContributionType = PluginContribution["type"];
export type PluginSetup = NonNullable<PluginManifest["setup"]>;
export type PluginLifecycle = NonNullable<PluginManifest["lifecycle"]>;
export type PluginPackageMetadata = NonNullable<PluginManifest["package"]>;
export type PluginPermission = NonNullable<PluginManifest["permissions"]>[number];
export type PluginSecretField = Extract<PluginAuthorizationMethod, { kind: "secret-form" }>["fields"][number];
export type PluginEnablementCondition = NonNullable<PluginManifest["enablement"]>[number];
export type PluginEnablementConditionType = PluginEnablementCondition["type"];
export type PluginEnablementResult = { condition: PluginEnablementCondition; met: boolean };
export type PluginEngineBinding = NonNullable<PluginManifest["engineBindings"]>[number];
export type PluginEngineCapability = PluginEngineBinding["capabilities"][number];
export type PluginLocalization = NonNullable<PluginManifest["localization"]>;
export type PluginTranslation = PluginLocalization["translations"][string];
export type PluginAuthorizationMethodTranslation = NonNullable<PluginTranslation["authorizationMethods"]>[string];
export type PluginManifestIssue = { path: string; message: string };
export type PluginManifestValidationResult =
  | { success: true; manifest: PluginPackageManifest }
  | { success: false; issues: PluginManifestIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function duplicateIdIssues(value: unknown, property: "resources" | "methods", pathPrefix: string[]): PluginManifestIssue[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const issues: PluginManifestIssue[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return;
    if (seen.has(entry.id)) issues.push({ path: [...pathPrefix, String(index), "id"].join("."), message: `${property} ID must be unique` });
    seen.add(entry.id);
  });
  return issues;
}

function structuralIssues(value: unknown): PluginManifestIssue[] {
  if (!isRecord(value)) return [];
  const authorization = isRecord(value.authorization) ? value.authorization : null;
  return [
    ...duplicateIdIssues(value.resources, "resources", ["resources"]),
    ...duplicateIdIssues(authorization?.methods, "methods", ["authorization", "methods"]),
  ];
}

function uniqueIssues(issues: PluginManifestIssue[]): PluginManifestIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}\u0000${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validatePluginPackageManifest(value: unknown): PluginManifestValidationResult {
  const result = manifestSchema.safeParse(value);
  const additionalIssues = structuralIssues(value);
  if (result.success && additionalIssues.length === 0) return { success: true, manifest: result.data };
  const parseIssues = result.success ? [] : result.error.issues.flatMap((issue): PluginManifestIssue[] => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({ path: [...issue.path, key].join("."), message: "field is not allowed" }));
    }
    return [{ path: issue.path.join("."), message: issue.message }];
  });
  return {
    success: false,
    issues: uniqueIssues([...parseIssues, ...additionalIssues]),
  };
}

export function parsePluginPackageManifest(value: unknown): PluginPackageManifest {
  const result = validatePluginPackageManifest(value);
  if (result.success) return result.manifest;
  const detail = result.issues.map((issue) => `${issue.path || "manifest"}: ${issue.message}`).join("; ");
  throw new Error(`Invalid plugin package manifest: ${detail}`);
}
