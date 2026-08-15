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
    iconSrc: manifest.icon?.src,
    iconSlug: manifest.icon?.simpleIconSlug,
  });
  const skills = manifest.resources.filter((resource) => resource.type === "skill").length;
  const mcps = manifest.resources.filter((resource) => resource.type === "mcp").length;

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-3 border-b border-dls-border py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          onClick={onOpen}
          disabled={!onOpen}
        >
          <span className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-dls-surface ${featured ? "border-blue-6 text-blue-11" : "border-dls-border text-dls-secondary"}`}>
            {iconUrl ? <img src={iconUrl} alt="" className="size-5 object-contain" /> : <Package size={17} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-dls-text">{manifest.name}</span>
              {badge}
            </span>
            <span className="mt-1 line-clamp-1 block text-xs text-dls-secondary">{manifest.description}</span>
            {status ? <span className="mt-1 block truncate text-[11px] text-dls-secondary">{status}</span> : null}
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
        <span className={`flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-dls-surface ${featured ? "border-blue-6 text-blue-11" : "border-dls-border text-dls-secondary"}`}>
          {iconUrl ? <img src={iconUrl} alt="" className="size-6 object-contain" /> : <Package size={19} />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-dls-text">{manifest.name}</span>
            <span className="text-[11px] text-dls-secondary">v{version}</span>
            {badge}
          </span>
          <span className="mt-1 line-clamp-2 block text-xs text-dls-secondary">{manifest.description}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
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
