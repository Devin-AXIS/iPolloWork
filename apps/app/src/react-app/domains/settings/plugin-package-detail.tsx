/** @jsxImportSource react */
import type { ReactNode } from "react";
import { ChevronRight, Package } from "lucide-react";

import { t } from "@/i18n";
import { settingsPageTitleClass, settingsStandardContentClass } from "@/react-app/domains/settings/shell/panel";

type PluginPackageDetailProps = {
  name: string;
  description: string;
  iconUrl?: string | null;
  action?: ReactNode;
  children: ReactNode;
  onBack: () => void;
};

export function PluginPackageDetail({
  name,
  description,
  iconUrl,
  action,
  children,
  onBack,
}: PluginPackageDetailProps) {
  return (
    <section className={settingsStandardContentClass}>
      <div className="pb-7 sm:pb-9">
        <nav className="mb-10 flex items-center gap-2 text-ui-control" aria-label={t("plugin_platform.breadcrumb_plugins")}>
          <button
            type="button"
            className="rounded-md px-1 py-0.5 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
            onClick={onBack}
          >
            {t("plugin_platform.breadcrumb_plugins")}
          </button>
          <ChevronRight size={15} className="text-dls-secondary/70" />
          <span className="font-medium text-dls-text">{name}</span>
        </nav>

        <div className="mb-8">
          <div className="relative mb-5 flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-dls-border bg-[#f6f7fb] shadow-sm">
            {iconUrl ? <img src={iconUrl} alt="" className="size-9 object-contain" /> : <Package size={28} className="text-dls-secondary" />}
          </div>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className={settingsPageTitleClass}>{name}</h2>
              <p className="settings-description mt-2 max-w-3xl text-ui-control leading-5 text-dls-secondary">{description}</p>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        </div>

        {children}
      </div>
    </section>
  );
}
