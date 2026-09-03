import { useEffect, useState } from "react";

import type {
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { activePluginEngineCompatibility } from "@/app/lib/plugin-package-readiness";
import type { PluginContribution, PluginUiResource } from "@ipollowork/types/plugins";

export type PluginUiSurface = {
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  description: string;
  iconSrc: string | null;
  action: string | null;
  resource: PluginUiResource;
};

export type PluginConversationTemplate = {
  id: string;
  pluginId: string;
  label: string;
  description: string;
  prompt: string;
  mode: "work" | "code" | "design" | "video";
};

export type InstalledPluginContributions = {
  workspaceApps: PluginUiSurface[];
  settingsPages: PluginUiSurface[];
  conversationTemplates: PluginConversationTemplate[];
};

const EMPTY_CONTRIBUTIONS: InstalledPluginContributions = {
  workspaceApps: [],
  settingsPages: [],
  conversationTemplates: [],
};

export const PLUGIN_UI_CONTRIBUTIONS_CHANGED = "ipollowork:plugin-ui-contributions-changed";

export function notifyPluginUiContributionsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PLUGIN_UI_CONTRIBUTIONS_CHANGED));
  }
}

function contributionId(pluginId: string, contribution: PluginContribution, index: number) {
  return `${pluginId}:${contribution.type}:${contribution.ref ?? contribution.label ?? index}`;
}

function uiSurface(
  item: iPolloWorkPluginPackageItem,
  contribution: PluginContribution,
  index: number,
): PluginUiSurface | null {
  const resource = item.manifest.resources.find((entry) => (
    entry.type === "ui"
    && entry.id === contribution.ref
    && Boolean(entry.path && entry.ui)
    && !item.disabledResourceIds.includes(entry.id)
  ));
  if (!resource?.path || !resource.ui) return null;
  return {
    id: contributionId(item.pluginId, contribution, index),
    pluginId: item.pluginId,
    pluginName: item.name,
    label: contribution.label?.trim() || resource.label?.trim() || item.name,
    description: contribution.description?.trim() || resource.description?.trim() || item.manifest.description,
    iconSrc: item.manifest.icon?.src?.trim() || null,
    action: contribution.action?.trim() || null,
    resource: resource as PluginUiResource,
  };
}

export function resolveInstalledPluginContributions(
  items: iPolloWorkPluginPackageItem[],
): InstalledPluginContributions {
  const workspaceApps: PluginUiSurface[] = [];
  const settingsPages: PluginUiSurface[] = [];
  const conversationTemplates: PluginConversationTemplate[] = [];

  for (const item of items) {
    if (!item.enabled) continue;
    if (activePluginEngineCompatibility(item)?.status === "unsupported") continue;
    item.manifest.contributions?.forEach((contribution, index) => {
      if (contribution.type === "workspace-app" || contribution.type === "settings-page") {
        const surface = uiSurface(item, contribution, index);
        if (!surface) return;
        (contribution.type === "workspace-app" ? workspaceApps : settingsPages).push(surface);
        return;
      }
      if (contribution.type !== "conversation-template" || !contribution.prompt?.trim()) return;
      conversationTemplates.push({
        id: contributionId(item.pluginId, contribution, index),
        pluginId: item.pluginId,
        label: contribution.label?.trim() || item.name,
        description: contribution.description?.trim() || item.manifest.description,
        prompt: contribution.prompt.trim(),
        mode: contribution.mode ?? "work",
      });
    });
  }

  const byLabel = <Value extends { label: string }>(left: Value, right: Value) => left.label.localeCompare(right.label);
  return {
    workspaceApps: workspaceApps.sort(byLabel),
    settingsPages: settingsPages.sort(byLabel),
    conversationTemplates: conversationTemplates.sort(byLabel),
  };
}

export function useInstalledPluginContributions(
  client: iPolloWorkServerClient | null | undefined,
  workspaceId: string | null | undefined,
) {
  const [contributions, setContributions] = useState(EMPTY_CONTRIBUTIONS);

  useEffect(() => {
    if (!client || !workspaceId) {
      setContributions(EMPTY_CONTRIBUTIONS);
      return;
    }
    let active = true;
    const load = () => {
      void client.listPluginPackages(workspaceId)
        .then(({ items }) => {
          if (active) {
            setContributions(resolveInstalledPluginContributions(items));
          }
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener(PLUGIN_UI_CONTRIBUTIONS_CHANGED, load);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener(PLUGIN_UI_CONTRIBUTIONS_CHANGED, load);
      window.removeEventListener("focus", load);
    };
  }, [client, workspaceId]);

  return contributions;
}
