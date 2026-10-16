export type CloudImportedSkill = {
  cloudSkillId: string;
  installedName: string;
  title: string;
  description: string | null;
  shared: "org" | "public" | null;
  updatedAt: string | null;
  importedAt: number | null;
};

export type CloudImportedProvider = {
  cloudProviderId: string;
  providerId: string;
  sourceProviderId: string;
  name: string;
  source: string | null;
  updatedAt: string | null;
  modelIds: string[];
  importedAt: number | null;
};

export type WorkspaceCloudImports = {
  skills: Record<string, CloudImportedSkill>;
  providers: Record<string, CloudImportedProvider>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

export function readWorkspaceCloudImports(value: unknown): WorkspaceCloudImports {
  const root = isRecord(value) ? value : {};
  const cloudImports = isRecord(root.cloudImports) ? root.cloudImports : {};
  const rawSkills = isRecord(cloudImports.skills) ? cloudImports.skills : {};
  const rawProviders = isRecord(cloudImports.providers) ? cloudImports.providers : {};

  const providers = Object.fromEntries(
    Object.entries(rawProviders).flatMap(([key, entry]) => {
      if (!isRecord(entry)) return [];
      const cloudProviderId = typeof entry.cloudProviderId === "string"
        ? entry.cloudProviderId.trim()
        : key.trim();
      const providerId = typeof entry.providerId === "string" ? entry.providerId.trim() : "";
      const sourceProviderId = typeof entry.sourceProviderId === "string"
        ? entry.sourceProviderId.trim()
        : providerId;
      const name = typeof entry.name === "string" ? entry.name.trim() : providerId || cloudProviderId;
      if (!cloudProviderId || !providerId || !sourceProviderId || !name) return [];
      const imported = {
        cloudProviderId,
        providerId,
        sourceProviderId,
        name,
        source: typeof entry.source === "string" ? entry.source.trim() || null : null,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt.trim() || null : null,
        modelIds: readStringArray(entry.modelIds),
        importedAt: typeof entry.importedAt === "number" && Number.isFinite(entry.importedAt)
          ? entry.importedAt
          : null,
      } satisfies CloudImportedProvider;
      return [[cloudProviderId, imported] as const];
    }),
  );

  const skills = Object.fromEntries(
    Object.entries(rawSkills).flatMap(([key, entry]) => {
      if (!isRecord(entry)) return [];
      const cloudSkillId = typeof entry.cloudSkillId === "string"
        ? entry.cloudSkillId.trim()
        : key.trim();
      const installedName = typeof entry.installedName === "string" ? entry.installedName.trim() : "";
      const title = typeof entry.title === "string" ? entry.title.trim() : installedName || cloudSkillId;
      if (!cloudSkillId || !installedName || !title) return [];
      const imported = {
        cloudSkillId,
        installedName,
        title,
        description: typeof entry.description === "string" ? entry.description.trim() || null : null,
        shared: entry.shared === "org" || entry.shared === "public" ? entry.shared : null,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt.trim() || null : null,
        importedAt: typeof entry.importedAt === "number" && Number.isFinite(entry.importedAt)
          ? entry.importedAt
          : null,
      } satisfies CloudImportedSkill;
      return [[cloudSkillId, imported] as const];
    }),
  );

  return { skills, providers };
}

export function withWorkspaceCloudImports(
  config: Record<string, unknown>,
  cloudImports: WorkspaceCloudImports,
) {
  return {
    ...config,
    cloudImports: {
      skills: cloudImports.skills,
      providers: cloudImports.providers,
    },
  };
}
