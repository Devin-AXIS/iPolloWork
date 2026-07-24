export type PluginPrimaryActionKind = "install" | "connect" | "open" | "update" | "repair";

export function enqueuePluginFieldValue(
  setter: (update: (current: Record<string, string>) => Record<string, string>) => void,
  key: string,
  value: string,
): void {
  setter((current) => ({ ...current, [key]: value }));
}

export function formatPluginPlatformError(cause: unknown, localizedSummary: string): string {
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
    return { version: null, publisher: null, permissions: [], resources: [], authorizationRequired: false, authorizationMethods: [] };
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
    permissions,
    resources,
    authorizationRequired,
    authorizationMethods,
  };
}
