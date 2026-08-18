import { z } from "zod";

export const MAX_TEMPLATE_PACKAGE_BYTES = 50 * 1024 * 1024;
export const TEMPLATE_AUTHORING_ID_PREFIX = "ipollowork.authoring.";

export const IPOLLOWORK_PACKAGE_EXTENSION = ".ipwp";
export const LEGACY_TEMPLATE_PACKAGE_EXTENSION = ".ipwt";
export const IPOLLOWORK_PACKAGE_MEDIA_TYPE = "application/vnd.ipollowork.package+zip";
export const LEGACY_TEMPLATE_PACKAGE_MEDIA_TYPE = "application/vnd.ipollowork-template+zip";
export const TEMPLATE_PACKAGE_EXTENSIONS = Object.freeze([
  IPOLLOWORK_PACKAGE_EXTENSION,
  LEGACY_TEMPLATE_PACKAGE_EXTENSION,
]);
export const TEMPLATE_PACKAGE_FILE_ACCEPT = TEMPLATE_PACKAGE_EXTENSIONS.join(",");

export function templatePackageMediaTypeForFilename(filename: string): string {
  return filename.toLowerCase().endsWith(LEGACY_TEMPLATE_PACKAGE_EXTENSION)
    ? LEGACY_TEMPLATE_PACKAGE_MEDIA_TYPE
    : IPOLLOWORK_PACKAGE_MEDIA_TYPE;
}

export const templateCategorySchema = z.enum([
  "site",
  "video",
  "app",
  "slides",
  "poster",
  "cards",
  "report",
  "article",
  "other",
]);
export const templateSourceTypeSchema = z.enum(["bundled", "local", "market"]);
export const templateSurfaceSchema = z.enum(["design", "video"]);
export const pptxCompatibilitySchema = z.enum(["native-editable"]);
export const templateStyleSchema = z.enum([
  "minimal",
  "editorial",
  "newsprint",
  "swiss",
  "bold",
  "soft",
  "pastel",
  "glass",
  "dark",
  "cyber",
  "technical",
  "playful",
  "cinematic",
  "data",
  "brutalist",
  "retro",
  "sketch",
  "custom",
]);

export const TEMPLATE_STYLE_LABELS: Record<z.infer<typeof templateStyleSchema>, string> = {
  minimal: "Minimal",
  editorial: "Editorial",
  newsprint: "Newsprint",
  swiss: "Swiss grid",
  bold: "Bold",
  soft: "Soft",
  pastel: "Pastel",
  glass: "Glass",
  dark: "Dark",
  cyber: "Cyber",
  technical: "Technical",
  playful: "Playful",
  cinematic: "Cinematic",
  data: "Data",
  brutalist: "Brutalist",
  retro: "Retro",
  sketch: "Sketch",
  custom: "Custom",
};

export const templateVariableSchema = z.object({
  id: z.string().trim().regex(/^(?:--ipw-[a-z0-9-]+|[A-Za-z_][A-Za-z0-9_-]*)$/).max(64),
  label: z.string().trim().min(1).max(64),
  type: z.enum(["color", "font", "number", "text", "image", "boolean", "select"]),
  group: z.enum(["theme", "background", "typography", "components", "content", "brand"]),
}).strict();

export const templateManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/).max(128),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(64),
  kind: z.literal("design"),
  category: templateCategorySchema,
  subcategory: z.string().trim().min(1).max(64),
  style: templateStyleSchema.default("minimal"),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
  pptxCompatibility: pptxCompatibilitySchema.optional(),
  surface: templateSurfaceSchema.default("design"),
  title: z.string().trim().min(1).max(96),
  description: z.string().trim().min(1).max(240),
  cover: z.string().trim().min(1),
  entry: z.string().trim().min(1),
  source: z.object({
    name: z.string().trim().min(1).max(96),
    repository: z.string().url().optional(),
    license: z.string().trim().min(1).max(64),
    revision: z.string().trim().min(7).max(64).optional(),
    attribution: z.string().trim().min(1).max(240).optional(),
  }).strict(),
  designSystem: z.object({
    tokenVersion: z.literal(1),
    editableGroups: z.array(z.enum(["theme", "background", "typography", "components"])).min(1),
    tokens: z.string().trim().min(1).optional(),
    variables: z.array(templateVariableSchema).max(64).default([]),
  }).strict(),
  applyChecklist: z.array(z.string().trim().min(1).max(240)).min(1),
  minimumAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
}).strict().superRefine((manifest, context) => {
  if (manifest.pptxCompatibility && manifest.category !== "slides") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pptxCompatibility"], message: "PPTX compatibility is only supported for slide templates" });
  }
  if (manifest.surface === "video") {
    if (manifest.category !== "video") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "Video templates must use the video category" });
    }
    if (manifest.entry !== "index.html") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["entry"], message: "Video templates must use index.html as their entry" });
    }
  } else if (manifest.category === "video") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["surface"], message: "The video category must use the video surface" });
  }
});

export type TemplateManifestV1 = z.infer<typeof templateManifestV1Schema>;
export type TemplateCategory = z.infer<typeof templateCategorySchema>;
export type TemplateSourceType = z.infer<typeof templateSourceTypeSchema>;
export type TemplateSurface = z.infer<typeof templateSurfaceSchema>;
export type TemplateStyle = z.infer<typeof templateStyleSchema>;
export type TemplateVariable = z.infer<typeof templateVariableSchema>;
export type PptxCompatibility = z.infer<typeof pptxCompatibilitySchema>;

const CUSTOMER_VISIBLE_CURATED_CATEGORY_TEMPLATE_IDS = new Set([
  "ipollowork.html-anything.prototype-web",
  "ipollowork.site-afterglow-festival",
  "ipollowork.html-anything.web-proto-soft",
  "ipollowork.site-signal-workspace",
  "ipollowork.site-orbit-data",
  "ipollowork.html-anything.wireframe-sketch",
  "ipollowork.site-atelier-architecture",
  "ipollowork.hyperframes.agent-command-center",
  "ipollowork.hyperframes.multi-agent-relay",
  "ipollowork.hyperframes.course-journey",
  "ipollowork.html-anything.motion-frames",
  "ipollowork.hyperframes.permission-vault",
  "ipollowork.hyperframes.code-explainer",
  "ipollowork.pptx-ipollo-vi-enterprise",
  "ipollowork.pptx-brand-narrative",
  "ipollowork.html-anything.deck-blueprint",
  "ipollowork.html-anything.deck-xhs-pastel",
  "ipollowork.html-anything.deck-hermes-cyber",
  "ipollowork.html-anything.deck-presenter-mode",
]);
const CUSTOMER_CURATED_TEMPLATE_CATEGORIES = new Set<TemplateCategory>(["site", "video", "slides"]);

/** Shared visibility contract for every first-party template catalog host. */
export function isCustomerVisibleBundledTemplate(manifest: TemplateManifestV1): boolean {
  return CUSTOMER_CURATED_TEMPLATE_CATEGORIES.has(manifest.category)
    ? CUSTOMER_VISIBLE_CURATED_CATEGORY_TEMPLATE_IDS.has(manifest.id)
    : true;
}

export type TemplateAuthoringInput = {
  sessionId: string;
  category: TemplateCategory;
  pptxCompatibility?: PptxCompatibility;
};

export type TemplateValidationIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
};

export type TemplateValidationReport = {
  ready: boolean;
  surface: TemplateSurface;
  entry: string;
  manifest: TemplateManifestV1 | null;
  issues: TemplateValidationIssue[];
};

type PptxCompatibilityTemplate = Pick<TemplateManifestV1, "category" | "pptxCompatibility">;
type CatalogSortTemplate = Pick<TemplateManifestV1, "category" | "title" | "pptxCompatibility">;

export function isPptxCompatibleTemplate(template: PptxCompatibilityTemplate): boolean {
  return template.category === "slides" && template.pptxCompatibility === "native-editable";
}

export function sortTemplatesForCatalog<T extends CatalogSortTemplate>(templates: readonly T[]): T[] {
  return [...templates].sort((left, right) => {
    const compatibility = Number(isPptxCompatibleTemplate(right)) - Number(isPptxCompatibleTemplate(left));
    if (compatibility !== 0) return compatibility;
    const category = left.category.localeCompare(right.category);
    if (category !== 0) return category;
    return left.title.localeCompare(right.title);
  });
}

export type TemplateCatalogItem = {
  manifest: TemplateManifestV1;
  sourceType: TemplateSourceType;
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
  verified: boolean;
};

/**
 * Canonical metadata for a template-backed task. It is persisted by the
 * server, independent of either Design or Video UI surface.
 */
export type TemplateSessionState = {
  schemaVersion: 1;
  template: {
    id: string;
    version: string;
    sourceType: TemplateSourceType;
  };
  entry: string;
  briefPath: string;
  createdAt: number;
};

export type TemplateSessionSnapshot = {
  sessionId: string;
  surface: TemplateSurface;
  authoring: boolean;
  state: TemplateSessionState;
  manifest: TemplateManifestV1;
};

export function isTemplateAuthoringManifest(manifest: Pick<TemplateManifestV1, "id">): boolean {
  return manifest.id.startsWith(TEMPLATE_AUTHORING_ID_PREFIX);
}
