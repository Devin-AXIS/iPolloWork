import { z } from "zod";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMPATIBILITY_RE = /^(?:\*|(?:\^|~|>=|<=|>|<)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(?:\|\||-)\s+(?:\^|~|>=|<=|>|<)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)?$/;
const ID_RE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const SIMPLE_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const FIELD_ID_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;
const RELATION_RE = /^(?:action|authorization|resource|service|workflow):[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const RESERVED_EXTENSION_IDS = new Set(["google-workspace", "media-center", "openai-image-generation", "storage"]);

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
  "opencode-plugin",
  "provider",
  "hook",
  "context",
  "secret",
  "file",
  "local-service",
  "native-binary",
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
  inputSchema: z.record(z.string(), z.unknown()).optional(),
}).strict();

const relationSchema = z.string().regex(RELATION_RE, "must use kind:id syntax");

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
  localCommandRef: z.enum(["ipollowork.computerUseMcp", "ipollowork.uiMcp"]).optional(),
  actions: z.array(serviceActionSchema).optional(),
  requires: z.array(relationSchema).optional(),
  provides: z.array(relationSchema).optional(),
  required: z.boolean().optional(),
}).passthrough();

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
  kind: z.literal("secret-form"),
  label: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(secretFieldSchema).min(1),
}).strict();

const oauthPkceSchema = z.object({
  id: z.string().regex(SIMPLE_ID_RE),
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
    opencode: z.string().regex(COMPATIBILITY_RE, "must be a supported semantic-version range").optional(),
  }).strict().optional(),
  updateId: z.string().regex(ID_RE),
  entrypoints: z.object({
    opencode: relativePathSchema.optional(),
    service: relativePathSchema.optional(),
  }).strict(),
  checksum: z.object({
    algorithm: z.literal("sha256"),
    value: z.string().regex(/^[a-f0-9]{64}$/i),
  }).strict().optional(),
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(SIMPLE_ID_RE),
  name: z.string().min(1),
  description: z.string(),
  preview: z.boolean().optional(),
  source: z.object({
    format: sourceFormatSchema,
    trusted: z.boolean(),
    origin: z.enum(["builtin", "den", "workspace", "local"]).optional(),
    reference: z.string().optional(),
  }).passthrough(),
  icon: z.object({ src: z.string().optional(), simpleIconSlug: z.string().optional() }).passthrough().optional(),
  composer: z.object({ prompt: z.string() }).passthrough().optional(),
  setup: z.record(z.string(), z.unknown()).optional(),
  resources: z.array(resourceSchema),
  contributions: z.array(z.record(z.string(), z.unknown())).optional(),
  lifecycle: z.record(z.string(), z.unknown()).optional(),
  enablement: z.array(z.record(z.string(), z.unknown())).optional(),
  defaultEnabled: z.boolean().optional(),
  defaultHidden: z.boolean().optional(),
  platform: z.array(z.enum(["darwin", "linux", "windows", "web"])).optional(),
  package: packageSchema.optional(),
  permissions: z.array(z.object({
    id: permissionIdSchema,
    reason: z.string().min(1),
    optional: z.boolean().optional(),
  }).strict()).optional(),
  authorization: z.object({
    required: z.boolean().default(false),
    methods: z.array(pluginAuthorizationMethodSchema),
  }).strict().optional(),
}).passthrough().superRefine((manifest, context) => {
  if (manifest.package && RESERVED_EXTENSION_IDS.has(manifest.id)) {
    context.addIssue({ code: "custom", path: ["id"], message: "is reserved by a built-in extension" });
  }

  const resourceIds = new Set<string>();
  manifest.resources.forEach((resource, index) => {
    if (resourceIds.has(resource.id)) {
      context.addIssue({ code: "custom", path: ["resources", index, "id"], message: "resource ID must be unique" });
    }
    resourceIds.add(resource.id);
  });

  const methodIds = new Set<string>();
  manifest.authorization?.methods.forEach((method, index) => {
    if (methodIds.has(method.id)) {
      context.addIssue({ code: "custom", path: ["authorization", "methods", index, "id"], message: "authorization method ID must be unique" });
    }
    methodIds.add(method.id);
  });

  if (manifest.package?.entrypoints.opencode) {
    const entrypoint = manifest.package.entrypoints.opencode;
    const resource = manifest.resources.find((candidate) => candidate.type === "opencode-plugin" && candidate.path === entrypoint);
    if (!resource) {
      context.addIssue({ code: "custom", path: ["package", "entrypoints", "opencode"], message: "must reference an opencode-plugin resource path" });
    }
  }

  if (manifest.package?.entrypoints.service) {
    const entrypoint = manifest.package.entrypoints.service;
    const resource = manifest.resources.find((candidate) => candidate.type === "local-service" && candidate.path === entrypoint);
    if (!resource) {
      context.addIssue({ code: "custom", path: ["package", "entrypoints", "service"], message: "must reference a local-service resource path" });
    } else if (!resource.actions?.length) {
      context.addIssue({ code: "custom", path: ["resources", manifest.resources.indexOf(resource), "actions"], message: "must declare at least one service action" });
    }
  }

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
