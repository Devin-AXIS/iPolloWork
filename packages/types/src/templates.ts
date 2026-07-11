import { z } from "zod";

export const templateCategorySchema = z.enum(["site", "slides", "poster"]);
export const templateSourceTypeSchema = z.enum(["bundled", "local", "market"]);

export const templateManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/).max(128),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(64),
  kind: z.literal("design"),
  category: templateCategorySchema,
  subcategory: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(96),
  description: z.string().trim().min(1).max(240),
  cover: z.string().trim().min(1),
  entry: z.string().trim().min(1),
  source: z.object({
    name: z.string().trim().min(1).max(96),
    repository: z.string().url().optional(),
    license: z.string().trim().min(1).max(64),
  }).strict(),
  designSystem: z.object({
    tokenVersion: z.literal(1),
    editableGroups: z.array(z.enum(["theme", "background", "typography", "components"])).min(1),
    tokens: z.string().trim().min(1).optional(),
  }).strict(),
  applyChecklist: z.array(z.string().trim().min(1).max(240)).min(1),
  minimumAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
}).strict();

export type TemplateManifestV1 = z.infer<typeof templateManifestV1Schema>;
export type TemplateCategory = z.infer<typeof templateCategorySchema>;
export type TemplateSourceType = z.infer<typeof templateSourceTypeSchema>;

export type TemplateCatalogItem = {
  manifest: TemplateManifestV1;
  sourceType: TemplateSourceType;
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
  verified: boolean;
};

export type DesignSessionTemplateState = {
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
