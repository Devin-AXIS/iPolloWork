/** @jsxImportSource react */
import type { ReactNode } from "react";
import { Package } from "lucide-react";

import type { iPolloWorkExtensionManifest } from "@/app/extensions";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";

type PluginPackageListItemProps = {
  manifest: iPolloWorkExtensionManifest;
  version: string;
  badge?: ReactNode;
  status?: ReactNode;
  actionLabel: ReactNode;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  featured?: boolean;
  compact?: boolean;
  onOpen?: () => void;
  onAction: () => void;
};

export function PluginPackageListItem({
  manifest,
  version,
  badge,
  status,
  actionLabel,
  actionBusy = false,
  actionDisabled = false,
  featured = false,
  compact = false,
  onOpen,
  onAction,
}: PluginPackageListItemProps) {
  const iconUrl = resolveExtensionIconUrl({
    pluginId: manifest.id,
    iconSrc: manifest.icon?.src,
    iconSlug: manifest.icon?.simpleIconSlug,
  });
  const skills = manifest.resources.filter((resource) => resource.type === "skill").length;
  const mcps = manifest.resources.filter((resource) => resource.type === "mcp").length;

  if (compact) {
    return (
      <div data-testid="plugin-package-list-item" className="flex h-[74px] min-w-0 items-center gap-4 rounded-[8px] bg-transparent px-4 py-2 transition-colors hover:bg-[#f6f7fb] focus-within:bg-[#f6f7fb] dark:hover:bg-dls-hover dark:focus-within:bg-dls-hover">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-4 rounded-lg text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          onClick={onOpen}
          disabled={!onOpen}
        >
          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[#f3f3f4] text-dls-secondary dark:bg-dls-hover">
            {iconUrl ? <img src={iconUrl} alt="" className="size-7 object-contain" /> : <Package size={18} />}
          </span>
          <span data-testid="plugin-package-card-copy" className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-ui-body font-semibold leading-5 tracking-[0.1px] text-dls-text">{manifest.name}</span>
            <span className="line-clamp-2 text-ui-caption leading-[15px] text-dls-secondary">{manifest.description}</span>
          </span>
        </button>
        <Button size="sm" variant="outline" className="shrink-0" disabled={actionBusy || actionDisabled} onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${featured ? "bg-blue-2/40" : ""}`}>
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen} disabled={!onOpen}>
        <span className={`flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[#f6f7fb] ${featured ? "border-blue-6 text-blue-11" : "border-dls-border text-dls-secondary"}`}>
          {iconUrl ? <img src={iconUrl} alt="" className="size-6 object-contain" /> : <Package size={19} />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-ui-body font-semibold text-dls-text">{manifest.name}</span>
            <span className="text-ui-caption text-dls-secondary">v{version}</span>
            {badge}
          </span>
          <span className="mt-1 line-clamp-2 block text-ui-compact text-dls-secondary">{manifest.description}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-ui-caption text-dls-secondary">
            <span>{t("plugin_platform.bundle_contents", { skills, mcps })}</span>
            {status ? <><span aria-hidden>·</span>{status}</> : null}
          </span>
        </span>
      </button>
      <Button size="sm" className="shrink-0" disabled={actionBusy || actionDisabled} onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
