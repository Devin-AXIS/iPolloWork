import {
  sharedProviderDisconnectedIdsFromEnvKeys,
  sharedProviderIdFromCredentialEnvKey,
  sharedProviderIdFromDisconnectedEnvKey,
} from "@ipollowork/types/provider-credentials";

import { isReservedEnvKey } from "./env-file.js";

export type CompatibleProviderModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: Array<"text" | "image">;
};

export type CompatibleProviderRuntimeProfile = {
  providerId: string;
  displayName: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages";
  baseURL: string;
  models: CompatibleProviderModel[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function compatibleProtocol(provider: Record<string, unknown>): CompatibleProviderRuntimeProfile["api"] {
  const api = nonEmptyString(provider.api)?.toLowerCase();
  const npm = nonEmptyString(provider.npm)?.toLowerCase();
  if (api === "anthropic-messages" || npm?.includes("anthropic")) return "anthropic-messages";
  if (api === "openai-responses") return "openai-responses";
  return "openai-completions";
}

function compatibleBaseUrl(provider: Record<string, unknown>): string | undefined {
  const options = isRecord(provider.options) ? provider.options : {};
  const configured = nonEmptyString(options.baseURL)
    ?? nonEmptyString(provider.baseURL)
    ?? nonEmptyString(provider.api);
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function compatibleModels(value: unknown): CompatibleProviderModel[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([modelId, modelValue]) => {
    const id = modelId.trim();
    if (!id) return [];
    const model = isRecord(modelValue) ? modelValue : {};
    const limit = isRecord(model.limit) ? model.limit : {};
    const name = nonEmptyString(model.name);
    const contextWindow = positiveInteger(model.contextWindow) ?? positiveInteger(limit.context);
    const maxTokens = positiveInteger(model.maxTokens) ?? positiveInteger(limit.output);
    const modalities = isRecord(model.modalities) && Array.isArray(model.modalities.input)
      ? model.modalities.input.filter((entry): entry is "text" | "image" => entry === "text" || entry === "image")
      : [];
    return [{
      id,
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(modalities.length ? { input: [...new Set(modalities)] } : {}),
    }];
  });
}

/** Translate the account provider catalog into an engine-neutral runtime profile. */
export function compatibleProviderRuntimeProfiles(
  providers: unknown,
): Map<string, CompatibleProviderRuntimeProfile> {
  if (!isRecord(providers)) return new Map();
  return new Map(Object.entries(providers).flatMap(([providerId, providerValue]) => {
    const id = providerId.trim();
    if (!/^[a-z][a-z0-9._-]*$/u.test(id) || !isRecord(providerValue)) return [];
    const baseURL = compatibleBaseUrl(providerValue);
    const models = compatibleModels(providerValue.models);
    if (!baseURL || models.length === 0) return [];
    return [[id, {
      providerId: id,
      displayName: nonEmptyString(providerValue.name) ?? id,
      api: compatibleProtocol(providerValue),
      baseURL,
      models,
    }] as const];
  }));
}

export function sharedProviderApiCredentials(
  records: ReadonlyArray<{ key: string; value: string }>,
): Map<string, string> {
  const disconnected = new Set(
    sharedProviderDisconnectedIdsFromEnvKeys(records.map((record) => record.key)),
  );
  return new Map(records.flatMap((record) => {
    const providerId = sharedProviderIdFromCredentialEnvKey(record.key);
    const apiKey = record.value.trim();
    return providerId && apiKey && !disconnected.has(providerId)
      ? [[providerId, apiKey] as const]
      : [];
  }));
}

/** Forward user environment values while keeping provider secrets on references. */
export function sharedProviderChildEnvironment(
  records: ReadonlyArray<{ key: string; value: string }>,
): Record<string, string> {
  return Object.fromEntries(records
    .filter((entry) => (
      !isReservedEnvKey(entry.key)
      && !sharedProviderIdFromCredentialEnvKey(entry.key)
      && !sharedProviderIdFromDisconnectedEnvKey(entry.key)
    ))
    .map((entry) => [entry.key, entry.value]));
}
