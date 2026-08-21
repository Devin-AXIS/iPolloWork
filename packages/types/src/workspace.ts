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
export const CODEX_HARNESS_LEGACY_SYSTEM_MARKER = "Long-running local process rule:";
const CODEX_HARNESS_LEGACY_TEMPLATE_MARKERS = [
  "Multi-artifact delivery contract:",
  "Keep the template's visual language",
  "ipollowork-internal-context",
] as const;

/**
 * Codex turns created before application context was sent out-of-band stored
 * that context as text entries before the authored prompt. Keep old threads
 * readable without exposing the internal context in the conversation surface.
 */
export function visibleCodexHarnessUserText(entries: readonly string[]): string {
  let internalContextIndex = -1;
  entries.forEach((entry, index) => {
    if (
      entry.includes(CODEX_HARNESS_LEGACY_SYSTEM_MARKER)
      || CODEX_HARNESS_LEGACY_TEMPLATE_MARKERS.some((marker) => entry.includes(marker))
    ) internalContextIndex = index;
  });
  return entries
    .slice(internalContextIndex >= 0 ? internalContextIndex + 1 : 0)
    .join("\n");
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
