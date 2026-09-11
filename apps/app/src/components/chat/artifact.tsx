/** @jsxImportSource react */

import type { UIMessage } from "ai";
import { ChevronRight, Copy, Download, FileOutput, Folder, FolderOpen, Loader2, MessageSquarePlusIcon, MoreHorizontalIcon, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import type { iPolloWorkServerClient, iPolloWorkWorkspaceCatalogEntry } from "@/app/lib/ipollowork-server";
import { downloadBlobAsFile } from "@/app/lib/download";
import {
  htmlArtifactDisplayFilename,
  htmlArtifactFilenameFromTitle,
  type HtmlArtifactDisplayKind,
} from "@/app/lib/session-title";
import { loadArtifactThumbnail, useArtifactThumbnails } from "./artifact-thumbnail";
import { ArtifactIcon } from "@/components/chat/artifact-icon";
import { artifactCardDescription, artifactCardTitle, buildReviseFilePrompt } from "@/components/chat/utils";
import { NAVIGATION_ICON_STROKE_WIDTH } from "@/components/navigation-icons";
import { t } from "@/i18n";
import { OpenTargetProvider, useOpenTargets, type OpenTargetOptions } from "@/lib/target-provider";
import { createWorkspaceFileOpenTarget, type OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { useSessionArtifacts } from "@/react-app/infra/session-artifacts-query";
import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type ArtifactInteractionContext,
  type ArtifactItem,
  type ArtifactRequestOwnership,
  artifactPathMatchesTarget,
  canOpenArtifact,
  canOpenArtifactInContext,
  canPreviewArtifact,
  getArtifactStudioTarget,
  getArtifactType,
  getArtifactTypeLabel,
  groupConversationOutputArtifacts,
  isConversationOutputArtifact,
  selectArtifactsForRequest,
  selectConversationArtifactCards,
  selectTemplateEntryArtifacts,
  useArtifacts,
  usePreviewArtifact,
} from "@/lib/artifacts";

interface ArtifactButtonProps {
  artifact: ArtifactItem
  displayName?: string
  description?: string
  client?: iPolloWorkServerClient | null
  workspaceId?: string | null
  sessionId?: string
  artifactContext?: ArtifactInteractionContext
  onOpenVideoStudio?: (displayName?: string) => void
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
  if (occurrence <= 1) return filename;
  return /\.html?$/i.test(filename)
    ? filename.replace(/(\.html?)$/i, `-${occurrence}$1`)
    : `${filename} ${occurrence}`;
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
    const title = artifactCardTitle(naming.title, candidate);
    const requestTitle = title === candidate || naming.occurrence <= 1
      ? title
      : `${title} ${naming.occurrence}`;
    const key = requestTitle.toLocaleLowerCase();
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    names.set(artifact.id, appendFilenameOccurrence(requestTitle, occurrence));
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

function ArtifactButton({ artifact, displayName, client, workspaceId, sessionId, artifactContext, onOpenVideoStudio }: ArtifactButtonProps) {
  const thumbnailRoot = useRef<HTMLSpanElement>(null);
  const { loadWorkspaceThumbnail } = useOpenTargets();
  const loadThumbnail = useCallback((path: string) => {
    if (client && workspaceId) return loadArtifactThumbnail(client, workspaceId, path);
    if (loadWorkspaceThumbnail) return loadWorkspaceThumbnail(path);
    return Promise.reject(new Error("Thumbnail unavailable"));
  }, [client, workspaceId, loadWorkspaceThumbnail]);
  useArtifactThumbnails(thumbnailRoot, loadThumbnail);
  const previewArtifact = usePreviewArtifact();
  const setDraft = useComposerStateStore((state) => state.setDraft);
  const [downloading, setDownloading] = useState(false);
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(artifact.name);
  const [renameBusy, setRenameBusy] = useState(false);
  const renameOutput = async () => {
    if (!client || !workspaceId || !sessionId || renameBusy) return;
    setRenameBusy(true);
    try {
      await client.renameWorkspaceArtifact(workspaceId, { path: artifact.path, name: newName, sessionId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session-artifacts", client.baseUrl, workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["conversation-workspace-files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["artifact-panel", workspaceId] }),
      ]);
      setRenaming(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : t("session.outputs.rename_failed")); }
    finally { setRenameBusy(false); }
  };
  const canOpen = canOpenArtifactInContext(artifact, artifactContext);
  const canPreview = canPreviewArtifact(artifact);
  const isVideoEntry = artifactContext?.kind === "video"
    && artifactPathMatchesTarget(artifact.path, artifactContext.entryPath);
  const studioTarget = getArtifactStudioTarget(artifact);
  const opensCurrentVideoStudio = isVideoEntry && Boolean(onOpenVideoStudio);
  const canOpenVideoStudio = opensCurrentVideoStudio || studioTarget?.surface === "video";
  const canOpenDesignStudio = studioTarget?.surface === "design";
  const canActivate = studioTarget || ((artifact.type === "image" || artifact.type === "video") && canOpenArtifact(artifact))
    ? true
    : artifactContext?.kind === "video" ? opensCurrentVideoStudio : canOpen;
  const presentedName = displayName?.trim() || artifact.name;
  const presentedArtifact = presentedName === artifact.name
    ? artifact
    : { ...artifact, name: presentedName, target: { ...artifact.target, name: presentedName } };
  const title = compactArtifactTitle(presentedName);
  const typeLabel = getArtifactTypeLabel(studioTarget?.surface === "video" ? "video" : artifact.type);
  const extension = artifact.name.includes(".") ? artifact.name.slice(artifact.name.lastIndexOf(".") + 1).toUpperCase() : typeLabel;
  const canDownload = Boolean(client && workspaceId && artifact.target.kind === "file");

  const download = async () => {
    if (!client || !workspaceId || artifact.target.kind !== "file" || downloading) return;
    setDownloading(true);
    try {
      const result = await client.downloadWorkspaceFile(workspaceId, artifact.path);
      downloadBlobAsFile(artifact.name, new Blob([result.data], {
        type: result.contentType ?? "application/octet-stream",
      }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("artifact.download_failed"));
    } finally {
      setDownloading(false);
    }
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(artifact.path);
      toast.success(t("session.outputs.path_copied"));
    } catch {
      toast.error(t("session.outputs.path_copy_failed"));
    }
  };

  const content = (
    <>
      <span ref={thumbnailRoot} className="contents"><DescriptiveButtonIcon className={cn("chat-output-icon")} data-artifact-thumbnail={/\.(png|jpe?g|webp|gif|avif|svg|mp4|mov|webm)$/i.test(artifact.path) ? artifact.path : undefined}>
        <ArtifactIcon className={cn("shrink-0", "size-4")} type={artifact.type} />
      </DescriptiveButtonIcon></span>
      <DescriptiveButtonContent className={cn("min-w-0", "chat-output-content")}>
        <div className="flex min-w-0 items-center gap-1.5">
          <DescriptiveButtonTitle className={cn("chat-output-title")} data-testid="artifact-file-title" title={presentedName}>{title}</DescriptiveButtonTitle>
        </div>
        {(
          <DescriptiveButtonDescription className={cn("chat-output-description")} data-testid="artifact-file-description">
            {extension}
          </DescriptiveButtonDescription>
        )}
      </DescriptiveButtonContent>
    </>
  );

  if (!canActivate && !(client && workspaceId && sessionId && artifact.target.kind === "file")) {
    return (
      <div data-testid="artifact-file-card" className={cn("flex h-auto max-w-full items-center justify-start gap-1.5 rounded-xl border text-left whitespace-nowrap", "chat-output-card")}>
        {content}
      </div>
    );
  }

  return (
    <div className={cn("group/output relative max-w-full", "h-14 w-full min-w-0")} data-testid="artifact-file-shell">
      <DescriptiveButton
        disabled={!canActivate}
        data-testid="artifact-file-card"
        className={cn("max-w-full items-center whitespace-nowrap", "chat-output-card pr-20")}
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
      {(
        <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/output:pointer-events-auto group-hover/output:opacity-100 group-focus-within/output:pointer-events-auto group-focus-within/output:opacity-100" data-testid="artifact-file-actions">
          {canDownload ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-lg bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("artifact.download_artifact")}
              title={t("artifact.download_artifact")}
              disabled={downloading}
              onClick={() => void download()}
            >
              {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-lg bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("session.outputs.more_actions")}
                  data-testid="artifact-file-more"
                  title={t("session.outputs.more_actions")}
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              )}
            />
            <DropdownMenuContent align="end" className="w-64" positionerClassName="z-[80]">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="pb-1">
                  <span className="block truncate font-mono text-[11px] font-normal" title={artifact.path}>{artifact.path}</span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuItem onClick={() => void copyPath()}>
                <Copy />
                {t("session.outputs.copy_path")}
              </DropdownMenuItem>
              {client && workspaceId && sessionId && artifact.target.kind === "file" ? (
                <DropdownMenuItem onClick={() => { setNewName(artifact.name); setRenaming(true); }}>
                  {t("session.outputs.rename")}
                </DropdownMenuItem>
              ) : null}
              {artifact.target.kind === "file" ? (
                <DropdownMenuItem onClick={() => previewArtifact(presentedArtifact, { external: true, reveal: true })}>
                  <FolderOpen />
                  {t("artifact.show_in_folder")}
                </DropdownMenuItem>
              ) : null}
              {sessionId ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => {
                    setDraft(sessionId, buildReviseFilePrompt(artifact.path));
                    window.dispatchEvent(new Event("ipollowork:focusPrompt"));
                  }}>
                    <MessageSquarePlusIcon />
                    {t("session.outputs.revise_file")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <Dialog open={renaming} onOpenChange={(open) => { if (!renameBusy) setRenaming(open); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("session.outputs.rename")}</DialogTitle>
          <DialogDescription>{t("session.outputs.rename_hint")}</DialogDescription>
          <form onSubmit={(event) => { event.preventDefault(); void renameOutput(); }} className="grid gap-4">
            <Input autoFocus aria-label={t("session.outputs.rename")} value={newName} onChange={(event) => setNewName(event.target.value)} disabled={renameBusy} />
            <Button type="submit" disabled={renameBusy || !newName.trim()}>{renameBusy ? t("common.loading") : t("common.save")}</Button>
          </form>
        </DialogContent>
      </Dialog>
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
  client?: iPolloWorkServerClient | null
  workspaceId?: string | null
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

export function ArtifactList({ messages, client, workspaceId, sessionId, sessionTitle, requestNaming, requestOrdinal = null, artifactRequestOwnership = [], title, includeTargetFallbacks = false, entryPath, supplementalFiles, artifactContext, onOpenVideoStudio }: ArtifactListProps) {
  const artifacts = useArtifacts(messages, { includeTargetFallbacks, supplementalFiles });
  const requestArtifacts = selectArtifactsForRequest(
    artifacts,
    requestOrdinal,
    artifactRequestOwnership,
  );
  const displayedArtifacts = selectConversationArtifactCards(
    entryPath
      ? selectTemplateEntryArtifacts(requestArtifacts, entryPath)
      : requestArtifacts,
    artifactContext,
  );
  const displayNames = artifactDisplayNames(
    displayedArtifacts,
    () => requestNaming ?? { title: sessionTitle?.trim() ?? "", occurrence: 1 },
  );
  const descriptionSource = `${requestNaming?.title ?? ""} ${messages.map(messageText).join(" ")}`;

  if (displayedArtifacts.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      {title ? <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div> : null}
      <div
        className="chat-output-grid pb-2"
        aria-label={t("session.outputs.title")}
      >
        {displayedArtifacts.map((artifact) => (
          <ArtifactButton
            key={artifact.id}
            artifact={artifact}
            displayName={displayNames.get(artifact.id)}
            description={artifactCardDescription(artifact, descriptionSource)}
            client={client}
            workspaceId={workspaceId}
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

function ConversationOutputPanelContent({ messages, sessionId, sessionTitle, client, workspaceId, workspaceRoot, templateEntryPath, supplementalFiles, artifactContext, onOpenTarget, onOpenVideoStudio, popover = false, onClose }: Omit<ConversationOutputPanelProps, "openTargets"> & { popover?: boolean; onClose?: () => void }) {
  const [mode, setMode] = useState<ConversationFilesMode>("outputs");
  const [fileQuery, setFileQuery] = useState("");
  const sessionArtifacts = useSessionArtifacts(client, workspaceId, sessionId);
  const registeredFiles = useMemo(
    () => sessionArtifacts.data?.pages.flatMap((page) => page.items) ?? [],
    [sessionArtifacts.data],
  );
  const discoveredArtifacts = useArtifacts(messages, {
    includeTargetFallbacks: false,
    supplementalFiles: supplementalFiles ?? (templateEntryPath ? [templateEntryPath] : undefined),
    registeredFiles,
  });
  const templateArtifacts = templateEntryPath
    ? selectTemplateEntryArtifacts(discoveredArtifacts, templateEntryPath)
    : discoveredArtifacts;
  const templateIds = new Set(templateArtifacts.map((artifact) => artifact.id));
  const artifacts = templateEntryPath
    ? discoveredArtifacts.filter((artifact) => templateIds.has(artifact.id) || artifact.messageId === "session-output")
    : discoveredArtifacts;
  const outputs = artifacts.filter(isConversationOutputArtifact);
  const outputGroups = groupConversationOutputArtifacts(outputs);
  const outputDisplayNames = artifactDisplayNames(
    outputs,
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
    ? outputs.length ? t("session.files.output_count", { count: outputGroups.length }) : t("session.outputs.empty")
    : workspaceFilesQuery.isError || directoryUnavailable
      ? t("session.files.load_failed")
      : directoryLoading
        ? t("session.files.loading")
        : t("session.files.file_count", { count: workspaceFiles.length });

  return (
    <div className={cn("flex min-h-0 flex-col", popover ? "max-h-[min(70vh,560px)]" : "h-full")} aria-label={t("session.files.title")}>
      <div className={cn("shrink-0 border-b border-border/60 px-4", popover ? "py-3" : "pb-3 pt-4")}>
        <div className={cn("items-center gap-3", popover ? "grid grid-cols-[1fr_auto_1fr]" : "flex justify-between")}>
          <div className="min-w-0">
            <div className="text-base font-medium">{t("session.files.title")}</div>
            <div className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">{subtitle}</div>
          </div>
          <ToggleGroup
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "directory" || next === "outputs") setMode(next);
            }}
            spacing={0.5}
            aria-label={t("session.files.mode_label")}
            className="h-8 shrink-0 items-center gap-0.5 rounded-[9px] bg-muted p-[3px]"
          >
            <ToggleGroupItem
              value="directory"
              data-testid="conversation-files-mode-directory"
              className="h-[26px] min-w-0 rounded-md px-3 text-xs text-muted-foreground shadow-none hover:bg-background/70 hover:text-foreground aria-pressed:bg-white aria-pressed:text-foreground aria-pressed:shadow-none"
              aria-label={t("session.files.mode_directory")}
              title={t("session.files.mode_directory")}
            >
              <span>{t("session.files.mode_directory")}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="outputs"
              data-testid="conversation-files-mode-outputs"
              className="h-[26px] min-w-0 rounded-md px-3 text-xs text-muted-foreground shadow-none hover:bg-background/70 hover:text-foreground aria-pressed:bg-white aria-pressed:text-foreground aria-pressed:shadow-none"
              aria-label={t("session.files.mode_outputs")}
              title={t("session.files.mode_outputs")}
            >
              <span>{t("session.files.mode_outputs")}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          {popover ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8 justify-self-end rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={onClose}
            >
              <X className="size-4" strokeWidth={NAVIGATION_ICON_STROKE_WIDTH} />
            </Button>
          ) : null}
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
        {mode === "outputs" && sessionArtifacts.isError ? (
          <div role="alert" className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("session.files.load_failed")}</span>
            <Button variant="outline" size="sm" onClick={() => void sessionArtifacts.refetch()}>{t("session.files.retry")}</Button>
          </div>
        ) : null}
        {mode === "outputs" ? outputs.length ? (
          <div className={cn("grid gap-2.5", popover ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]")} data-testid="conversation-files-outputs-view">
            {outputGroups.map((group) => (
              <div key={group.id} className="relative min-w-0">
                <ArtifactButton
                  artifact={group.primary}
                  displayName={outputDisplayNames.get(group.primary.id)}
                  description={artifactCardDescription(group.primary, group.primary.type === "image" || group.primary.type === "video" ? "" : messages.map(messageText).join(" "))}
                  client={client}
                  workspaceId={workspaceId}
                  sessionId={sessionId}
                  onOpenVideoStudio={onOpenVideoStudio}
                />
                {group.artifacts.length > 1 ? (
                  <details className="mt-1 rounded-lg border border-border/60 p-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground" aria-label={t("session.outputs.expand_bundle")}>
                      {t("session.outputs.bundle_count", { count: group.artifacts.length })}
                    </summary>
                    <div className="mt-2 grid gap-2">
                      {group.artifacts.slice(1).map((artifact) => (
                        <ArtifactButton key={artifact.id} artifact={artifact} displayName={outputDisplayNames.get(artifact.id)} client={client} workspaceId={workspaceId} sessionId={sessionId} />
                      ))}
                    </div>
                  </details>
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
        {mode === "outputs" && (sessionArtifacts.isFetching || sessionArtifacts.hasNextPage) ? (
          <div className="mt-3 flex justify-center">
            <Button variant="ghost" size="sm" disabled={sessionArtifacts.isFetching} onClick={() => void sessionArtifacts.fetchNextPage()}>
              {sessionArtifacts.isFetching ? t("session.files.loading") : t("workspace_list.show_more_fallback")}
            </Button>
          </div>
        ) : null}
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
        className="w-[min(440px,calc(100vw-2rem))] max-h-[min(70vh,560px)] gap-0 overflow-hidden rounded-xl! bg-background p-0 shadow-xl backdrop-blur-none"
        data-testid="conversation-files-popover"
      >
        <OpenTargetProvider openTargets={openTargets} onOpenTarget={handleOpenTarget}>
          <ConversationOutputPanelContent
            {...props}
            onOpenTarget={handleOpenTarget}
            onOpenVideoStudio={handleOpenVideoStudio}
            popover
            onClose={() => onOpenChange(false)}
          />
        </OpenTargetProvider>
      </PopoverContent>
    </Popover>
  );
}

/** Persistent task-file surface inside the right panel. */
export function ConversationOutputPanel({ messages, sessionId, sessionTitle, client, workspaceId, workspaceRoot, openTargets = [], templateEntryPath, supplementalFiles, artifactContext, onOpenTarget, onOpenVideoStudio }: ConversationOutputPanelProps) {
  return (
    <OpenTargetProvider openTargets={openTargets} onOpenTarget={onOpenTarget}>
      <div className="h-full min-h-0 overflow-hidden bg-background" data-testid="conversation-files-panel">
        <ConversationOutputPanelContent messages={messages} sessionId={sessionId} sessionTitle={sessionTitle} client={client} workspaceId={workspaceId} workspaceRoot={workspaceRoot} templateEntryPath={templateEntryPath} supplementalFiles={supplementalFiles} artifactContext={artifactContext} onOpenTarget={onOpenTarget} onOpenVideoStudio={onOpenVideoStudio} />
      </div>
    </OpenTargetProvider>
  );
}
