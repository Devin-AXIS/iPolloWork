/** @jsxImportSource react */
import {
  createDefaultProjectWorkspaceConfig,
  projectWorkspaceConfigSchema,
  type ProjectAgent,
  type ProjectWorkspaceConfig,
} from "@ipollowork/types/project-workspace";
import {
  CODEX_HARNESS_ENGINE_ID,
  DEFAULT_ENGINE_ID,
  DEEPSEEK_HARNESS_ENGINE_ID,
} from "@ipollowork/types/workspace";

import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
} from "@/app/lib/ipollowork-server";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { MarbleAvatar } from "@/react-app/design-system/marble-avatar";

export function readProjectWorkspaceConfig(
  value: Record<string, unknown>,
  engineId: string | null | undefined,
): ProjectWorkspaceConfig {
  const parsed = projectWorkspaceConfigSchema.safeParse(value.project);
  if (parsed.success) return parsed.data;
  return createDefaultProjectWorkspaceConfig({
    engineId,
    agentName: t("project_overview.default_agent_name"),
    agentRole: t("project_overview.default_agent_role"),
  });
}

export function pluginNeedsConfiguration(
  item: iPolloWorkPluginPackageItem,
  authorization: iPolloWorkPluginAuthorizationState | undefined,
): boolean {
  if (!item.enabled) return true;
  const hasAuthorization = (item.manifest.authorization?.methods.length ?? 0) > 0;
  return hasAuthorization && authorization?.ready !== true;
}

export function engineLabel(engineId: string | null | undefined): string {
  if (engineId === CODEX_HARNESS_ENGINE_ID) return t("projects.engine_codex");
  if (engineId === DEEPSEEK_HARNESS_ENGINE_ID) return t("projects.engine_dsh");
  if (engineId === DEFAULT_ENGINE_ID) return t("projects.engine_opencode");
  return engineId?.trim() || t("project_overview.inherit_project");
}

export function AgentAvatar({ agent, className }: { agent: ProjectAgent; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 rounded-full bg-dls-surface p-0.5 shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.09]", className)}>
      <MarbleAvatar seed={agent.avatarSeed} className="size-full rounded-full" />
    </span>
  );
}
