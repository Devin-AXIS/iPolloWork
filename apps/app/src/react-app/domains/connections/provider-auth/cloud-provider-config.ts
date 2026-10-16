import type {
  DenOrgLlmProvider,
  DenOrgLlmProviderConnection,
} from "../../../../app/lib/den";
import type { CloudImportedProvider } from "../../../../app/cloud/import-state";

/** Pure Work-layer helpers for cloud-managed provider identity and credentials. */

const getStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

const sameStringList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const getCloudProviderEnv = (config: Record<string, unknown>) =>
  getStringList(config.env);

/**
 * Split a connect payload's credential into the engine credential and the env
 * vars to upsert. Multi-env providers (`apiKeys`) set every value as
 * an env var and use the first env-ordered value as the auth entry, following
 * the models.dev convention that `env[0]` is the primary credential. Legacy
 * single-credential payloads (`apiKey`) keep today's auth-only behaviour.
 */
export const resolveCloudProviderCredentials = (
  provider: Pick<
    DenOrgLlmProviderConnection,
    "apiKey" | "apiKeys" | "providerConfig"
  >,
) => {
  const apiKeys = provider.apiKeys ?? {};
  const envNames = getCloudProviderEnv(provider.providerConfig);
  const orderedNames = [
    ...envNames.filter((name) => name in apiKeys),
    ...Object.keys(apiKeys).filter((name) => !envNames.includes(name)),
  ];
  const envEntries = orderedNames.flatMap((name) => {
    const value = apiKeys[name]?.trim();
    return value ? [{ key: name, value }] : [];
  });
  const primaryApiKey = provider.apiKey?.trim() || envEntries[0]?.value || "";
  return { envEntries, primaryApiKey };
};

export const getCloudManagedProviderId = (
  provider: Pick<DenOrgLlmProvider, "id" | "providerId" | "source">,
) => (provider.source === "ipollowork" ? "ipollowork" : provider.id.trim());

/**
 * A provider key owned by the cloud-import system: `lpr_*` keys
 * (org-managed providers) and the `ipollowork` hosted provider.
 * These keys are never hand-authored, so re-importing over an existing block
 * with one of these ids is a safe reconcile (recovers a lost import baseline)
 * rather than a clobber of a user's manual provider (#2346).
 */
export const isCloudManagedProviderKey = (providerId: string) =>
  /^lpr_/i.test(providerId) || providerId.trim() === "ipollowork";


export const getProviderModelIds = (
  provider: Pick<DenOrgLlmProvider, "models">,
) =>
  provider.models
    .flatMap((model) => {
      const id = model.id.trim();
      return id ? [id] : [];
    })
    .sort();

export const isCloudProviderOutOfSync = (
  provider: DenOrgLlmProvider,
  importedProvider: CloudImportedProvider,
) =>
  importedProvider.providerId !== getCloudManagedProviderId(provider) ||
  importedProvider.sourceProviderId !== provider.providerId ||
  (importedProvider.source ?? null) !== provider.source ||
  (importedProvider.updatedAt ?? null) !== (provider.updatedAt ?? null) ||
  !sameStringList(
    importedProvider.modelIds,
    // Normalize both sides: raw Den ids can include whitespace/empty values,
    // which otherwise made providers permanently out-of-sync.
    getProviderModelIds(provider),
  );
