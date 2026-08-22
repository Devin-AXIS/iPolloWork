/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { Download, HardDrive, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { formatBytes, isDesktopRuntime } from "@/app/utils";
import { publicAssetUrl } from "@/app/lib/public-asset";
import type { EnginePackageInfo } from "@/app/lib/desktop";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { useEnginePackages } from "@/react-app/domains/engines/use-engine-packages";
import { SettingsNotice, Spinner } from "../settings-section";
import { LayoutStack } from "../settings-layout";
import projectEngineDeepSeekIcon from "../../session/chat/assets/project-engine-deepseek.png";
import projectEngineOpenCodeIcon from "../../session/chat/assets/project-engine-opencode.svg";

function engineIcon(engineId: string) {
  if (engineId === "deepseek-harness") return projectEngineDeepSeekIcon;
  if (engineId === "codex-harness") return publicAssetUrl("ext-openai.svg");
  return projectEngineOpenCodeIcon;
}

function statusLabel(engine: EnginePackageInfo) {
  switch (engine.status) {
    case "downloading": return t("settings.engine_manager.status_downloading");
    case "verifying": return t("settings.engine_manager.status_verifying");
    case "installing": return t("settings.engine_manager.status_installing");
    case "uninstalling": return t("settings.engine_manager.status_uninstalling");
    case "failed": return t("settings.engine_manager.status_failed");
    case "ready": return t("settings.engine_manager.status_ready");
    default: return t("settings.engine_manager.status_not_installed");
  }
}

function sourceLabel(engine: EnginePackageInfo) {
  switch (engine.source) {
    case "bundled": return t("settings.engine_manager.source_bundled");
    case "downloaded": return t("settings.engine_manager.source_downloaded");
    case "desktop-client": return t("settings.engine_manager.source_desktop_client");
    case "system": return t("settings.engine_manager.source_system");
    case "custom": return t("settings.engine_manager.source_custom");
    default: return t("settings.engine_manager.source_none");
  }
}

function externalSourceNotice(engine: EnginePackageInfo) {
  switch (engine.source) {
    case "desktop-client":
      return t("settings.engine_manager.external_desktop_client_notice");
    case "system":
      return t("settings.engine_manager.external_system_notice", { name: engine.name });
    case "custom":
      return t("settings.engine_manager.external_custom_notice");
    default:
      return null;
  }
}

function hasManagedVersion(engine: EnginePackageInfo) {
  return !["desktop-client", "system", "custom"].includes(engine.source);
}

function EngineProgress({ engine }: { engine: EnginePackageInfo }) {
  const percent = engine.totalBytes && engine.downloadedBytes != null
    ? Math.min(100, Math.round((engine.downloadedBytes / engine.totalBytes) * 100))
    : null;
  return (
    <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
      <div className="h-1 overflow-hidden rounded-full bg-dls-hover">
        <div
          className={cn(
            "h-full rounded-full bg-foreground transition-[width] duration-300",
            percent == null && "w-1/3 animate-pulse",
          )}
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-dls-secondary">
        <span>{statusLabel(engine)}</span>
        {engine.downloadedBytes != null ? (
          <span className="tabular-nums">
            {formatBytes(engine.downloadedBytes)}
            {engine.totalBytes ? ` / ${formatBytes(engine.totalBytes)}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function EngineManagementView({ anyActiveRuns }: { anyActiveRuns: boolean }) {
  const { actionEngineId, install, loading, packages, uninstall } = useEnginePackages();
  const [removeEngineId, setRemoveEngineId] = useState<string | null>(null);
  const removeEngine = useMemo(
    () => packages.find((engine) => engine.id === removeEngineId) ?? null,
    [packages, removeEngineId],
  );

  if (!isDesktopRuntime()) {
    return (
      <LayoutStack>
        <SettingsNotice>{t("settings.engine_manager.desktop_only")}</SettingsNotice>
      </LayoutStack>
    );
  }

  if (loading && packages.length === 0) {
    return (
      <LayoutStack>
        <div className="flex items-center gap-2 rounded-2xl border border-dls-border bg-dls-card/70 px-5 py-8 text-sm text-dls-secondary">
          <Spinner className="size-4" />
          {t("settings.engine_manager.loading")}
        </div>
      </LayoutStack>
    );
  }

  return (
    <LayoutStack>
      <div className="overflow-hidden rounded-2xl border border-dls-border bg-dls-card/75 shadow-[var(--dls-card-shadow)] backdrop-blur-xl">
        {packages.map((engine, index) => {
          const busy = actionEngineId === engine.id
            || ["downloading", "verifying", "installing", "uninstalling"].includes(engine.status);
          const sourceNotice = externalSourceNotice(engine);
          return (
            <div
              key={engine.id}
              data-testid="engine-package-row"
              data-engine-id={engine.id}
              className={cn("px-5 py-4 md:px-6", index > 0 && "border-t border-dls-border")}
            >
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-background/70">
                  <img
                    src={engineIcon(engine.id)}
                    alt=""
                    className={cn("max-h-6 max-w-7 object-contain", engine.id !== "deepseek-harness" && "dark:invert")}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-sm font-semibold text-dls-text">{engine.name}</h3>
                    {engine.builtIn ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-3/70 px-2 py-0.5 text-[10px] font-medium text-emerald-11">
                        <ShieldCheck className="size-3" />
                        {t("settings.engine_manager.built_in")}
                      </span>
                    ) : null}
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      engine.status === "failed"
                        ? "bg-red-3/70 text-red-11"
                        : engine.installed
                          ? "bg-blue-3/70 text-blue-11"
                          : "bg-gray-4/70 text-gray-11",
                    )}>
                      {statusLabel(engine)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dls-secondary">
                    {hasManagedVersion(engine) ? <span>v{engine.version}</span> : null}
                    <span>{sourceLabel(engine)}</span>
                    {engine.installedBytes != null ? (
                      <span className="inline-flex items-center gap-1"><HardDrive className="size-3" />{formatBytes(engine.installedBytes)}</span>
                    ) : null}
                  </div>
                  {sourceNotice ? (
                    <p className="mt-2 max-w-2xl text-xs leading-5 text-dls-secondary">
                      {sourceNotice}
                    </p>
                  ) : null}
                  {busy ? <EngineProgress engine={engine} /> : null}
                  {engine.error ? <p className="mt-2 text-xs leading-5 text-red-11">{engine.error}</p> : null}
                </div>
                <div className="shrink-0">
                  {engine.canInstall ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        void install(engine.id).catch((error) => {
                          toast.error(error instanceof Error ? error.message : t("settings.engine_manager.install_failed"));
                        });
                      }}
                    >
                      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {t("settings.engine_manager.install")}
                    </Button>
                  ) : engine.canUninstall ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || anyActiveRuns}
                      title={anyActiveRuns ? t("settings.engine_manager.stop_tasks_before_uninstall") : undefined}
                      onClick={() => setRemoveEngineId(engine.id)}
                    >
                      <Trash2 className="size-4" />
                      {t("settings.engine_manager.uninstall")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-5 text-dls-secondary">
        {t("settings.engine_manager.data_retained")}
      </p>

      <ConfirmModal
        open={removeEngine != null}
        title={t("settings.engine_manager.uninstall_title", { name: removeEngine?.name ?? "" })}
        message={t("settings.engine_manager.uninstall_description")}
        confirmLabel={t("settings.engine_manager.uninstall")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onCancel={() => setRemoveEngineId(null)}
        onConfirm={() => {
          if (!removeEngine) return;
          const engineId = removeEngine.id;
          setRemoveEngineId(null);
          void uninstall(engineId).catch((error) => {
            toast.error(error instanceof Error ? error.message : t("settings.engine_manager.uninstall_failed"));
          });
        }}
      />
    </LayoutStack>
  );
}
