/** @jsxImportSource react */

import type { UIMessage } from "ai";
import { ArrowUpRightIcon, ChevronRightIcon, ListChecks, MessageSquarePlusIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { ArtifactIcon } from "@/components/chat/artifact-icon";
import { buildReviseFilePrompt } from "@/components/chat/utils";
import { t } from "@/i18n";
import { OpenTargetProvider, type OpenTargetOptions } from "@/lib/target-provider";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type ArtifactItem,
  canOpenArtifact,
  canPreviewArtifact,
  groupConversationOutputArtifacts,
  isConversationOutputArtifact,
  isVideoHtmlArtifact,
  selectTemplateEntryArtifacts,
  useArtifacts,
  usePreviewArtifact,
} from "@/lib/artifacts";

interface ArtifactButtonProps {
  artifact: ArtifactItem
  sessionId?: string
  onOpenVideoStudio?: () => void
  compact?: boolean
}

const MAX_ARTIFACT_TITLE_LENGTH = 32;

function compactArtifactTitle(name: string) {
  return name.length > MAX_ARTIFACT_TITLE_LENGTH
    ? `${name.slice(0, MAX_ARTIFACT_TITLE_LENGTH - 1)}...`
    : name;
}

function ArtifactButton({ artifact, sessionId, onOpenVideoStudio, compact = false }: ArtifactButtonProps) {
  const previewArtifact = usePreviewArtifact();
  const setDraft = useComposerStateStore((state) => state.setDraft);
  const isVideoHtml = isVideoHtmlArtifact(artifact);
  const canOpen = canOpenArtifact(artifact);
  const canPreview = canPreviewArtifact(artifact);
  const canOpenVideoStudio = isVideoHtml && Boolean(onOpenVideoStudio);
  const canActivate = canOpen || canOpenVideoStudio;
  const title = compactArtifactTitle(artifact.name);

  const content = (
    <>
      <DescriptiveButtonIcon className={cn(compact ? "size-5" : "size-12 rounded-2xl bg-muted/55")}>
        <ArtifactIcon className={cn("shrink-0", compact ? "size-4" : "size-5")} type={artifact.type} />
      </DescriptiveButtonIcon>
      <DescriptiveButtonContent className={cn("min-w-0", compact && "flex-none")}>
        <DescriptiveButtonTitle className={cn(compact ? "max-w-56 text-xs font-medium" : "max-w-full text-sm font-medium")} title={artifact.name}>{title}</DescriptiveButtonTitle>
        {(!compact || canOpenVideoStudio) && canActivate ? (
          <DescriptiveButtonDescription className={cn(compact ? "text-[10px] leading-3" : "text-xs leading-4")}>
            {canOpenVideoStudio ? t("session.outputs.action_video_preview_edit") : t("session.outputs.action_browse_edit")}
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
      <div className={cn("flex h-auto max-w-full items-center justify-start gap-1.5 rounded-xl border text-left whitespace-nowrap", compact ? "w-full flex-none shrink-0 border-transparent px-2 py-1.5" : "min-h-[72px] w-full min-w-0 gap-4 border-border px-5 py-4")}>
        {content}
      </div>
    );
  }

  return (
    <div className={cn("group/output relative max-w-full", compact && "w-full")}>
      <DescriptiveButton
        className={cn("max-w-full items-center whitespace-nowrap", compact ? "w-full flex-none justify-start gap-1.5 rounded-xl px-2 py-1.5 hover:bg-muted/70" : "min-h-[72px] w-full min-w-0 gap-4 rounded-2xl px-5 py-4")}
        onClick={() => {
          if (canOpenVideoStudio) {
            onOpenVideoStudio?.();
            return;
          }
          previewArtifact(artifact);
        }}
        title={canOpenVideoStudio ? t("session.outputs.open_video_studio") : canPreview ? `Preview ${artifact.name}` : `Open ${artifact.name}`}
      >
        {content}
      </DescriptiveButton>
      {sessionId ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("absolute right-1 top-1 size-7 rounded-lg bg-background/80 opacity-0 shadow-sm transition-opacity hover:bg-background group-hover/output:opacity-100 focus:opacity-100", compact && "right-8 top-1/2 -translate-y-1/2")}
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

interface OutputGroupRowProps {
  group: ReturnType<typeof groupConversationOutputArtifacts>[number]
  sessionId?: string
  onOpenVideoStudio?: () => void
}

function OutputGroupRow({ group, sessionId, onOpenVideoStudio }: OutputGroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const childArtifacts = group.artifacts.filter((artifact) => artifact.id !== group.primary.id);

  if (!group.bundled || childArtifacts.length === 0) {
    return <ArtifactButton artifact={group.primary} sessionId={sessionId} onOpenVideoStudio={onOpenVideoStudio} compact />;
  }

  return (
    <div className="rounded-2xl border border-transparent transition-colors hover:border-border/60">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          <ArtifactButton artifact={group.primary} sessionId={sessionId} onOpenVideoStudio={onOpenVideoStudio} compact />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-1 size-7 shrink-0 rounded-lg text-muted-foreground"
          aria-label={expanded ? t("session.outputs.collapse_bundle") : t("session.outputs.expand_bundle")}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </Button>
      </div>
      <div className="px-3 pb-2 text-[10px] text-muted-foreground">
        {t("session.outputs.bundle_count", { count: group.artifacts.length })}
      </div>
      {expanded ? (
        <div className="mb-2 ml-6 mr-2 border-l border-border/60 pl-2">
          {childArtifacts.map((artifact) => (
            <ArtifactButton key={artifact.id} artifact={artifact} sessionId={sessionId} onOpenVideoStudio={onOpenVideoStudio} compact />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ArtifactListProps {
  messages: UIMessage[]
  sessionId?: string
  title?: string
  includeTargetFallbacks?: boolean
  supplementalFiles?: readonly string[]
  onOpenVideoStudio?: () => void
}

export function ArtifactList({ messages, sessionId, title, includeTargetFallbacks = false, supplementalFiles, onOpenVideoStudio }: ArtifactListProps) {
  const artifacts = useArtifacts(messages, { includeTargetFallbacks, supplementalFiles });
  const displayedArtifacts = supplementalFiles?.[0]
    ? selectTemplateEntryArtifacts(artifacts, supplementalFiles[0])
    : artifacts;

  if (displayedArtifacts.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      {title ? <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div> : null}
      <div className="no-scrollbar flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1">
        {displayedArtifacts.map((artifact) => (
          <ArtifactButton key={artifact.id} artifact={artifact} sessionId={sessionId} onOpenVideoStudio={onOpenVideoStudio} />
        ))}
      </div>
    </div>
  );
}

interface ConversationOutputPanelProps {
  messages: UIMessage[]
  sessionId?: string
  openTargets?: OpenTarget[]
  templateEntryPath?: string
  onOpenTarget?: (target: OpenTarget, options?: OpenTargetOptions) => void
  onOpenVideoStudio?: () => void
}

function ConversationOutputPanelContent({ messages, sessionId, templateEntryPath, onOpenVideoStudio }: Omit<ConversationOutputPanelProps, "openTargets" | "onOpenTarget">) {
  const discoveredArtifacts = useArtifacts(messages, {
    includeTargetFallbacks: false,
    supplementalFiles: templateEntryPath ? [templateEntryPath] : undefined,
  });
  const artifacts = templateEntryPath
    ? selectTemplateEntryArtifacts(discoveredArtifacts, templateEntryPath)
    : discoveredArtifacts;
  const outputs = artifacts.filter(isConversationOutputArtifact);
  const outputGroups = groupConversationOutputArtifacts(outputs);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3" aria-label={t("session.outputs.title")}>
      <div className="flex items-center justify-between border-b border-border/60 px-2 pb-3">
        <div>
          <div className="text-base font-medium">{t("session.outputs.title")}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{outputGroups.length ? `${outputGroups.length}` : t("session.outputs.empty")}</div>
        </div>
      </div>
      {outputs.length ? (
        <div className="mt-2 flex flex-col gap-0.5">
          {outputGroups.map((group) => (
            <OutputGroupRow key={group.id} group={group} sessionId={sessionId} onOpenVideoStudio={onOpenVideoStudio} />
          ))}
        </div>
      ) : (
        <div className="px-2 py-8 text-center text-xs text-muted-foreground">{t("session.outputs.empty_hint")}</div>
      )}
    </div>
  );
}

/** Small header control for the mutually-exclusive conversation output panel. */
export function ConversationOutputTrigger({ active, disabled, onClick }: { active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", active && "bg-muted text-foreground")}
      aria-label={t("session.outputs.open")}
      title={t("session.outputs.open")}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <ListChecks className="size-4" />
    </Button>
  );
}

/** Right-side conversation output surface. It looks like a floating card but never covers chat content. */
export function ConversationOutputPanel({ messages, sessionId, openTargets = [], templateEntryPath, onOpenTarget, onOpenVideoStudio }: ConversationOutputPanelProps) {
  return (
    <OpenTargetProvider openTargets={openTargets} onOpenTarget={onOpenTarget}>
      <div className="h-full min-h-0 bg-background p-3">
        <div className="h-full min-h-0 overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm">
          <ConversationOutputPanelContent messages={messages} sessionId={sessionId} templateEntryPath={templateEntryPath} onOpenVideoStudio={onOpenVideoStudio} />
        </div>
      </div>
    </OpenTargetProvider>
  );
}
