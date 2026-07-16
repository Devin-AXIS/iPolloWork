/** @jsxImportSource react */

import type { UIMessage } from "ai";
import { ArrowUpRightIcon, ChevronRightIcon, ListChecks, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { ArtifactIcon } from "@/components/chat/artifact-icon";
import { t } from "@/i18n";
import { OpenTargetProvider, type OpenTargetOptions } from "@/lib/target-provider";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
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
  useArtifacts,
  usePreviewArtifact,
} from "@/lib/artifacts";

interface ArtifactButtonProps {
  artifact: ArtifactItem
  onOpenVideoStudio?: () => void
  compact?: boolean
}

const MAX_ARTIFACT_TITLE_LENGTH = 32;

function compactArtifactTitle(name: string) {
  return name.length > MAX_ARTIFACT_TITLE_LENGTH
    ? `${name.slice(0, MAX_ARTIFACT_TITLE_LENGTH - 1)}…`
    : name;
}

function ArtifactButton({ artifact, onOpenVideoStudio, compact = false }: ArtifactButtonProps) {
  const previewArtifact = usePreviewArtifact();
  const isVideoHtml = isVideoHtmlArtifact(artifact);
  const canOpen = canOpenArtifact(artifact);
  const canPreview = canPreviewArtifact(artifact);
  const canOpenVideoStudio = isVideoHtml && Boolean(onOpenVideoStudio);
  const canActivate = canOpen || canOpenVideoStudio;
  const title = compactArtifactTitle(artifact.name);

  const content = (
    <>
      <DescriptiveButtonIcon className="size-5">
        <ArtifactIcon className="size-4 shrink-0" type={artifact.type} />
      </DescriptiveButtonIcon>
      <DescriptiveButtonContent className="min-w-0 flex-none">
        <DescriptiveButtonTitle className={cn("text-xs font-medium", compact ? "max-w-56" : "max-w-[172px]")} title={artifact.name}>{title}</DescriptiveButtonTitle>
        {!compact && canActivate ? (
          <DescriptiveButtonDescription className="text-[10px] leading-3">
            {canOpenVideoStudio ? t("session.outputs.action_video_studio") : t("session.outputs.action_browse_edit")}
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
      <div className={cn("flex h-auto max-w-full flex-none shrink-0 items-center justify-start gap-1.5 rounded-xl border px-2 py-1.5 text-left whitespace-nowrap", compact ? "w-full border-transparent" : "w-fit border-border")}>
        {content}
      </div>
    );
  }

  return (
    <DescriptiveButton
      className={cn("max-w-full flex-none items-center gap-1.5 rounded-xl px-2.5 py-2 whitespace-nowrap", compact ? "w-full justify-start px-2 py-1.5 hover:bg-muted/70" : "min-w-[220px]")}
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
  );
}

interface OutputGroupRowProps {
  group: ReturnType<typeof groupConversationOutputArtifacts>[number]
  onOpenVideoStudio?: () => void
}

function OutputGroupRow({ group, onOpenVideoStudio }: OutputGroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const childArtifacts = group.artifacts.filter((artifact) => artifact.id !== group.primary.id);

  if (!group.bundled || childArtifacts.length === 0) {
    return <ArtifactButton artifact={group.primary} onOpenVideoStudio={onOpenVideoStudio} compact />;
  }

  return (
    <div className="rounded-2xl border border-transparent transition-colors hover:border-border/60">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          <ArtifactButton artifact={group.primary} onOpenVideoStudio={onOpenVideoStudio} compact />
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
            <ArtifactButton key={artifact.id} artifact={artifact} onOpenVideoStudio={onOpenVideoStudio} compact />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ArtifactListProps {
  messages: UIMessage[]
  includeTargetFallbacks?: boolean
  onOpenVideoStudio?: () => void
}

export function ArtifactList({ messages, includeTargetFallbacks = false, onOpenVideoStudio }: ArtifactListProps) {
  const artifacts = useArtifacts(messages, { includeTargetFallbacks });

  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-2 md:px-10">
      <div className="no-scrollbar flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1">
        {artifacts.map((artifact) => (
          <ArtifactButton key={artifact.id} artifact={artifact} onOpenVideoStudio={onOpenVideoStudio} />
        ))}
      </div>
    </div>
  );
}

interface ConversationOutputPanelProps {
  messages: UIMessage[]
  openTargets?: OpenTarget[]
  onOpenTarget?: (target: OpenTarget, options?: OpenTargetOptions) => void
  onOpenVideoStudio?: () => void
}

function ConversationOutputPanelContent({ messages, onOpenVideoStudio }: Omit<ConversationOutputPanelProps, "openTargets" | "onOpenTarget">) {
  const artifacts = useArtifacts(messages, { includeTargetFallbacks: false });
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
            <OutputGroupRow key={group.id} group={group} onOpenVideoStudio={onOpenVideoStudio} />
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
export function ConversationOutputPanel({ messages, openTargets = [], onOpenTarget, onOpenVideoStudio }: ConversationOutputPanelProps) {
  return (
    <OpenTargetProvider openTargets={openTargets} onOpenTarget={onOpenTarget}>
      <div className="h-full min-h-0 bg-background p-3">
        <div className="h-full min-h-0 overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm">
          <ConversationOutputPanelContent messages={messages} onOpenVideoStudio={onOpenVideoStudio} />
        </div>
      </div>
    </OpenTargetProvider>
  );
}
