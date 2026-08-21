import type {
  iPolloWorkExtensionLocalization,
  iPolloWorkExtensionManifest,
  iPolloWorkExtensionTranslation,
  iPolloWorkPluginAuthorizationMethodTranslation,
  iPolloWorkPluginAuthorizationMethod,
} from "../../../app/extensions";
import type { PluginEngineCompatibility } from "@ipollowork/types/plugins";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

export type PluginPrimaryActionKind = "install" | "connect" | "open" | "update" | "repair";

export type PluginPackageEngineScope =
  | { kind: "universal" }
  | { kind: "engine"; engineId: string }
  | { kind: "multi-engine"; engineIds: string[] };

export type PluginPackageEngineLimitation = {
  engineId: string;
  status: "partial" | "unsupported";
  capabilityLabels: string[];
  nativeEngineOnly: boolean;
};

export function pluginPackageEngineScope(
  manifest: iPolloWorkExtensionManifest,
  engineCompatibility?: readonly PluginEngineCompatibility[],
): PluginPackageEngineScope {
  // Older installed Harness packages described their delegated target as the
  // owning engine. The package is an OpenCode bridge, so keep their display
  // scope aligned with the corrected catalog manifest until they auto-update.
  if (manifest.id === DEEPSEEK_HARNESS_ENGINE_ID) {
    return { kind: "engine", engineId: DEFAULT_ENGINE_ID };
  }
  const engineIds = manifest.package?.engines;

  if (engineCompatibility?.length) {
    const fullySupportedEngineIds = engineCompatibility
      .filter((entry) => entry.status === "ready")
      .map((entry) => entry.engineId);
    const [fullySupportedEngineId] = fullySupportedEngineIds;
    if (fullySupportedEngineIds.length === engineCompatibility.length) return { kind: "universal" };
    if (fullySupportedEngineIds.length === 1 && fullySupportedEngineId) return { kind: "engine", engineId: fullySupportedEngineId };
    if (fullySupportedEngineIds.length > 1) return { kind: "multi-engine", engineIds: fullySupportedEngineIds };
  }

  const [engineId] = engineIds ?? [];
  if (engineIds?.length === 1) return { kind: "engine", engineId };
  if (!engineId) return { kind: "universal" };
  return { kind: "multi-engine", engineIds: [...(engineIds ?? [])] };
}

export function pluginPackageEngineLimitations(
  manifest: iPolloWorkExtensionManifest,
  engineCompatibility?: readonly PluginEngineCompatibility[],
): PluginPackageEngineLimitation[] {
  const capabilityLabels = new Map(
    manifest.resources.map((resource) => [resource.id, resource.label ?? resource.id]),
  );
  manifest.engineBindings?.forEach((binding) => {
    binding.capabilities.forEach((capability) => {
      capabilityLabels.set(capability.id, capability.label ?? capability.id);
    });
  });

  return (engineCompatibility ?? []).flatMap((compatibility): PluginPackageEngineLimitation[] => {
    if (compatibility.status === "ready") return [];
    const unsupportedIds = new Set([
      ...compatibility.unsupportedResourceIds,
      ...compatibility.unsupportedCapabilityIds,
    ]);
    return [{
      engineId: compatibility.engineId,
      status: compatibility.status,
      capabilityLabels: [...unsupportedIds].map((id) => capabilityLabels.get(id) ?? id),
      nativeEngineOnly: compatibility.nativeEngineOnly,
    }];
  });
}

type PluginPackageRelationshipSource = { manifest: iPolloWorkExtensionManifest };

export type PluginPackageRelationships = {
  skillNames: string[];
  mcpServerNames: string[];
};

type PluginTranslationLayers = {
  current: iPolloWorkExtensionTranslation | undefined;
  english: iPolloWorkExtensionTranslation | undefined;
};

function translationLayersForLocale(
  localization: iPolloWorkExtensionLocalization | undefined,
  locale: string,
): PluginTranslationLayers | null {
  if (!localization || locale === localization.defaultLocale) return null;
  const current = localization.translations[locale];
  const english = locale === "en" ? undefined : localization.translations.en;
  return current || english ? { current, english } : null;
}

function localizeAuthorizationMethod(
  method: iPolloWorkPluginAuthorizationMethod,
  currentTranslation: iPolloWorkPluginAuthorizationMethodTranslation | undefined,
  englishTranslation: iPolloWorkPluginAuthorizationMethodTranslation | undefined,
): iPolloWorkPluginAuthorizationMethod {
  const label = currentTranslation?.label ?? englishTranslation?.label ?? method.label;
  const description = currentTranslation?.description ?? englishTranslation?.description ?? method.description;
  if (method.kind !== "secret-form") return { ...method, label, description };
  return {
    ...method,
    label,
    description,
    fields: method.fields.map((field) => {
      const currentField = currentTranslation?.fields?.[field.id];
      const englishField = englishTranslation?.fields?.[field.id];
      return {
        ...field,
        label: currentField?.label ?? englishField?.label ?? field.label,
        description: currentField?.description ?? englishField?.description ?? field.description,
        placeholder: currentField?.placeholder ?? englishField?.placeholder ?? field.placeholder,
      };
    }),
  };
}

export function localizePluginPackageManifest(
  manifest: iPolloWorkExtensionManifest,
  locale: string,
  catalogLocalization?: iPolloWorkExtensionLocalization,
): iPolloWorkExtensionManifest {
  const translations = translationLayersForLocale(manifest.localization ?? catalogLocalization, locale);
  if (!translations) return manifest;
  const { current, english } = translations;
  return {
    ...manifest,
    name: current?.name ?? english?.name ?? manifest.name,
    description: current?.description ?? english?.description ?? manifest.description,
    category: current?.category ?? english?.category ?? manifest.category,
    composer: manifest.composer
      ? { ...manifest.composer, prompt: current?.composer?.prompt ?? english?.composer?.prompt ?? manifest.composer.prompt }
      : manifest.composer,
    setup: manifest.setup
      ? {
          ...manifest.setup,
          instructions: current?.setup?.instructions ?? english?.setup?.instructions ?? manifest.setup.instructions,
          primaryCta: current?.setup?.primaryCta ?? english?.setup?.primaryCta ?? manifest.setup.primaryCta,
          secondaryCta: current?.setup?.secondaryCta ?? english?.setup?.secondaryCta ?? manifest.setup.secondaryCta,
        }
      : manifest.setup,
    resources: manifest.resources.map((resource) => {
      const currentResource = current?.resources?.[resource.id];
      const englishResource = english?.resources?.[resource.id];
      return {
        ...resource,
        label: currentResource?.label ?? englishResource?.label ?? resource.label,
        description: currentResource?.description ?? englishResource?.description ?? resource.description,
      };
    }),
    permissions: manifest.permissions?.map((permission) => ({
      ...permission,
      reason: current?.permissions?.[permission.id]?.reason
        ?? english?.permissions?.[permission.id]?.reason
        ?? permission.reason,
    })),
    authorization: manifest.authorization
      ? {
          ...manifest.authorization,
          methods: manifest.authorization.methods.map((method) =>
            localizeAuthorizationMethod(
              method,
              current?.authorizationMethods?.[method.id],
              english?.authorizationMethods?.[method.id],
            )),
        }
      : manifest.authorization,
  };
}

export function collectPluginPackageRelationships(
  installed: PluginPackageRelationshipSource[],
  catalog: PluginPackageRelationshipSource[],
): PluginPackageRelationships {
  const skillNames = new Set<string>();
  const mcpServerNames = new Set<string>();
  for (const item of [...installed, ...catalog]) {
    item.manifest.resources.forEach((resource) => {
      if (resource.type === "skill") skillNames.add(resource.id);
      if (resource.type === "mcp" && resource.mcpServerName) mcpServerNames.add(resource.mcpServerName);
    });
  }
  installed.forEach((item) => {
    item.manifest.relatedSkills?.forEach((skillName) => skillNames.add(skillName));
  });
  return {
    skillNames: [...skillNames].sort(),
    mcpServerNames: [...mcpServerNames].sort(),
  };
}

export function enqueuePluginFieldValue(
  setter: (update: (current: Record<string, string>) => Record<string, string>) => void,
  key: string,
  value: string,
): void {
  setter((current) => ({ ...current, [key]: value }));
}

function pluginConflictPaths(cause: unknown): string[] {
  if (!(cause instanceof Error) || Reflect.get(cause, "code") !== "plugin_package_conflict") return [];
  const details = Reflect.get(cause, "details");
  if (!details || typeof details !== "object") return [];
  const paths = Reflect.get(details, "paths");
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : [];
}

export function formatPluginPlatformError(cause: unknown, localizedSummary: string, localizedConflict?: string): string {
  const conflictPaths = pluginConflictPaths(cause);
  if (localizedConflict && conflictPaths.length > 0) return `${localizedConflict} ${conflictPaths.join(", ")}`;
  const detail = cause instanceof Error ? cause.message.trim() : "";
  return detail && detail !== localizedSummary ? `${localizedSummary} ${detail}` : localizedSummary;
}

export type PluginPrimaryAction = {
  kind: PluginPrimaryActionKind;
  labelKey: `plugin_platform.action.${PluginPrimaryActionKind}`;
};

export function derivePluginPrimaryAction(input: {
  installed: boolean;
  authorizationRequired: boolean;
  connected: boolean;
  updateAvailable: boolean;
  broken: boolean;
}): PluginPrimaryAction {
  const kind: PluginPrimaryActionKind = !input.installed
    ? "install"
    : input.broken
      ? "repair"
      : input.updateAvailable
        ? "update"
        : input.authorizationRequired && !input.connected
          ? "connect"
          : "open";
  return { kind, labelKey: `plugin_platform.action.${kind}` };
}

type ProjectedResource = { id: string; type: string; label: string; required: boolean };
type ProjectedPermission = { id: string; reason: string; optional: boolean };
type ProjectedAuthorizationMethod = { id: string; kind: string; label: string; description: string | null };

export type PluginPackageDetails = {
  version: string | null;
  publisher: string | null;
  category: string | null;
  permissions: ProjectedPermission[];
  resources: ProjectedResource[];
  authorizationRequired: boolean;
  authorizationMethods: ProjectedAuthorizationMethod[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function projectPluginPackageDetails(manifest: unknown): PluginPackageDetails {
  if (!isRecord(manifest)) {
    return { version: null, publisher: null, category: null, permissions: [], resources: [], authorizationRequired: false, authorizationMethods: [] };
  }
  const packageMetadata = isRecord(manifest.package) ? manifest.package : null;
  const publisher = packageMetadata && isRecord(packageMetadata.publisher) ? packageMetadata.publisher : null;
  const authorization = isRecord(manifest.authorization) ? manifest.authorization : null;
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.flatMap((permission): ProjectedPermission[] => {
    if (!isRecord(permission)) return [];
    const id = text(permission.id);
    const reason = text(permission.reason);
    return id && reason ? [{ id, reason, optional: permission.optional === true }] : [];
  }) : [];
  const resources = Array.isArray(manifest.resources) ? manifest.resources.flatMap((resource): ProjectedResource[] => {
    if (!isRecord(resource)) return [];
    const id = text(resource.id);
    const type = text(resource.type);
    if (!id || !type) return [];
    return [{ id, type, label: text(resource.label) ?? id, required: resource.required === true }];
  }) : [];
  if (Array.isArray(manifest.engineBindings)) {
    manifest.engineBindings.forEach((binding) => {
      if (!isRecord(binding) || !text(binding.engine) || !Array.isArray(binding.capabilities)) return;
      binding.capabilities.forEach((capability) => {
        if (!isRecord(capability)) return;
        const id = text(capability.id);
        const kind = text(capability.kind);
        if (!id || !kind) return;
        resources.push({
          id,
          type: `${text(binding.engine)}/${kind}`,
          label: text(capability.label) ?? id,
          required: capability.required === true,
        });
      });
    });
  }
  const authorizationMethods = authorization && Array.isArray(authorization.methods)
    ? authorization.methods.flatMap((method): ProjectedAuthorizationMethod[] => {
        if (!isRecord(method)) return [];
        const id = text(method.id);
        const kind = text(method.kind);
        const label = text(method.label);
        return id && kind && label ? [{ id, kind, label, description: text(method.description) }] : [];
      })
    : [];
  const authorizationRequired = authorization?.required === true || (Array.isArray(manifest.resources) && manifest.resources.some((resource) =>
    isRecord(resource) && Array.isArray(resource.requires) && resource.requires.some((requirement) =>
      typeof requirement === "string" && requirement.startsWith("authorization:")
    )
  ));
  return {
    version: packageMetadata ? text(packageMetadata.version) : null,
    publisher: publisher ? text(publisher.name) : null,
    category: text(manifest.category),
    permissions,
    resources,
    authorizationRequired,
    authorizationMethods,
  };
}
