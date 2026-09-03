/**
 * Shared wire contract for workspace records.
 *
 * Producers:
 * - ipollowork-server (apps/server): `GET /workspaces` and friends — emits plain
 *   optionals (never null) plus the `opencode*` engine credential fields.
 * - desktop Electron IPC bridge (apps/desktop main.mjs): emits explicit nulls
 *   and the desktop-managed `ipolloworkClientToken`/`ipolloworkHostToken`.
 *
 * Consumers (apps/app) must treat every optional field as possibly absent,
 * undefined, or null. Producer-side types assert assignability against this
 * shape (see apps/server/src/types.ts) so drift fails typecheck instead of
 * surfacing as runtime undefined-field bugs.
 */
export type WorkspaceKind = "local" | "remote";

export type WorkspaceRemoteKind = "opencode" | "ipollowork";

export const DEFAULT_ENGINE_ID = "opencode";
export const DEEPSEEK_HARNESS_ENGINE_ID = "deepseek-harness";
export const CODEX_HARNESS_ENGINE_ID = "codex-harness";
export const DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX = "<system>\n<!-- ipollowork-internal-context -->\n";

export type DeepSeekHarnessModelDirectory = {
  groups: ReadonlyArray<{
    id: string;
    models: ReadonlyArray<{ id: string }>;
  }>;
};

const DEEPSEEK_HARNESS_ACCOUNT_PROVIDER_IDS: Readonly<Record<string, string>> = {
  "kimi-coding": "kimi-for-coding",
  "openai-codex": "openai",
  "openai-codex-priority": "openai",
};

const DEEPSEEK_HARNESS_RUNTIME_PROVIDER_IDS: Readonly<Record<string, string>> = {
  "kimi-for-coding": "kimi-coding",
};

/** Resolve a DSH-specific route name back to the account provider identity. */
export function deepSeekHarnessAccountProviderId(providerId: string): string {
  const resolved = providerId.trim().toLowerCase();
  return DEEPSEEK_HARNESS_ACCOUNT_PROVIDER_IDS[resolved] ?? resolved;
}

/** Resolve an account provider identity to the equivalent DSH route name. */
export function deepSeekHarnessRuntimeProviderRouteId(providerId: string): string {
  const resolved = providerId.trim().toLowerCase();
  return DEEPSEEK_HARNESS_RUNTIME_PROVIDER_IDS[resolved] ?? resolved;
}

/** Resolve the account-level OpenAI provider to the concrete DSH runtime route. */
export function deepSeekHarnessRuntimeProviderId(
  providerId: string,
  modelId: string,
  directory: DeepSeekHarnessModelDirectory | null | undefined,
): string {
  if (providerId.trim().toLowerCase() !== "openai" || !directory) return providerId;
  const hasModel = (candidate: string) => directory.groups.some((group) => (
    group.id === candidate && group.models.some((model) => model.id === modelId)
  ));
  if (hasModel("openai")) return "openai";
  if (hasModel("openai-codex-priority")) return "openai-codex-priority";
  if (hasModel("openai-codex")) return "openai-codex";
  return providerId;
}

/**
 * DeepSeek Harness persists every prompt block in its history. iPolloWork marks
 * application-owned context before dispatch, then both the server snapshot and
 * live event adapter use this parser to keep it out of authored messages.
 */
export function stripDeepSeekHarnessInternalContext(value: string): string {
  let text = value;
  let start = text.indexOf(DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX);
  while (start !== -1) {
    const end = text.indexOf("</system>", start + DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX.length);
    text = end === -1
      ? text.slice(0, start)
      : `${text.slice(0, start)}${text.slice(end + "</system>".length)}`;
    start = text.indexOf(DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX);
  }
  return text;
}

export const BUILT_IN_WORKSPACE_ENGINE_IDS = [
  DEFAULT_ENGINE_ID,
  DEEPSEEK_HARNESS_ENGINE_ID,
  CODEX_HARNESS_ENGINE_ID,
] as const;

export type BuiltInWorkspaceEngineId = (typeof BUILT_IN_WORKSPACE_ENGINE_IDS)[number];

export function isBuiltInWorkspaceEngineId(value: unknown): value is BuiltInWorkspaceEngineId {
  return typeof value === "string" && BUILT_IN_WORKSPACE_ENGINE_IDS.includes(value as BuiltInWorkspaceEngineId);
}

export const HARNESS_WORKSPACE_ENGINE_IDS = [
  DEEPSEEK_HARNESS_ENGINE_ID,
  CODEX_HARNESS_ENGINE_ID,
] as const;

export type HarnessWorkspaceEngineId = (typeof HARNESS_WORKSPACE_ENGINE_IDS)[number];

export function isHarnessWorkspaceEngineId(value: unknown): value is HarnessWorkspaceEngineId {
  return typeof value === "string" && HARNESS_WORKSPACE_ENGINE_IDS.includes(value as HarnessWorkspaceEngineId);
}

export type WorkspaceWire = {
  id: string;
  name: string;
  path: string;
  preset: string;
  /** System workspace that owns conversations not assigned to a named project. */
  isDefault?: boolean | null;
  /** The owning application context. Missing/null records belong to Personal. */
  workContextId?: `enterprise:${string}` | null;
  workspaceType: WorkspaceKind;
  engineId?: string | null;
  remoteType?: WorkspaceRemoteKind | null;
  baseUrl?: string | null;
  directory?: string | null;
  displayName?: string | null;
  ipolloworkHostUrl?: string | null;
  ipolloworkToken?: string | null;
  /** Desktop IPC only: tokens for desktop-managed remote workspaces. */
  ipolloworkClientToken?: string | null;
  ipolloworkHostToken?: string | null;
  ipolloworkWorkspaceId?: string | null;
  ipolloworkWorkspaceName?: string | null;
  /**
   * Vocabulary differs per producer today ("docker" | "microsandbox" on the
   * desktop, "none" | "docker" | "container" in ipollowork-server), so the wire
   * stays a plain string until the backends converge.
   */
  sandboxBackend?: string | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
  /** ipollowork-server only: credentials for the proxied opencode engine. */
  opencodeUsername?: string | null;
  opencodePassword?: string | null;
  opencode?: {
    baseUrl?: string;
    directory?: string;
    username?: string;
    password?: string;
  } | null;
};
