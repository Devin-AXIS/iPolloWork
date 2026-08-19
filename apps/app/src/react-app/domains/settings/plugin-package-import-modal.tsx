/** @jsxImportSource react */
import { useMemo, useRef, useState } from "react";
import { Archive, Bot, FileText, Loader2, Package, ShieldCheck, Upload } from "lucide-react";
import { PLUGIN_INSTALL_PACKAGE_EXTENSION } from "@ipollowork/types/plugins";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { currentLocale, t } from "@/i18n";
import type {
  iPolloWorkPluginPackageImportPreview,
  iPolloWorkPluginPackageUpload,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";

import { readPluginPackageArchive } from "@/app/lib/plugin-package-archive";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { formatPluginPlatformError, localizePluginPackageManifest } from "./plugin-platform-state";

type PluginPackageImportModalProps = {
  open: boolean;
  client: iPolloWorkServerClient;
  workspaceId: string;
  onClose: () => void;
  onInstalled: (pluginId: string) => void | Promise<void>;
};

export function PluginPackageImportModal(props: PluginPackageImportModalProps) {
  const locale = currentLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(0);
  const [upload, setUpload] = useState<iPolloWorkPluginPackageUpload | null>(null);
  const [preview, setPreview] = useState<iPolloWorkPluginPackageImportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "install" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downgradeConfirmationOpen, setDowngradeConfirmationOpen] = useState(false);

  const counts = useMemo(() => ({
    skills: preview?.manifest.resources.filter((resource) => resource.type === "skill").length ?? 0,
    agents: preview?.manifest.resources.filter((resource) => resource.type === "agent").length ?? 0,
    commands: preview?.manifest.resources.filter((resource) => resource.type === "command").length ?? 0,
    mcps: preview?.manifest.resources.filter((resource) => resource.type === "mcp").length ?? 0,
  }), [preview]);

  const reset = () => {
    setUpload(null);
    setPreview(null);
    setBusy(null);
    setError(null);
    setDowngradeConfirmationOpen(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    operationRef.current += 1;
    reset();
    props.onClose();
  };

  const previewFile = async (file: File) => {
    const operation = ++operationRef.current;
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      const nextUpload = await readPluginPackageArchive(
        file,
        "install",
        t("plugin_platform.import_invalid_extension"),
      );
      const response = await props.client.validatePluginPackageUpload(props.workspaceId, nextUpload);
      if (operationRef.current !== operation) return;
      setUpload(nextUpload);
      setPreview(response.preview);
    } catch (cause) {
      if (operationRef.current !== operation) return;
      setUpload(null);
      setError(formatPluginPlatformError(cause, t("plugin_platform.import_error")));
    } finally {
      if (operationRef.current === operation) setBusy(null);
    }
  };

  const install = async (allowDowngrade = false) => {
    if (!upload || !preview) return;
    const operation = ++operationRef.current;
    setBusy("install");
    setError(null);
    try {
      const response = await props.client.importPluginPackage(props.workspaceId, upload, { allowDowngrade });
      await props.onInstalled(response.result.pluginId);
      toast.success(t("plugin_platform.status.installed"));
      if (operationRef.current !== operation) return;
      reset();
      props.onClose();
    } catch (cause) {
      const message = formatPluginPlatformError(cause, t("plugin_platform.import_error"));
      toast.error(message);
      if (operationRef.current === operation) setError(message);
    } finally {
      if (operationRef.current === operation) setBusy(null);
    }
  };

  const isUpdate = preview?.installedVersion !== null && preview?.installedVersion !== undefined;
  const isDowngrade = preview?.versionChange === "downgrade";
  const previewManifest = preview ? localizePluginPackageManifest(preview.manifest, locale) : null;
  const signedSafety = preview?.safety.level === "signed" ? preview.safety : null;

  return (
    <>
      <Dialog open={props.open} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="flex max-h-[min(650px,calc(100dvh-160px))] min-h-0 w-full max-w-lg flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("plugin_platform.import_title")}</DialogTitle>
          <DialogDescription>{t("plugin_platform.import_description")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <input
            ref={inputRef}
            type="file"
            accept={PLUGIN_INSTALL_PACKAGE_EXTENSION}
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void previewFile(file);
            }}
          />

          <div className="rounded-2xl border border-dashed border-dls-border bg-dls-hover/30 p-5 text-center">
            <Archive size={26} className="mx-auto text-dls-secondary" />
            <p className="mt-3 text-sm font-medium text-dls-text">
              {upload?.archiveName ?? t("plugin_platform.import_choose_title")}
            </p>
            <p className="mt-1 text-xs leading-5 text-dls-secondary">{t("plugin_platform.import_choose_description")}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4"
              disabled={busy !== null}
              onClick={() => inputRef.current?.click()}
            >
              {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {preview ? t("plugin_platform.import_choose_another") : t("plugin_platform.import_choose")}
            </Button>
          </div>

          {preview && previewManifest ? (
            <div className="overflow-hidden rounded-2xl border border-dls-border">
              <div className="flex items-start gap-3 border-b border-dls-border px-4 py-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-dls-hover text-dls-secondary">
                  <Package size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-dls-text">{previewManifest.name}</span>
                    <span className="text-xs text-dls-secondary">v{previewManifest.package?.version}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-dls-secondary">{previewManifest.description}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-dls-border sm:grid-cols-4">
                {[
                  { Icon: FileText, label: t("plugin_platform.skills"), count: counts.skills },
                  { Icon: Bot, label: t("plugin_platform.import_agents"), count: counts.agents },
                  { Icon: FileText, label: t("plugin_platform.import_commands"), count: counts.commands },
                  { Icon: Archive, label: "MCP", count: counts.mcps },
                ].map(({ Icon, label, count }) => (
                  <div key={label} className="bg-dls-surface px-3 py-3 text-center">
                    <Icon size={15} className="mx-auto text-dls-secondary" />
                    <div className="mt-1 text-xs font-medium text-dls-text">{count}</div>
                    <div className="text-[10px] text-dls-secondary">{label}</div>
                  </div>
                ))}
              </div>
              <div className={`flex items-start gap-2 border-t px-4 py-3 text-xs leading-5 ${signedSafety ? "border-amber-6 bg-amber-2 text-amber-11" : "border-green-6 bg-green-2 text-green-11"}`}>
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <span>
                  {signedSafety
                    ? t("plugin_platform.import_signed_safety", { publisher: signedSafety.publisher.name })
                    : t("plugin_platform.import_safety")}
                </span>
              </div>
              {signedSafety && previewManifest.permissions?.length ? (
                <div className="border-t border-dls-border px-4 py-3">
                  <p className="text-xs font-medium text-dls-text">{t("plugin_platform.import_permissions")}</p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-5 text-dls-secondary">
                    {previewManifest.permissions.map((permission) => <li key={permission.id}>• {permission.reason}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <div role="alert" className="rounded-xl border border-red-6 bg-red-2 px-3 py-2 text-xs leading-5 text-red-11">{error}</div> : null}
        </div>

        <DialogFooter className="shrink-0">
          <DialogClose render={<Button variant="outline" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            disabled={!preview || busy !== null}
            onClick={() => {
              if (isDowngrade) {
                setDowngradeConfirmationOpen(true);
                return;
              }
              void install();
            }}
          >
            {busy === "install" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {isUpdate ? t("plugin_platform.action.update") : t("plugin_platform.import_install")}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmModal
        open={downgradeConfirmationOpen}
        title={t("plugin_platform.import_downgrade_title")}
        message={t("plugin_platform.import_downgrade_description", {
          currentVersion: preview?.installedVersion ?? "",
          incomingVersion: preview?.manifest.package?.version ?? "",
        })}
        confirmLabel={t("plugin_platform.import_downgrade_confirm")}
        cancelLabel={t("plugin_platform.import_downgrade_cancel")}
        variant="warning"
        onConfirm={() => {
          setDowngradeConfirmationOpen(false);
          void install(true);
        }}
        onCancel={() => setDowngradeConfirmationOpen(false)}
      />
    </>
  );
}
