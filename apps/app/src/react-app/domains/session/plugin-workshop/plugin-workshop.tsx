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
  Sparkles,
  Upload,
  WandSparkles,
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
import { toast } from "@/components/ui/sonner";
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

const PLUGIN_WORKSHOP_CAPABILITIES = [
  { Icon: Blocks, label: "Studio" },
  { Icon: Sparkles, label: "Skills" },
  { Icon: WandSparkles, label: "MCP Server" },
];

const AI_REPAIR_DEBOUNCE_MS = 600;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "插件工坊操作失败";
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
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-background px-8 py-16 text-center" data-testid="plugin-workshop-empty">
      <div className="max-w-md">
        <div className="text-[28px] font-medium tracking-[-1.4px] text-foreground">iPollo Work</div>
        <h2 className="mt-1 text-[42px] font-black leading-none tracking-[-3px] text-foreground">把想法变成成果</h2>
        <p className="mx-auto mt-7 max-w-sm text-sm leading-6 text-muted-foreground">
          在左侧告诉 AI 你想做什么插件。Studio、MCP Server、Skills 和脚本会统一生成到当前项目的插件目录中。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
          {PLUGIN_WORKSHOP_CAPABILITIES.map(({ Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5">
              <Icon className="size-3.5" />{label}
            </span>
          ))}
        </div>
        {props.projects.length ? (
          <select
            defaultValue=""
            className="mt-8 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="选择要试用的插件"
            onChange={(event) => {
              const project = props.projects.find((entry) => entry.directoryId === event.currentTarget.value);
              if (project) props.onSelectProject(project);
            }}
          >
            <option value="" disabled>选择要制作或试用的插件…</option>
            {props.projects.map((project) => (
              <option key={project.directoryId} value={project.directoryId}>
                {project.manifest?.name ?? project.directoryId}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="button" variant="outline" className="mt-8 rounded-xl" disabled={props.importing} onClick={props.onImport}>
          {props.importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          导入插件源码
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">选择 .zip 源码压缩包，导入后可继续通过 AI 修改。</p>
      </div>
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
    ? "插件需要在 manifest 中声明指向 UI resource 的 workspace-app contribution。"
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
        throw new Error(`版本 ${nextVersion} 已安装。请让 AI 递增 manifest 的语义版本后再更新。`);
      }
      if (current && current.integrity.sha256 === checked.preview.integrity.sha256) {
        toast.success("当前插件版本已经安装");
      } else {
        const result = await props.client.importPluginPackage(props.workspaceId, upload);
        toast.success(result.result.status === "updated"
          ? `已更新 ${snapshot.project.manifest.name}`
          : `已安装 ${snapshot.project.manifest.name}`, {
          description: bundle.preparation.localizedUrls.length
            ? `已自动内联 ${bundle.preparation.localizedUrls.length} 个远程静态资源并移除运行时网络权限。`
            : undefined,
        });
      }
      setValidationError(null);
      setInstalledVersion(nextVersion || null);
      notifyPluginUiContributionsChanged();
    } catch (error) {
      toast.error("无法安装插件", { description: errorMessage(error) });
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
      toast.success(installPackage ? "iPollo 插件包已导出" : "插件源码 ZIP 已导出", {
        description: installPackage
          ? bundle.preparation.localizedUrls.length
            ? `已自动内联 ${bundle.preparation.localizedUrls.length} 个远程静态资源，插件包可离线安装运行。`
            : "可直接导入 iPolloWork 安装。"
          : "保留当前插件目录的原始源码，可再次导入插件工坊继续编辑。",
      });
    } catch (error) {
      toast.error("无法导出插件", { description: errorMessage(error) });
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
    toast.success(overwrite
      ? `已覆盖导入 ${imported.project.manifest?.name ?? imported.project.directoryId}`
      : `已导入 ${imported.project.manifest?.name ?? imported.project.directoryId}`);
  };

  const showImportError = (error: unknown) => {
    const message = errorMessage(error);
    setLoadError(message);
    toast.error("无法导入插件", { description: message });
  };

  const importProject = async (file: File) => {
    setBusyAction("import");
    setLoadError(null);
    let upload: iPolloWorkPluginPackageUpload | null = null;
    try {
      upload = await readPluginPackageArchive(file, "source", "插件工坊只能导入 .zip 源码压缩包。");
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

    const issue = diagnostic || "检查 manifest、Studio UI 和所有资源引用，并修复发现的问题。";
    void props.onSendMessage({
      text: `请检查并修复 plugins/${props.tab.pluginId}/ 插件。当前诊断：${issue}`,
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
      title="覆盖现有插件源码？"
      message={pendingImport?.directoryId
        ? `plugins/${pendingImport.directoryId} 已存在。覆盖后，该目录会被压缩包中的源码完整替换，现有未导出的修改将丢失。`
        : "同名插件源码已经存在。覆盖后，现有目录会被压缩包中的源码完整替换，未导出的修改将丢失。"}
      confirmLabel="覆盖导入"
      cancelLabel="取消导入"
      variant="danger"
      onConfirm={() => void overwritePendingImport()}
      onCancel={() => setPendingImport(null)}
    />
  );

  if (!projectsLoaded && !loadError) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在准备插件工坊…</div>;
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
        <select
          value={selectedProject?.directoryId ?? ""}
          onChange={(event) => selectProject(projects.find((project) => project.directoryId === event.currentTarget.value))}
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          aria-label="选择要试用的插件"
        >
          {projects.map((project) => <option key={project.directoryId} value={project.directoryId}>{project.manifest?.name ?? project.directoryId}</option>)}
        </select>
        <Button variant="ghost" size="icon-sm" onClick={() => void refreshAll()} disabled={busyAction !== null} aria-label="刷新插件预览" title="刷新">
          <RefreshCw className={cn("size-4", busyAction === "refresh" && "animate-spin")} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button variant="outline" size="sm" disabled={!props.tab.pluginId || busyAction !== null}>
                {busyAction === "export" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                导出插件
                <ChevronDown className="size-3.5" />
              </Button>
            )}
          />
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => void exportProject("install")}>
              <PackageCheck />
              <span className="flex min-w-0 flex-col">
                <span>iPollo 插件包</span>
                <span className="text-xs font-normal text-muted-foreground">.ipollowork-plugin · 可直接安装</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void exportProject("source")}>
              <FileArchive />
              <span className="flex min-w-0 flex-col">
                <span>源码压缩包</span>
                <span className="text-xs font-normal text-muted-foreground">.zip · 保留原始插件文件夹</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={() => void installProject()} disabled={!snapshot?.project.manifest || !surface || busyAction !== null}>
          {busyAction === "install" ? <Loader2 className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}
          {installedVersion ? "更新插件" : "安装到软件"}
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
              <h3 className="mt-3 text-sm font-medium">还没有可预览的 Studio</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">让 AI 在 manifest 中声明 UI resource 和 workspace-app contribution，并创建对应的独立 HTML 入口。</p>
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
                让 AI 修复
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted-foreground">
          <span>{snapshot?.project.manifest?.resources.length ?? 0} 个资源</span>
          <span>v{snapshot?.project.manifest?.package?.version ?? "0.0.0"}</span>
          <span>{installedVersion ? `已安装 v${installedVersion}` : "未安装 · 当前会话可试用"}</span>
          <span className="ml-auto">已选中 · 对话会自动调用</span>
        </div>
      )}
      </div>
    </>
  );
}
