/** @jsxImportSource react */

import type { UIMessage } from "ai";
import { ArrowUpRightIcon, ChevronRight, FileOutput, Folder, FolderOpen, ListTree, Loader2, MessageSquarePlusIcon, MoreHorizontalIcon, RefreshCw, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { iPolloWorkServerClient, iPolloWorkWorkspaceCatalogEntry } from "@/app/lib/ipollowork-server";
import {
  htmlArtifactDisplayFilename,
  htmlArtifactFilenameFromTitle,
  type HtmlArtifactDisplayKind,
} from "@/app/lib/session-title";
import { ArtifactIcon } from "@/components/chat/artifact-icon";
import { buildReviseFilePrompt } from "@/components/chat/utils";
import { NAVIGATION_ICON_STROKE_WIDTH } from "@/components/navigation-icons";
import { t } from "@/i18n";
import { OpenTargetProvider, type OpenTargetOptions } from "@/lib/target-provider";
import { createWorkspaceFileOpenTarget, type OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type ArtifactInteractionContext,
  type ArtifactItem,
  type ArtifactRequestOwnership,
  artifactPathMatchesTarget,
  canOpenArtifactInContext,
  canPreviewArtifact,
  getArtifactStudioTarget,
  getArtifactType,
  getArtifactTypeLabel,
  groupConversationOutputArtifacts,
  isConversationOutputArtifact,
  selectArtifactContextOutputs,
  selectArtifactsForRequest,
  selectTemplateEntryArtifacts,
  useArtifacts,
  usePreviewArtifact,
} from "@/lib/artifacts";

interface ArtifactButtonProps {
  artifact: ArtifactItem
  displayName?: string
  sessionId?: string
  artifactContext?: ArtifactInteractionContext
  onOpenVideoStudio?: (displayName?: string) => void
  compact?: boolean
  tile?: boolean
}

const MAX_ARTIFACT_TITLE_LENGTH = 32;
const EMPTY_WORKSPACE_FILES: iPolloWorkWorkspaceCatalogEntry[] = [];

export type ArtifactRequestNaming = {
  title: string
  occurrence: number
};

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function artifactRequestNamingContext(
  messages: UIMessage[],
  assistantMessageIndex: number,
  fallbackTitle?: string,
): ArtifactRequestNaming {
  const userRequests = messages
    .slice(0, Math.max(0, assistantMessageIndex) + 1)
    .filter((message) => message.role === "user")
    .map(messageText)
    .filter(Boolean);
  const title = userRequests.at(-1) ?? fallbackTitle?.trim() ?? "";
  const filename = htmlArtifactFilenameFromTitle(title);
  const occurrence = filename
    ? userRequests.filter((request) => htmlArtifactFilenameFromTitle(request) === filename).length
    : 1;
  return { title, occurrence: Math.max(1, occurrence) };
}

function artifactDisplayKind(artifact: ArtifactItem, requestTitle: string): HtmlArtifactDisplayKind {
  const studioTarget = getArtifactStudioTarget(artifact);
  if (studioTarget?.surface === "video") return "video";
  if (/(?:pptx?|幻灯片|演示文稿|slide|deck)/i.test(requestTitle)) return "slides";
  if (/(?:网页|网站|website|web\s*page|site)/i.test(requestTitle)) return "website";
  return "design";
}

function appendFilenameOccurrence(filename: string, occurrence: number) {
  return occurrence > 1
    ? filename.replace(/(\.html?)$/i, `-${occurrence}$1`)
    : filename;
}

function artifactDisplayNames(
  artifacts: ArtifactItem[],
  namingForArtifact: (artifact: ArtifactItem) => ArtifactRequestNaming,
) {
  const names = new Map<string, string>();
  const occurrences = new Map<string, number>();
  for (const artifact of artifacts) {
    if (artifact.type !== "html") continue;
    const naming = namingForArtifact(artifact);
    const candidate = htmlArtifactDisplayFilename(
      naming.title,
      artifactDisplayKind(artifact, naming.title),
      naming.occurrence,
    );
    if (!candidate) continue;
    const key = candidate.toLocaleLowerCase();
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    names.set(artifact.id, appendFilenameOccurrence(candidate, occurrence));
  }
  return names;
}

export type WorkspaceFileTreeNode =
  | {
      kind: "directory"
      name: string
      path: string
      children: WorkspaceFileTreeNode[]
    }
  | {
      kind: "file"
      name: string
      path: string
      entry: iPolloWorkWorkspaceCatalogEntry
    };

type WorkspaceFileTreeDirectoryDraft = {
  name: string
  path: string
  directories: Map<string, WorkspaceFileTreeDirectoryDraft>
  files: WorkspaceFileTreeNode[]
};

function normalizedWorkspaceFilePath(path: string) {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function finalizeWorkspaceFileTree(directory: WorkspaceFileTreeDirectoryDraft): WorkspaceFileTreeNode[] {
  const directories: WorkspaceFileTreeNode[] = [...directory.directories.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((child) => ({
      kind: "directory",
      name: child.name,
      path: child.path,
      children: finalizeWorkspaceFileTree(child),
    }));
  const files = [...directory.files].sort((left, right) => left.name.localeCompare(right.name));
  return [...directories, ...files];
}

export function buildWorkspaceFileTree(entries: readonly iPolloWorkWorkspaceCatalogEntry[]): WorkspaceFileTreeNode[] {
  const root: WorkspaceFileTreeDirectoryDraft = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
  };

  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const path = normalizedWorkspaceFilePath(entry.path);
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) continue;

    let directory = root;
    let directoryPath = "";
    for (const segment of segments) {
      directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment;
      let child = directory.directories.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: directoryPath,
          directories: new Map(),
          files: [],
        };
        directory.directories.set(segment, child);
      }
      directory = child;
    }

    directory.files.push({ kind: "file", name, path, entry: { ...entry, path } });
  }

  return finalizeWorkspaceFileTree(root);
}

export function filterWorkspaceFileTree(nodes: readonly WorkspaceFileTreeNode[], query: string): WorkspaceFileTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...nodes];

  const matches: WorkspaceFileTreeNode[] = [];
  for (const node of nodes) {
    const nodeMatches = node.name.toLocaleLowerCase().includes(normalizedQuery)
      || node.path.toLocaleLowerCase().includes(normalizedQuery);
    if (node.kind === "file") {
      if (nodeMatches) matches.push(node);
      continue;
    }

    const children = filterWorkspaceFileTree(node.children, normalizedQuery);
    if (nodeMatches || children.length) {
      matches.push({ ...node, children: nodeMatches ? node.children : children });
    }
  }
  return matches;
}

function compactArtifactTitle(name: string) {
  return name.length > MAX_ARTIFACT_TITLE_LENGTH
    ? `${name.slice(0, MAX_ARTIFACT_TITLE_LENGTH - 1)}...`
    : name;
}

function ArtifactButton({ artifact, displayName, sessionId, artifactContext, onOpenVideoStudio, compact = false, tile = false }: ArtifactButtonProps) {
  const previewArtifact = usePreviewArtifact();
  const setDraft = useComposerStateStore((state) => state.setDraft);
  const canOpen = canOpenArtifactInContext(artifact, artifactContext);
  const canPreview = canPreviewArtifact(artifact);
  const isVideoEntry = artifactContext?.kind === "video"
    && artifactPathMatchesTarget(artifact.path, artifactContext.entryPath);
  const studioTarget = getArtifactStudioTarget(artifact);
  const opensCurrentVideoStudio = isVideoEntry && Boolean(onOpenVideoStudio);
  const canOpenVideoStudio = opensCurrentVideoStudio || studioTarget?.surface === "video";
  const canOpenDesignStudio = studioTarget?.surface === "design";
  const canActivate = studioTarget
    ? true
    : artifactContext?.kind === "video" ? opensCurrentVideoStudio : canOpen;
  const presentedName = displayName?.trim() || artifact.name;
  const presentedArtifact = presentedName === artifact.name
    ? artifact
    : { ...artifact, name: presentedName, target: { ...artifact.target, name: presentedName } };
  const title = compactArtifactTitle(presentedName);
  const typeLabel = getArtifactTypeLabel(studioTarget?.surface === "video" ? "video" : artifact.type);
  const actionLabel = canOpenVideoStudio
    ? t("link_action.open_video_studio")
    : canOpenDesignStudio ? t("link_action.open_design") : t("session.outputs.action_browse_edit");

  const content = tile ? (
    <>
      <DescriptiveButtonIcon className="size-11 rounded-xl bg-muted/60 ring-1 ring-border/40">
        <ArtifactIcon className="size-5 shrink-0" type={artifact.type} />
      </DescriptiveButtonIcon>
      <DescriptiveButtonContent className="min-w-0 flex-1 items-start">
        <DescriptiveButtonTitle className="block max-w-full text-sm font-medium" title={presentedName}>{title}</DescriptiveButtonTitle>
        <DescriptiveButtonDescription className="mt-1 flex max-w-full items-center gap-1.5 text-[11px] leading-4">
          <span>{typeLabel}</span>
          {canActivate ? <span aria-hidden="true" className="text-border">•</span> : null}
          {canActivate ? <span className="truncate">{actionLabel}</span> : null}
        </DescriptiveButtonDescription>
      </DescriptiveButtonContent>
      {canActivate ? (
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover/button:bg-background group-hover/button:text-foreground">
          <ArrowUpRightIcon className="size-3.5" />
        </span>
      ) : null}
    </>
  ) : (
    <>
      <DescriptiveButtonIcon className={cn(compact ? "size-5" : "size-12 rounded-2xl bg-muted/55")}>
        <ArtifactIcon className={cn("shrink-0", compact ? "size-4" : "size-5")} type={artifact.type} />
      </DescriptiveButtonIcon>
      <DescriptiveButtonContent className={cn("min-w-0", compact && "flex-none")}>
        <div className="flex min-w-0 items-center gap-1.5">
          <DescriptiveButtonTitle className={cn(compact ? "max-w-48 text-xs font-medium" : "max-w-full text-sm font-medium")} title={presentedName}>{title}</DescriptiveButtonTitle>
          <span className="shrink-0 rounded-md bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
            {typeLabel}
          </span>
        </div>
        {(!compact || canOpenVideoStudio) && canActivate ? (
          <DescriptiveButtonDescription className={cn(compact ? "text-[10px] leading-3" : "text-xs leading-4")}>
            {canOpenVideoStudio
              ? t("link_action.open_video_studio")
              : canOpenDesignStudio ? t("link_action.open_design") : t("session.outputs.action_browse_edit")}
          </DescriptiveButtonDescription>
        ) : null}
      </DescriptiveButtonContent>
      {canActivate ? (
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover/button:bg-background group-hover/button:text-foreground">
          {compact ? <ArrowUpRightIcon className="size-3.5" /> : <MoreHorizontalIcon className="size-3.5" />}
        </span>
      ) : null}
    </>
  );

  if (!canActivate) {
    return (
      <div className={cn("flex h-auto max-w-full items-center justify-start gap-1.5 rounded-xl border text-left whitespace-nowrap", tile ? "min-h-[76px] w-full gap-3 border-border/70 bg-card p-3" : compact ? "w-full flex-none shrink-0 border-transparent px-2 py-1.5" : "h-20 w-full min-w-0 gap-4 border-border px-5 py-4")}>
        {content}
      </div>
    );
  }

  return (
    <div className={cn("group/output relative max-w-full", tile ? "w-full" : compact ? "w-full" : "h-20 w-full min-w-0")}>
      <DescriptiveButton
        className={cn("max-w-full items-center whitespace-nowrap", tile ? "min-h-[76px] w-full justify-start gap-3 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.03)] hover:-translate-y-px hover:border-border hover:bg-muted/30 hover:shadow-sm" : compact ? "w-full flex-none justify-start gap-1.5 rounded-xl px-2 py-1.5 hover:bg-muted/70" : "h-full w-full min-w-0 gap-4 rounded-2xl px-5 py-4")}
        onClick={() => {
          if (opensCurrentVideoStudio) {
            onOpenVideoStudio?.(presentedName);
            return;
          }
          previewArtifact(presentedArtifact, studioTarget ? { viewer: studioTarget.surface } : undefined);
        }}
        title={canOpenVideoStudio
          ? t("session.outputs.open_video_studio")
          : canOpenDesignStudio ? t("link_action.open_design") : canPreview ? `Preview ${presentedName}` : `Open ${presentedName}`}
      >
        {content}
      </DescriptiveButton>
      {sessionId ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("absolute right-1 top-1 size-7 rounded-lg bg-background/90 opacity-0 shadow-sm transition-opacity hover:bg-background group-hover/output:opacity-100 focus:opacity-100", compact && "right-8 top-1/2 -translate-y-1/2", tile && "right-2 top-1/2 -translate-y-1/2")}
          aria-label={t("session.outputs.revise_file")}
          title={t("session.outputs.revise_file")}
          onClick={(event) => {
            event.stopPropagation();
            setDraft(sessionId, buildReviseFilePrompt(artifact.path));
            window.dispatchEvent(new Event("ipollowork:focusPrompt"));
          }}
        >
          <MessageSquarePlusIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

type WorkspaceFileTreeRowsProps = {
  nodes: readonly WorkspaceFileTreeNode[]
  depth: number
  expandedPaths: ReadonlySet<string>
  forceExpanded: boolean
  onToggle: (path: string) => void
  onOpenTarget?: (target: OpenTarget, options?: OpenTargetOptions) => void
};

function WorkspaceFileTreeRows({ nodes, depth, expandedPaths, forceExpanded, onToggle, onOpenTarget }: WorkspaceFileTreeRowsProps) {
  return nodes.map((node) => {
    if (node.kind === "file") {
      return (
        <button
          key={node.path}
          type="button"
          role="treeitem"
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-2 text-left text-xs text-foreground transition-colors hover:bg-muted/70 focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          title={node.path}
          onClick={() => onOpenTarget?.(createWorkspaceFileOpenTarget(node.entry))}
        >
          <ArtifactIcon className="size-4 shrink-0" type={getArtifactType(node.path)} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
      );
    }

    const expanded = forceExpanded || expandedPaths.has(node.path);
    return (
      <div key={node.path} role="treeitem" aria-expanded={expanded}>
        <button
          type="button"
          className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg pr-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => onToggle(node.path)}
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          {expanded ? <FolderOpen className="size-4 shrink-0 text-amber-9" /> : <Folder className="size-4 shrink-0 text-amber-9" />}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
        {expanded ? (
          <div role="group">
            <WorkspaceFileTreeRows
              nodes={node.children}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              forceExpanded={forceExpanded}
              onToggle={onToggle}
              onOpenTarget={onOpenTarget}
            />
          </div>
        ) : null}
      </div>
    );
  });
}

function WorkspaceFileTree({ nodes, query, onOpenTarget }: {
  nodes: readonly WorkspaceFileTreeNode[]
  query: string
  onOpenTarget?: (target: OpenTarget, options?: OpenTargetOptions) => void
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const forceExpanded = Boolean(query.trim());
  const toggleDirectory = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div role="tree" aria-label={t("session.files.directory_tree")} className="space-y-0.5">
      <WorkspaceFileTreeRows
        nodes={nodes}
        depth={0}
        expandedPaths={expandedPaths}
        forceExpanded={forceExpanded}
        onToggle={toggleDirectory}
        onOpenTarget={onOpenTarget}
      />
    </div>
  );
}

interface ArtifactListProps {
  messages: UIMessage[]
  sessionId?: string
  sessionTitle?: string
  requestNaming?: ArtifactRequestNaming
  requestOrdinal?: number | null
  artifactRequestOwnership?: readonly ArtifactRequestOwnership[]
  title?: string
  includeTargetFallbacks?: boolean
  entryPath?: string
  supplementalFiles?: readonly string[]
  artifactContext?: ArtifactInteractionContext
  onOpenVideoStudio?: (displayName?: string) => void
}

export function ArtifactList({ messages, sessionId, sessionTitle, requestNaming, requestOrdinal = null, artifactRequestOwnership = [], title, includeTargetFallbacks = false, entryPath, supplementalFiles, artifactContext, onOpenVideoStudio }: ArtifactListProps) {
  const artifacts = useArtifacts(messages, { includeTargetFallbacks, supplementalFiles });
  const visibleArtifacts = selectArtifactContextOutputs(artifacts, artifactContext);
  const requestArtifacts = selectArtifactsForRequest(
    visibleArtifacts,
    requestOrdinal,
    artifactRequestOwnership,
  );
  const displayedArtifacts = entryPath
    ? selectTemplateEntryArtifacts(requestArtifacts, entryPath)
    : requestArtifacts;
  const displayNames = artifactDisplayNames(
    displayedArtifacts,
    () => requestNaming ?? { title: sessionTitle?.trim() ?? "", occurrence: 1 },
  );

  if (displayedArtifacts.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      {title ? <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div> : null}
      <div
        className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-2 pb-2"
        aria-label={t("session.outputs.title")}
      >
        {displayedArtifacts.map((artifact) => (
          <ArtifactButton
            key={artifact.id}
            artifact={artifact}
            displayName={displayNames.get(artifact.id)}
            sessionId={sessionId}
            artifactContext={artifactContext}
            onOpenVideoStudio={onOpenVideoStudio}
          />
        ))}
      </div>
    </div>
  );
}

interface ConversationOutputPanelProps {
  messages: UIMessage[]
  sessionId?: string
  sessionTitle?: string
  client: iPolloWorkServerClient | null
  workspaceId: string | null
  workspaceRoot: string
  openTargets?: OpenTarget[]
  templateEntryPath?: string
  supplementalFiles?: readonly string[]
  artifactContext?: ArtifactInteractionContext
  onOpenTarget?: (target: OpenTarget, options?: OpenTargetOptions) => void
  onOpenVideoStudio?: (displayName?: string) => void
}

type ConversationFilesMode = "directory" | "outputs";

function ConversationOutputPanelContent({ messages, sessionId, sessionTitle, client, workspaceId, workspaceRoot, templateEntryPath, supplementalFiles, artifactContext, onOpenTarget, onOpenVideoStudio }: Omit<ConversationOutputPanelProps, "openTargets">) {
  const [mode, setMode] = useState<ConversationFilesMode>("outputs");
  const [fileQuery, setFileQuery] = useState("");
  const discoveredArtifacts = useArtifacts(messages, {
    includeTargetFallbacks: false,
    supplementalFiles: supplementalFiles ?? (templateEntryPath ? [templateEntryPath] : undefined),
  });
  const artifacts = templateEntryPath
    ? selectTemplateEntryArtifacts(discoveredArtifacts, templateEntryPath)
    : discoveredArtifacts;
  const outputs = selectArtifactContextOutputs(
    artifacts.filter(isConversationOutputArtifact),
    artifactContext,
  );
  const outputGroups = groupConversationOutputArtifacts(outputs);
  const outputDisplayNames = artifactDisplayNames(
    outputGroups.map((group) => group.primary),
    (artifact) => artifactRequestNamingContext(messages, artifact.messageIndex, sessionTitle),
  );
  const workspaceFilesQuery = useQuery({
    queryKey: ["conversation-workspace-files", workspaceId, workspaceRoot],
    queryFn: () => client && workspaceId ? client.listWorkspaceFiles(workspaceId) : Promise.resolve(EMPTY_WORKSPACE_FILES),
    enabled: mode === "directory" && Boolean(client && workspaceId),
    staleTime: 30_000,
  });
  const workspaceFiles = workspaceFilesQuery.data ?? EMPTY_WORKSPACE_FILES;
  const workspaceFileTree = useMemo(() => buildWorkspaceFileTree(workspaceFiles), [workspaceFiles]);
  const filteredWorkspaceFileTree = useMemo(
    () => filterWorkspaceFileTree(workspaceFileTree, fileQuery),
    [fileQuery, workspaceFileTree],
  );
  const directoryLoading = mode === "directory" && workspaceFilesQuery.isPending;
  const directoryUnavailable = mode === "directory" && (!client || !workspaceId);
  const subtitle = mode === "outputs"
    ? outputs.length ? t("session.files.output_count", { count: outputs.length }) : t("session.outputs.empty")
    : workspaceFilesQuery.isError || directoryUnavailable
      ? t("session.files.load_failed")
      : directoryLoading
        ? t("session.files.loading")
        : t("session.files.file_count", { count: workspaceFiles.length });

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={t("session.files.title")}>
      <div className="shrink-0 border-b border-border/60 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
        <div>
            <div className="text-base font-medium">{t("session.files.title")}</div>
            <div className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">{subtitle}</div>
          </div>
          <ToggleGroup
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "directory" || next === "outputs") setMode(next);
            }}
            variant="outline"
            size="sm"
            aria-label={t("session.files.mode_label")}
            className="shrink-0 rounded-xl"
          >
            <ToggleGroupItem
              value="directory"
              data-testid="conversation-files-mode-directory"
              className="h-8 gap-1.5 rounded-l-xl px-2.5 text-xs"
              aria-label={t("session.files.mode_directory")}
              title={t("session.files.mode_directory")}
            >
              <ListTree className="size-4 text-current" strokeWidth={1.75} />
              <span>{t("session.files.mode_directory")}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="outputs"
              data-testid="conversation-files-mode-outputs"
              className="h-8 gap-1.5 rounded-r-xl px-2.5 text-xs"
              aria-label={t("session.files.mode_outputs")}
              title={t("session.files.mode_outputs")}
            >
              <Sparkles className="size-4 text-current" strokeWidth={1.75} />
              <span>{t("session.files.mode_outputs")}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mode === "directory" ? (
          <div className="mt-3 flex items-center gap-2" data-testid="conversation-files-directory-toolbar">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
                className="h-8 rounded-xl pl-8 text-xs"
                placeholder={t("session.files.search_placeholder")}
                aria-label={t("session.files.search_placeholder")}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-xl"
              aria-label={t("session.files.refresh")}
              title={t("session.files.refresh")}
              disabled={workspaceFilesQuery.isFetching || directoryUnavailable}
              onClick={() => void workspaceFilesQuery.refetch()}
            >
              <RefreshCw className={cn("size-3.5", workspaceFilesQuery.isFetching && "animate-spin")} />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {mode === "outputs" ? outputs.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5" data-testid="conversation-files-outputs-view">
            {outputGroups.map((group) => (
              <div key={group.id} className="relative min-w-0">
                <ArtifactButton
                  artifact={group.primary}
                  displayName={outputDisplayNames.get(group.primary.id)}
                  sessionId={sessionId}
                  artifactContext={artifactContext}
                  onOpenVideoStudio={onOpenVideoStudio}
                  tile
                />
                {group.artifacts.length > 1 ? (
                  <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                    {t("session.outputs.bundle_count", { count: group.artifacts.length })}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground" data-testid="conversation-files-outputs-view">{t("session.outputs.empty_hint")}</div>
        ) : directoryLoading ? (
          <div className="flex h-32 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            {t("session.files.loading")}
          </div>
        ) : workspaceFilesQuery.isError || directoryUnavailable ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 px-4 text-center text-xs text-muted-foreground" role="alert">
            <div>{t("session.files.load_failed")}</div>
            {!directoryUnavailable ? (
              <Button variant="outline" size="sm" onClick={() => void workspaceFilesQuery.refetch()}>{t("session.files.retry")}</Button>
            ) : null}
          </div>
        ) : workspaceFiles.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">{t("session.files.directory_empty")}</div>
        ) : filteredWorkspaceFileTree.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">{t("session.files.no_matches")}</div>
        ) : (
          <div data-testid="conversation-files-directory-view">
            <WorkspaceFileTree nodes={filteredWorkspaceFileTree} query={fileQuery} onOpenTarget={onOpenTarget} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Small header control for task files, either as a panel or a popover. */
export function ConversationOutputTrigger({ active, disabled, onClick, popover = false }: { active: boolean; disabled: boolean; onClick?: () => void; popover?: boolean }) {
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label={t("session.files.open")}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <FileOutput className="!size-[15px]" strokeWidth={NAVIGATION_ICON_STROKE_WIDTH} />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={popover ? <PopoverTrigger render={button} /> : button}
      />
      <TooltipContent>{t("session.files.open")}</TooltipContent>
    </Tooltip>
  );
}

type ConversationOutputPopoverProps = ConversationOutputPanelProps & {
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
};

/** Temporary file picker shown without replacing an already-open work panel. */
export function ConversationOutputPopover({ disabled, open, onOpenChange, openTargets = [], onOpenTarget, onOpenVideoStudio, ...props }: ConversationOutputPopoverProps) {
  const handleOpenTarget = (target: OpenTarget, options?: OpenTargetOptions) => {
    onOpenChange(false);
    onOpenTarget?.(target, options);
  };
  const handleOpenVideoStudio = (displayName?: string) => {
    onOpenChange(false);
    onOpenVideoStudio?.(displayName);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <ConversationOutputTrigger active={open} disabled={disabled} popover />
      <PopoverContent
        align="end"
        sideOffset={8}
        initialFocus={false}
        className="h-[min(70vh,640px)] w-[min(520px,calc(100vw-2rem))] gap-0 overflow-hidden rounded-3xl p-0"
        data-testid="conversation-files-popover"
      >
        <OpenTargetProvider openTargets={openTargets} onOpenTarget={handleOpenTarget}>
          <ConversationOutputPanelContent
            {...props}
            onOpenTarget={handleOpenTarget}
            onOpenVideoStudio={handleOpenVideoStudio}
          />
        </OpenTargetProvider>
      </PopoverContent>
    </Popover>
  );
}

/** Right-side conversation output surface. It looks like a floating card but never covers chat content. */
export function ConversationOutputPanel({ messages, sessionId, sessionTitle, client, workspaceId, workspaceRoot, openTargets = [], templateEntryPath, supplementalFiles, artifactContext, onOpenTarget, onOpenVideoStudio }: ConversationOutputPanelProps) {
  return (
    <OpenTargetProvider openTargets={openTargets} onOpenTarget={onOpenTarget}>
      <div className="h-full min-h-0 bg-background p-3">
        <div className="h-full min-h-0 overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm">
          <ConversationOutputPanelContent messages={messages} sessionId={sessionId} sessionTitle={sessionTitle} client={client} workspaceId={workspaceId} workspaceRoot={workspaceRoot} templateEntryPath={templateEntryPath} supplementalFiles={supplementalFiles} artifactContext={artifactContext} onOpenTarget={onOpenTarget} onOpenVideoStudio={onOpenVideoStudio} />
        </div>
      </div>
    </OpenTargetProvider>
  );
}
