/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLUGIN_SOURCE_ARCHIVE_EXTENSION } from "@ipollowork/types/plugins";
import {
  Blocks,
  ChevronDown,
  CircleAlert,
  Download,
  FileArchive,
  Loader2,
  PackageCheck,
  RefreshCw,
  Upload,
} from "lucide-react";
import { downloadBlobAsFile } from "@/app/lib/download";
import { readPluginPackageArchive } from "@/app/lib/plugin-package-archive";
import {
  iPolloWorkServerError,
  type iPolloWorkPluginPackageUpload,
  type iPolloWorkPluginUiResource,
  type iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { notifyPluginUiContributionsChanged, type PluginUiSurface } from "@/react-app/plugin-ui/plugin-ui-contributions";
import { WorkspaceAppFrame, type WorkspaceAppModelContext } from "@/react-app/plugin-ui/workspace-app-frame";
import type {
  PluginWorkshopExportFormat,
  PluginWorkshopProjectSnapshot,
  PluginWorkshopProjectSummary,
} from "@ipollowork/types/plugins";

import { usePanelTabStore, type PluginStudioPanelTab } from "../panel/panel-tab-store";
import {
  findNewPluginWorkshopProjectId,
  pluginWorkshopProjectIdsFromPaths,
} from "./plugin-workshop-contract";

type PluginWorkshopPanelProps = {
  tab: PluginStudioPanelTab;
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  aiEditing: boolean;
  expanded: boolean;
  onSendMessage?: (input: { text: string; modelContext: WorkspaceAppModelContext | null }) => boolean | Promise<boolean>;
};

type PendingPluginWorkshopImport = {
  upload: iPolloWorkPluginPackageUpload;
  directoryId: string | null;
};

const AI_REPAIR_DEBOUNCE_MS = 600;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("plugin_workshop.operation_failed");
}

function workshopSurface(snapshot: PluginWorkshopProjectSnapshot): PluginUiSurface | null {
  if (!snapshot.ui || !snapshot.project.manifest) return null;
  const manifest = snapshot.project.manifest;
  const contribution = manifest.contributions?.find((entry) => (
    entry.type === "workspace-app" && (!entry.ref || entry.ref === snapshot.ui?.resource.id)
  ));
  if (!contribution) return null;
  return {
    id: `${manifest.id}:plugin-workshop:${snapshot.ui.resource.id}`,
    pluginId: manifest.id,
    pluginName: manifest.name,
    label: contribution?.label?.trim() || snapshot.ui.resource.label?.trim() || manifest.name,
    description: contribution?.description?.trim() || snapshot.ui.resource.description?.trim() || manifest.description,
    iconSrc: manifest.icon?.src?.trim() || null,
    action: contribution?.action?.trim() || null,
    resource: snapshot.ui.resource,
  };
}

function canPrepareStaticNetworkDraft(snapshot: PluginWorkshopProjectSnapshot | null): boolean {
  const manifest = snapshot?.project.manifest;
  if (!manifest || manifest.source.trusted || manifest.package?.checksum || manifest.package?.signature) return false;
  if ((manifest.authorization?.methods.length ?? 0) > 0) return false;
  if (!(manifest.permissions ?? []).every((permission) => permission.id === "network")) return false;
  const declarativeTypes = new Set(["skill", "agent", "command", "file", "ui"]);
  if (!manifest.resources.every((resource) => declarativeTypes.has(resource.type))) return false;
  let hasRemoteStaticResources = false;
  for (const resource of manifest.resources) {
    if (resource.type !== "ui" || !resource.ui) continue;
    const csp = resource.ui.csp;
    hasRemoteStaticResources ||= Boolean(csp?.resourceDomains?.length);
    if (csp?.connectDomains?.length || csp?.frameDomains?.length || csp?.baseUriDomains?.length) return false;
    if (resource.ui.permissions && Object.keys(resource.ui.permissions).length > 0) return false;
  }
  return hasRemoteStaticResources;
}

function PluginWorkshopBlankState(props: {
  importing: boolean;
  projects: PluginWorkshopProjectSummary[];
  onImport: () => void;
  onSelectProject: (project: PluginWorkshopProjectSummary) => void;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-background px-6 py-10" data-testid="plugin-workshop-empty">
      <section className="w-full max-w-xl">
        <h2 className="text-base font-semibold tracking-[-0.2px] text-foreground">{t("plugin_workshop.title")}</h2>
        <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
          {t("plugin_workshop.blank_description")}
        </p>
        {props.projects.length ? (
          <Select
            value=""
            onValueChange={(directoryId) => {
              const project = props.projects.find((entry) => entry.directoryId === directoryId);
              if (project) props.onSelectProject(project);
            }}
          >
            <SelectTrigger className="mt-6 w-full" aria-label={t("plugin_workshop.select_plugin")}>
              <SelectValue placeholder={t("plugin_workshop.select_plugin_placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {props.projects.map((project) => (
                <SelectItem key={project.directoryId} value={project.directoryId}>
                  {project.manifest?.name ?? project.directoryId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button type="button" variant="default" size="sm" className="rounded-lg" disabled={props.importing} onClick={props.onImport}>
            {props.importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t("plugin_workshop.import_source")}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">{t("plugin_workshop.import_source_hint")}</p>
        </div>
      </section>
    </div>
  );
}

export function PluginWorkshopPanel(props: PluginWorkshopPanelProps) {
  const openTab = usePanelTabStore((state) => state.openTab);
  const transcriptTargets = usePanelTabStore(
    (state) => state.transcriptArtifactTargets[props.tab.sessionId],
  );
  const [projects, setProjects] = useState<PluginWorkshopProjectSummary[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<PluginWorkshopProjectSnapshot | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"install" | "export" | "import" | "refresh" | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingPluginWorkshopImport | null>(null);
  const [repairRequestLocked, setRepairRequestLocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const revisionRef = useRef("");
  const snapshotRequestGenerationRef = useRef(0);
  const baselineProjectIdsRef = useRef<Set<string> | null>(
    props.tab.creationBaselinePluginIds
      ? new Set(props.tab.creationBaselinePluginIds)
      : null,
  );
  const importInputRef = useRef<HTMLInputElement>(null);
  const aiEditingRef = useRef(props.aiEditing);
  const repairRequestLockedRef = useRef(false);
  const repairDebounceTimerRef = useRef<number | null>(null);
  aiEditingRef.current = props.aiEditing;
  const selectedProject = projects.find((project) => project.directoryId === props.tab.pluginId);
  const conversationProjectIds = useMemo(
    () => pluginWorkshopProjectIdsFromPaths((transcriptTargets ?? []).map((target) => target.value)),
    [transcriptTargets],
  );

  const selectProject = useCallback((project: PluginWorkshopProjectSummary | undefined) => {
    const pluginId = project?.directoryId;
    const label = project?.manifest?.name?.trim() || project?.directoryId || props.tab.label;
    if (props.tab.pluginId === pluginId && props.tab.label === label) return;
    openTab(props.tab.sessionId, { ...props.tab, label, pluginId });
  }, [openTab, props.tab]);

  const refreshProjects = useCallback(async () => {
    const response = await props.client.listPluginWorkshopProjects(props.workspaceId);
    const currentIds = new Set(response.items.map((project) => project.directoryId));
    const baselineIds = baselineProjectIdsRef.current;
    baselineProjectIdsRef.current ??= currentIds;
    setProjects(response.items);
    setProjectsLoaded(true);
    if (props.tab.pluginId) {
      const project = response.items.find((item) => item.directoryId === props.tab.pluginId);
      if (!project) baselineProjectIdsRef.current = currentIds;
      selectProject(project);
      return;
    }
    const panelSessions = Object.values(usePanelTabStore.getState().sessions);
    const workshopTabs = panelSessions.flatMap((session) => session.tabs).filter(
      (tab): tab is PluginStudioPanelTab => tab.type === "plugin-studio",
    );
    const claimedIds = new Set(workshopTabs.flatMap((tab) => tab.pluginId ? [tab.pluginId] : []));
    const newProjectId = findNewPluginWorkshopProjectId(
      baselineIds,
      response.items.map((project) => project.directoryId),
      {
        preferredIds: conversationProjectIds,
        claimedIds,
        allowUnlinked: workshopTabs.filter((tab) => !tab.pluginId).length <= 1,
      },
    );
    if (newProjectId) selectProject(response.items.find((project) => project.directoryId === newProjectId));
  }, [conversationProjectIds, props.client, props.tab.pluginId, props.workspaceId, selectProject]);

  const validateProject = useCallback(async (project: PluginWorkshopProjectSummary) => {
    try {
      const [, installed] = await Promise.all([
        props.client.validatePluginPackage(props.workspaceId, project.packageRoot),
        props.client.listPluginPackages(props.workspaceId),
      ]);
      setValidationError(null);
      setInstalledVersion(installed.items.find((item) => item.pluginId === project.manifest?.id)?.version ?? null);
    } catch (error) {
      setValidationError(errorMessage(error));
      setInstalledVersion(null);
    }
  }, [props.client, props.workspaceId]);

  const refreshSnapshot = useCallback(async (force = false) => {
    const pluginId = props.tab.pluginId;
    if (!pluginId) {
      revisionRef.current = "";
      setSnapshot(null);
      setValidationError(null);
      return;
    }
    const requestGeneration = snapshotRequestGenerationRef.current;
    const next = await props.client.getPluginWorkshopProject(props.workspaceId, pluginId);
    if (requestGeneration !== snapshotRequestGenerationRef.current) return;
    if (!force && next.revision === revisionRef.current) return;
    revisionRef.current = next.revision;
    setSnapshot(next);
    setLoadError(null);
    await validateProject(next.project);
  }, [props.client, props.tab.pluginId, props.workspaceId, validateProject]);

  const refreshAll = useCallback(async () => {
    setBusyAction("refresh");
    setLoadError(null);
    try {
      await refreshProjects();
      await refreshSnapshot(true);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }, [refreshProjects, refreshSnapshot]);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        await refreshProjects();
      } catch (error) {
        if (active) setLoadError(errorMessage(error));
      } finally {
        if (active) timer = window.setTimeout(poll, aiEditingRef.current ? 1_000 : 5_000);
      }
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [refreshProjects]);

  useEffect(() => {
    snapshotRequestGenerationRef.current += 1;
    revisionRef.current = "";
    setSnapshot(null);
    if (!props.tab.pluginId) return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        await refreshSnapshot();
      } catch (error) {
        if (active) {
          setSnapshot(null);
          setValidationError(errorMessage(error));
        }
      } finally {
        if (active) timer = window.setTimeout(poll, aiEditingRef.current ? 800 : 3_000);
      }
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [props.tab.pluginId, refreshSnapshot]);

  useEffect(() => () => {
    if (repairDebounceTimerRef.current !== null) {
      window.clearTimeout(repairDebounceTimerRef.current);
    }
  }, []);

  const surface = useMemo(() => snapshot ? workshopSurface(snapshot) : null, [snapshot]);
  const resourceOverride = useMemo<iPolloWorkPluginUiResource | undefined>(() => {
    if (!snapshot?.ui || !snapshot.project.manifest) return undefined;
    return {
      pluginId: snapshot.project.manifest.id,
      version: snapshot.project.manifest.package?.version ?? "0.0.0",
      resource: snapshot.ui.resource,
      html: snapshot.ui.html,
    };
  }, [snapshot]);
  const developmentPreview = useMemo(
    () => snapshot ? { revision: snapshot.revision } : undefined,
    [snapshot?.revision],
  );
  const previewRuntimeKey = snapshot ? `${snapshot.project.directoryId}:${snapshot.revision}` : "";
  const studioContractError = snapshot && !surface
    ? t("plugin_workshop.studio_contract_error")
    : null;
  const autoPreparationCandidate = canPrepareStaticNetworkDraft(snapshot);
  const diagnostic = (autoPreparationCandidate ? null : validationError) || loadError || selectedProject?.error || studioContractError;

  const installProject = async () => {
    if (!snapshot?.project.manifest) return;
    setBusyAction("install");
    try {
      const bundle = await props.client.exportPluginWorkshopProject(props.workspaceId, snapshot.project.directoryId);
      const upload = {
        archiveName: `${bundle.pluginId}-${bundle.version}.ipollowork-plugin`,
        files: bundle.files,
      };
      const [checked, installed] = await Promise.all([
        props.client.validatePluginPackageUpload(props.workspaceId, upload),
        props.client.listPluginPackages(props.workspaceId),
      ]);
      const current = installed.items.find((item) => item.pluginId === snapshot.project.manifest?.id);
      const nextVersion = snapshot.project.manifest.package?.version ?? "";
      if (current?.version === nextVersion && current.integrity.sha256 !== checked.preview.integrity.sha256) {
        throw new Error(t("plugin_workshop.version_already_installed", { version: nextVersion }));
      }
      if (current && current.integrity.sha256 === checked.preview.integrity.sha256) {
        toast.success(t("plugin_workshop.already_installed"));
      } else {
        const result = await props.client.importPluginPackage(props.workspaceId, upload);
        toast.success(result.result.status === "updated"
          ? t("plugin_workshop.updated", { name: snapshot.project.manifest.name })
          : t("plugin_workshop.installed", { name: snapshot.project.manifest.name }), {
          description: bundle.preparation.localizedUrls.length
            ? t("plugin_workshop.prepared_resources", { count: bundle.preparation.localizedUrls.length })
            : undefined,
        });
      }
      setValidationError(null);
      setInstalledVersion(nextVersion || null);
      notifyPluginUiContributionsChanged();
    } catch (error) {
      toast.error(t("plugin_workshop.install_failed"), { description: errorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const exportProject = async (format: PluginWorkshopExportFormat) => {
    if (!props.tab.pluginId) return;
    setBusyAction("export");
    try {
      const [{ default: JSZip }, bundle] = await Promise.all([
        import("jszip"),
        props.client.exportPluginWorkshopProject(props.workspaceId, props.tab.pluginId, format),
      ]);
      const archive = new JSZip();
      bundle.files.forEach((file) => archive.file(file.path, file.contentBase64, { base64: true }));
      const blob = await archive.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const installPackage = format === "install";
      downloadBlobAsFile(
        installPackage
          ? `${bundle.pluginId}-${bundle.version}.ipollowork-plugin`
          : `${bundle.pluginId}-${bundle.version}-source.zip`,
        blob,
      );
      toast.success(installPackage ? t("plugin_workshop.exported_package") : t("plugin_workshop.exported_source"), {
        description: installPackage
          ? bundle.preparation.localizedUrls.length
            ? t("plugin_workshop.exported_prepared_resources", { count: bundle.preparation.localizedUrls.length })
            : t("plugin_workshop.exported_package_hint")
          : t("plugin_workshop.exported_source_hint"),
      });
    } catch (error) {
      toast.error(t("plugin_workshop.export_failed"), { description: errorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const applyImport = async (upload: iPolloWorkPluginPackageUpload, overwrite: boolean) => {
    snapshotRequestGenerationRef.current += 1;
    const imported = await props.client.importPluginWorkshopProject(
      props.workspaceId,
      upload,
      overwrite ? { overwrite: true } : undefined,
    );
    snapshotRequestGenerationRef.current += 1;
    revisionRef.current = imported.revision;
    setSnapshot(imported);
    selectProject(imported.project);
    await validateProject(imported.project);
    await refreshProjects();
    const importedName = imported.project.manifest?.name ?? imported.project.directoryId;
    toast.success(overwrite
      ? t("plugin_workshop.overwritten", { name: importedName })
      : t("plugin_workshop.imported", { name: importedName }));
  };

  const showImportError = (error: unknown) => {
    const message = errorMessage(error);
    setLoadError(message);
    toast.error(t("plugin_workshop.import_failed"), { description: message });
  };

  const importProject = async (file: File) => {
    setBusyAction("import");
    setLoadError(null);
    let upload: iPolloWorkPluginPackageUpload | null = null;
    try {
      upload = await readPluginPackageArchive(file, "source", t("plugin_workshop.source_archive_only"));
      await applyImport(upload, false);
    } catch (error) {
      if (upload && error instanceof iPolloWorkServerError && error.code === "plugin_workshop_project_exists") {
        const details = error.details;
        const directoryId = typeof details === "object"
          && details !== null
          && "directoryId" in details
          && typeof details.directoryId === "string"
          ? details.directoryId
          : null;
        setPendingImport({ upload, directoryId });
      } else {
        showImportError(error);
      }
    } finally {
      setBusyAction(null);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const overwritePendingImport = async () => {
    if (!pendingImport) return;
    const upload = pendingImport.upload;
    setPendingImport(null);
    setBusyAction("import");
    setLoadError(null);
    try {
      await applyImport(upload, true);
    } catch (error) {
      showImportError(error);
    } finally {
      setBusyAction(null);
    }
  };

  const askAiToRepair = useCallback(() => {
    if (
      !props.tab.pluginId
      || !props.onSendMessage
      || props.aiEditing
      || repairRequestLockedRef.current
    ) return;

    repairRequestLockedRef.current = true;
    setRepairRequestLocked(true);
    repairDebounceTimerRef.current = window.setTimeout(() => {
      repairRequestLockedRef.current = false;
      repairDebounceTimerRef.current = null;
      setRepairRequestLocked(false);
    }, AI_REPAIR_DEBOUNCE_MS);

    const issue = diagnostic || t("plugin_workshop.repair_default_issue");
    void props.onSendMessage({
      text: t("plugin_workshop.repair_prompt", { pluginId: props.tab.pluginId, issue }),
      modelContext: null,
    });
  }, [diagnostic, props.aiEditing, props.onSendMessage, props.tab.pluginId]);

  const importInput = (
    <input
      ref={importInputRef}
      type="file"
      accept={PLUGIN_SOURCE_ARCHIVE_EXTENSION}
      className="sr-only"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void importProject(file);
      }}
    />
  );
  const overwriteImportDialog = (
    <ConfirmModal
      open={pendingImport !== null}
      title={t("plugin_workshop.overwrite_title")}
      message={pendingImport?.directoryId
        ? t("plugin_workshop.overwrite_existing", { directory: pendingImport.directoryId })
        : t("plugin_workshop.overwrite_same_name")}
      confirmLabel={t("plugin_workshop.overwrite_confirm")}
      cancelLabel={t("plugin_workshop.overwrite_cancel")}
      variant="danger"
      onConfirm={() => void overwritePendingImport()}
      onCancel={() => setPendingImport(null)}
    />
  );

  if (!projectsLoaded && !loadError) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />{t("plugin_workshop.preparing")}</div>;
  }

  if (!selectedProject) {
    return (
      <>
        {importInput}
        {overwriteImportDialog}
        <PluginWorkshopBlankState
          importing={busyAction === "import"}
          projects={projects}
          onImport={() => importInputRef.current?.click()}
          onSelectProject={selectProject}
        />
      </>
    );
  }

  return (
    <>
      {overwriteImportDialog}
      <div className="flex h-full min-h-0 flex-col bg-background" data-testid="plugin-workshop-studio">
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Select
          value={selectedProject?.directoryId ?? ""}
          onValueChange={(directoryId) => selectProject(projects.find((project) => project.directoryId === directoryId))}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={t("plugin_workshop.select_plugin")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {projects.map((project) => <SelectItem key={project.directoryId} value={project.directoryId}>{project.manifest?.name ?? project.directoryId}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" onClick={() => void refreshAll()} disabled={busyAction !== null} aria-label={t("plugin_workshop.refresh_preview")} title={t("plugin_workshop.refresh")}>
          <RefreshCw className={cn("size-4", busyAction === "refresh" && "animate-spin")} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button variant="outline" size="sm" disabled={!props.tab.pluginId || busyAction !== null}>
                {busyAction === "export" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                {t("plugin_workshop.export")}
                <ChevronDown className="size-3.5" />
              </Button>
            )}
          />
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => void exportProject("install")}>
              <PackageCheck />
              <span className="flex min-w-0 flex-col">
                <span>{t("plugin_workshop.package_label")}</span>
                <span className="text-xs font-normal text-muted-foreground">{t("plugin_workshop.package_hint")}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void exportProject("source")}>
              <FileArchive />
              <span className="flex min-w-0 flex-col">
                <span>{t("plugin_workshop.source_label")}</span>
                <span className="text-xs font-normal text-muted-foreground">{t("plugin_workshop.source_hint")}</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={() => void installProject()} disabled={!snapshot?.project.manifest || !surface || busyAction !== null}>
          {busyAction === "install" ? <Loader2 className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}
          {installedVersion ? t("plugin_workshop.update") : t("plugin_workshop.install")}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/20">
        {surface && resourceOverride ? (
          <WorkspaceAppFrame
            key={previewRuntimeKey}
            surface={surface}
            client={props.client}
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            sessionId={props.tab.sessionId}
            placement="workspace"
            displayMode={props.expanded ? "fullscreen" : "inline"}
            onSendMessage={props.onSendMessage}
            resourceOverride={resourceOverride}
            developmentPreview={developmentPreview}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <Blocks className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-medium">{t("plugin_workshop.no_preview_title")}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("plugin_workshop.no_preview_description")}</p>
            </div>
          </div>
        )}
      </div>

      {diagnostic ? (
        <div className="shrink-0 border-t border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <p className="min-w-0 flex-1 break-words">{diagnostic}</p>
            {props.onSendMessage ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={askAiToRepair}
                disabled={repairRequestLocked || props.aiEditing}
                aria-busy={repairRequestLocked || props.aiEditing}
              >
                {t("plugin_workshop.repair")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted-foreground">
          <span>{t("plugin_workshop.resource_count", { count: snapshot?.project.manifest?.resources.length ?? 0 })}</span>
          <span>v{snapshot?.project.manifest?.package?.version ?? "0.0.0"}</span>
          <span>{installedVersion ? t("plugin_workshop.installed_version", { version: installedVersion }) : t("plugin_workshop.not_installed")}</span>
          <span className="ml-auto">{t("plugin_workshop.selected_hint")}</span>
        </div>
      )}
      </div>
    </>
  );
}
