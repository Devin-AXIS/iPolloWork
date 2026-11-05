import { z } from "zod";

export const SKILL_PACKAGE_EXTENSION = ".ipollowork-skill";
export const SKILL_PACKAGE_MANIFEST = "ipollowork.skill.json";
export const MAX_SKILL_PACKAGE_BYTES = 50 * 1024 * 1024;
export const skillPackageManifestSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("skill"),
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u).max(128),
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64),
  title: z.string().trim().min(1).max(96), description: z.string().trim().min(1).max(500),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u).max(64), entry: z.literal("SKILL.md"),
  category: z.string().trim().min(1).max(64).default("general"),
  minimumAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  dependencies: z.array(z.object({ type: z.enum(["plugin", "tool"]), name: z.string().trim().min(1).max(128) }).strict()).max(32).default([]),
}).strict();
export type SkillPackageManifest = z.infer<typeof skillPackageManifestSchema>;

export const enterpriseSkillContextSchema = z.object({
  enterpriseId: z.string().regex(/^ent_[A-Za-z0-9_-]+$/u),
  origin: z.string().url().max(2048), memberId: z.string().min(1).max(128),
  token: z.string().min(1).max(16384),
}).strict();
export type EnterpriseSkillContext = z.infer<typeof enterpriseSkillContextSchema>;
export const skillPackageExportSchema = z.object({
  name: z.string().min(1).max(64), title: z.string().trim().min(1).max(96),
  version: skillPackageManifestSchema.shape.version,
}).strict();
export type SkillPackageExportInput = z.infer<typeof skillPackageExportSchema>;
export const enterpriseSkillInstallSchema = z.object({
  context: enterpriseSkillContextSchema, resourceId: z.string().min(1).max(128),
  version: skillPackageManifestSchema.shape.version, digest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type EnterpriseSkillInstallInput = z.infer<typeof enterpriseSkillInstallSchema>;
export const installedEnterpriseSkillSchema = z.object({
  resourceId: z.string(), enterpriseId: z.string(), memberId: z.string(), origin: z.string(),
  manifest: skillPackageManifestSchema, digest: z.string(), enabled: z.boolean(), installedAt: z.string(),
});
export type InstalledEnterpriseSkill = z.infer<typeof installedEnterpriseSkillSchema>;

export const publicSkillSchema = z.object({
  id: z.string().min(1).max(128), type: z.literal("skill"),
  name: z.string().min(1).max(64), title: z.string().min(1).max(96), description: z.string().max(500),
  category: z.string().max(64), authorName: z.string().max(160), updatedAt: z.string(),
  latestVersion: z.object({ version: z.string().max(64), digest: z.string().regex(/^[a-f0-9]{64}$/u), minimumAppVersion: z.string() }),
});
export type PublicSkill = z.infer<typeof publicSkillSchema>;
export const publicSkillCatalogSchema = z.object({ items: z.array(publicSkillSchema).max(50), nextCursor: z.string().max(128).nullable() });

export const skillDetailSchema = z.object({ manifest: skillPackageManifestSchema, content: z.string().max(1024 * 1024), files: z.array(z.string()).max(512) });
