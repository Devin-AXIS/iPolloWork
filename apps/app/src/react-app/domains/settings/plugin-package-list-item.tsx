/** @jsxImportSource react */
import type { ReactNode } from "react";
import { Loader2, Package } from "lucide-react";

import type { iPolloWorkExtensionManifest } from "@/app/extensions";
import { Card, CardHeader, CardTitle, CardDescription, CardIcon, CardFooter, CardActionsMenu } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";

type PluginPackageListItemProps = {
  version: string;
  badge?: ReactNode;
  status?: ReactNode;
  actionLabel: ReactNode;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  menuItems?: ReactNode;
  featured?: boolean;
  onOpen?: () => void;
  onAction: () => void;
} & ({
  compact: true;
  manifest: Pick<iPolloWorkExtensionManifest, "id" | "name" | "description" | "icon">;
} | {
  compact?: false;
  manifest: iPolloWorkExtensionManifest;
});

export function PluginPackageListItem({
  manifest,
  version,
  badge,
  status,
  actionLabel,
  actionBusy = false,
  actionDisabled = false,
  menuItems,
  featured = false,
  compact,
  onOpen,
  onAction,
}: PluginPackageListItemProps) {
  const iconUrl = resolveExtensionIconUrl({
    pluginId: manifest.id,
    iconSrc: manifest.icon?.src,
    iconSlug: manifest.icon?.simpleIconSlug,
  });

  if (compact) {
    return (
      <Card variant="resource" layout="row" surface="plain" data-testid="plugin-package-list-item" title={`${manifest.name}${version ? ` · v${version}` : ""}`}>
        <CardHeader className="relative">
          {onOpen ? <button type="button" className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" onClick={onOpen}><span className="sr-only">{manifest.name}</span></button> : null}
          <CardIcon>{iconUrl ? <img src={iconUrl} alt="" /> : <Package />}</CardIcon>
          <div data-testid="plugin-package-card-copy" className="min-w-0 flex-1 space-y-1">
            <CardTitle as="h3" className="truncate">{manifest.name}</CardTitle>
            <CardDescription title={manifest.description} className="line-clamp-1">{manifest.description}</CardDescription>
          </div>
        </CardHeader>
        <CardFooter>
          <CardActionsMenu label={`${manifest.name}的操作`} disabled={actionBusy}>
            <DropdownMenuItem disabled={actionBusy || actionDisabled} onClick={onAction}>{actionBusy ? <Loader2 className="size-4 animate-spin" /> : null}{actionLabel}</DropdownMenuItem>
            {menuItems}
          </CardActionsMenu>
        </CardFooter>
      </Card>
    );
  }

  const skills = manifest.resources.filter((resource) => resource.type === "skill").length;
  const mcps = manifest.resources.filter((resource) => resource.type === "mcp").length;

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
    </div>
  );
}
