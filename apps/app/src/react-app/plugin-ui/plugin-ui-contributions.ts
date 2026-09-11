import { useEffect, useState } from "react";

import type {
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { activePluginEngineCompatibility } from "@/app/lib/plugin-package-readiness";
import type { PluginContribution, PluginResource, PluginUiResource } from "@ipollowork/types/plugins";

export type PluginUiSurface = {
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  description: string;
  iconSrc: string | null;
  action: string | null;
  resource: PluginUiResource | (PluginResource & { type: "local-service" });
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
    && !activePluginEngineCompatibility(item)?.unsupportedResourceIds.includes(entry.id)
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
    // UI resources without an explicit placement still need a workbench entry.
    const placedResourceIds = new Set(item.manifest.contributions
      ?.filter((entry) => entry.type === "workspace-app" || entry.type === "settings-page")
      .map((entry) => entry.ref));
    for (const resource of item.manifest.resources) {
      if (resource.type !== "ui" || placedResourceIds.has(resource.id)) continue;
      const surface = uiSurface(item, { type: "workspace-app", ref: resource.id }, 0);
      if (surface) workspaceApps.push(surface);
    }
    // Some packages serve their workbench from a local service instead of a UI resource.
    // Prefer their UI when one exists, so each workbench has only one launcher.
    if (!item.manifest.resources.some((resource) => resource.type === "ui" && resource.path && resource.ui)) {
      const service = item.manifest.resources.find((resource) => resource.type === "local-service"
        && !item.disabledResourceIds.includes(resource.id)
        && !activePluginEngineCompatibility(item)?.unsupportedResourceIds.includes(resource.id)
        && resource.actions?.some((action) => action.id === "open-workbench"));
      if (service?.type === "local-service") {
        workspaceApps.push({
          id: `${item.pluginId}:workspace-app:${service.id}`,
          pluginId: item.pluginId, pluginName: item.name, label: item.name,
          description: item.manifest.description, iconSrc: item.manifest.icon?.src?.trim() || null,
          action: "open-workbench", resource: { ...service, type: "local-service" },
        });
      }
    }
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
