/** @jsxImportSource react */
import type { ReactNode } from "react";
import { Loader2, Package } from "lucide-react";

import type { iPolloWorkExtensionManifest } from "@/app/extensions";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { SettingsResourceListItem } from "./settings-list";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";

type PluginPackageListItemProps = {
  manifest: iPolloWorkExtensionManifest;
  version: string;
  badge?: ReactNode;
  status?: ReactNode;
  actionLabel: ReactNode;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  secondaryAction?: ReactNode;
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
  secondaryAction,
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
    return <SettingsResourceListItem testId="plugin-package-list-item" copyTestId="plugin-package-card-copy"
      title={manifest.name} description={manifest.description} badge={badge} onOpen={onOpen}
      icon={iconUrl ? <img src={iconUrl} alt="" className="size-7 object-contain" /> : <Package size={18} />}
      metadata={<><span title={`v${version}`} className="min-w-0 max-w-full truncate">v{version}</span>{status ? <span className="inline-flex shrink-0 items-center whitespace-nowrap">{status}</span> : null}</>}
      actions={<><Button size="sm" variant="outline" className="shrink-0" aria-busy={actionBusy} disabled={actionBusy || actionDisabled} onClick={onAction}>
        {actionBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{actionLabel}
      </Button>{secondaryAction}</>} />;
  }

  return (
    <div className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${featured ? "bg-blue-2/40" : ""}`}>
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen} disabled={!onOpen}>
        <span className={`flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[#f6f7fb] ${featured ? "border-blue-6 text-blue-11" : "border-dls-border text-dls-secondary"}`}>
          {iconUrl ? <img src={iconUrl} alt="" className="size-6 object-contain" /> : <Package size={19} />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-ui-section-title font-semibold text-dls-text">{manifest.name}</span>
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
      <Button size="sm" className="shrink-0" aria-busy={actionBusy} disabled={actionBusy || actionDisabled} onClick={onAction}>
        {actionBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
        {actionLabel}
      </Button>
      {secondaryAction}
    </div>
  );
}
