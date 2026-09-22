"use memo";

import * as React from "react"
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock3,
  ChevronRight,
  Copy,
  Download,
  FileIcon,
  FilePenLine,
  FileSearch,
  Globe,
  LoaderCircle,
  Pencil,
  Quote,
  Split,
  SquareTerminal,
  Undo2,
  Wrench,
} from "lucide-react"
import {
  DynamicToolUIPart,
  isFileUIPart,
  ToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
import { classifyProviderFailure } from "@ipollowork/types/provider-errors"
import { openDesktopUrl } from "@/app/lib/desktop"
import { downloadBlobAsFile, downloadTextAsFile } from "@/app/lib/download"
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "@/app/types"
import { t } from "@/i18n"
import { ApplyPatchTool } from "@/components/tools/apply-patch"
import { BashTool } from "@/components/tools/bash"
import { EditTool } from "@/components/tools/edit"
import { EnvVarRequestTool } from "@/components/tools/env-var-request"
import { ReadFileTool, WriteFileTool } from "@/components/tools/file"
import { GlobTool } from "@/components/tools/glob"
import { GrepTool } from "@/components/tools/grep"
import { LspTool } from "@/components/tools/lsp"
import { QuestionTool } from "@/components/tools/question"
import { SkillTool } from "@/components/tools/skill"
import { TodoWriteTool } from "@/components/tools/todowrite"
import { WebfetchTool } from "@/components/tools/webfetch"
import { WebsearchTool } from "@/components/tools/websearch"
import { useMessageList, useSessionErrorMessage } from "@/components/chat/message-list-provider"
import {
  ArtifactList,
  artifactRequestNamingContext,
  type ArtifactRequestNaming,
} from "@/components/chat/artifact"
import {
  assignArtifactRequestOwnership,
  artifactPathMatchesTarget,
  getArtifactsFromMessages,
  inferArtifactRequestOwnership,
  selectArtifactsForRequest,
  selectSupplementalArtifactsForRequest,
  selectConversationArtifactCards,
  selectTemplateEntryArtifacts,
  useArtifacts,
  type ArtifactInteractionContext,
  type ArtifactItem,
  type ArtifactRequestOwnership,
} from "@/lib/artifacts"
import {
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Image } from "@/components/ui/image"
import { toast } from "@/components/ui/sonner"
import { useOpenTargets } from "@/lib/target-provider"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import { Tool } from "@/components/ui/tool"
import {
  isApplyPatchToolPart,
  isBashToolPart,
  isEditToolPart,
  isEnvVarRequestToolPart,
  isGlobToolPart,
  isGrepToolPart,
  isLspToolPart,
  isQuestionToolPart,
  isReadToolPart,
  isSkillToolPart,
  isTodoWriteToolPart,
  isWebFetchToolPart,
  isWebSearchToolPart,
  isWriteToolPart,
} from "@/lib/build-in-tools"
import type { ThreadStatus } from "@/lib/messages"
import {
  collectToolParts,
  getActiveToolLabel,
  getToolActivityLabel,
  isToolPartInFlight,
} from "@/lib/tool-activity"
import { cn } from "@/lib/utils"
import { assistantResponseMarkdownFilename, hasActiveAssistantVisibleResult, buildAssistantResponseMarkdown, buildQuoteFollowUpPrompt, getActiveAssistantMessageId, getAssistantProcessState, getScheduleApplyResult, groupMessages, isAssistantFinalAnswerMessage, isAssistantCommentaryMessage, isInternalContinuationMessage, isMessageGroup, getLastTextPart, getAssistantRenderGroups, getFileMediaType, getFileTitle, getFileUrl, getMediaBadge, getMessageCompleted, getMessageCreated, formatMessageTimestamp, formatProcessDuration, type ScheduleApplyResult, type UIMessageWithIndex, getMessagesText, isStudioResultMessage, splitAssistantRenderGroups, stripArtifactPathLines, type AssistantProcessRenderGroup } from "./utils"

const SEARCH_HIGHLIGHT_MARK_CLASS = "rounded px-0.5 bg-amber-4/70 text-current"
const ASSISTANT_COLUMN_CLASS_NAME = "mx-auto w-full max-w-[800px] px-2 md:px-10"
const ASSISTANT_TEXT_EDGES_CLASS_NAME = "[&_.markdown-content>:first-child]:mt-0 [&_.markdown-content>:last-child]:mb-0"
const MESSAGE_ACTIONS_CLASS_NAME = "flex gap-0 [&_button]:size-7 [&_button_svg:not([class*='size-'])]:size-3.5"
const StudioDeliveryPaths = React.createContext<readonly string[]>([])
const EMPTY_STOPPED_IMAGE_MESSAGE_IDS: ReadonlySet<string> = new Set()

function selectInlineImageArtifacts(messages: readonly UIMessage[], artifacts: readonly ArtifactItem[]) {
  return messages.flatMap((message) => message.parts.filter(isFileUIPart))
    .filter((part) => getFileMediaType(part).startsWith("image/"))
    .flatMap((part) => {
      const matches = artifacts.filter((artifact) => artifact.type === "image"
        && artifact.target.kind === "file"
        && artifact.target.exists === true
        && (artifactPathMatchesTarget(artifact.path, getFileUrl(part)) || artifact.name === getFileTitle(part)))
      return matches.length === 1 ? matches : []
    })
}

type RenderAssistantGroupOptions = {
  highlightQuery?: string
  artifactPaths?: readonly string[]
  streaming?: boolean
  imageStatus?: "failed" | "stopped"
  inlineImageArtifacts?: readonly ArtifactItem[]
}

type ProcessStep = {
  key: string
  messageId: string
  group: ReturnType<typeof getAssistantRenderGroups>[number]
}

type ToolAction = "inspect" | "edit" | "command" | "web" | "other"
type ProcessRow = { kind: "step"; step: ProcessStep } | { kind: "tools"; action: ToolAction; steps: ProcessStep[] }

function getToolAction(part: ToolUIPart | DynamicToolUIPart): ToolAction {
  if (isReadToolPart(part) || isGrepToolPart(part) || isGlobToolPart(part) || isLspToolPart(part)) return "inspect"
  if (isEditToolPart(part) || isWriteToolPart(part) || isApplyPatchToolPart(part)) return "edit"
  if (isBashToolPart(part) || (part.type === "dynamic-tool" && ["exec_command", "functions.exec"].includes(part.toolName))) return "command"
  if (isWebFetchToolPart(part) || isWebSearchToolPart(part)) return "web"
  return "other"
}

function groupProcessSteps(steps: ProcessStep[]): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const step of steps) {
    if (step.group.kind !== "tool") {
      rows.push({ kind: "step", step })
      continue
    }
    const action = getToolAction(step.group.part)
    const last = rows.at(-1)
    if (last?.kind === "tools" && last.action === action) last.steps.push(step)
    else rows.push({ kind: "tools", action, steps: [step] })
  }
  return rows
}

function renderAssistantGroup(group: ReturnType<typeof getAssistantRenderGroups>[number], index: number, options: RenderAssistantGroupOptions = {}) {
  if (group.kind === "text") {
    const text = options.artifactPaths
      ? stripArtifactPathLines(group.text, options.artifactPaths)
      : group.text
    return (
      <MessageContent
        key={`text-${index}`}
        className="text-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
        data-chat-readable-text="true"
        markdown
        isStreaming={options.streaming}
        highlightQuery={options.highlightQuery}
      >
        {text}
      </MessageContent>
    )
  }

  if (group.kind === "reasoning") {
    return (
      <MessageContent
        key={`reasoning-${index}`}
        className="text-muted-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
        markdown
        isStreaming={group.isStreaming}
      >
        {group.text}
      </MessageContent>
    )
  }

  if (group.kind === "file") {
    const imageArtifact = options.inlineImageArtifacts?.find((artifact) =>
      artifactPathMatchesTarget(artifact.path, getFileUrl(group.part))
      || artifact.name === getFileTitle(group.part)
    )
    return (
      <div key={`file-${index}`} className="w-full">
        <FileMessage part={group.part} tone="assistant" streaming={options.streaming} imageStatus={options.imageStatus} artifact={imageArtifact} />
      </div>
    )
  }

  return (
    <div key={`tool-${index}`} className="w-full">
      <ToolMessage part={group.part} />
    </div>
  )
}

function MessageTimestamp({ message, className }: { message: UIMessage; className?: string }) {
  const created = getMessageCreated(message)
  if (created === null) return null

  return (
    <span
      className={cn(
        "select-none whitespace-nowrap text-[11px] tabular-nums text-muted-foreground/70",
        className
      )}
      title={new Date(created).toLocaleString()}
    >
      {formatMessageTimestamp(created)}
    </span>
  )
}

function ScheduleApplyResultCard({ result }: { result: ScheduleApplyResult }) {
  const { onOpenSchedule } = useMessageList()
  if (!onOpenSchedule) return null

  return (
    <div
      className="mx-auto flex w-full max-w-[800px] items-center gap-3 rounded-xl border border-teal-7/35 bg-teal-3/30 px-4 py-3"
      data-testid="schedule-import-result"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-5/45 text-teal-11">
        <Check className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{t("work.schedule_import.success")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("work.schedule_import.count", { count: result.itemCount })}</p>
      </div>
      <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-lg" onClick={() => onOpenSchedule(result.focusAt)}>
        <CalendarDays className="size-3.5" />
        {t("work.schedule_import.view")}
      </Button>
    </div>
  )
}

interface ToolMessageProps {
  part: ToolUIPart | DynamicToolUIPart
}

/**
 * Error boundary around tool-part rendering. Tool inputs from streamed or
 * interrupted runs can violate their type contracts (partial/undefined
 * input); without this boundary a single bad part unmounts the entire app
 * (white screen). Seen in production on v0.15.3 via a todowrite part with
 * missing input.todos.
 */
class ToolMessage extends React.Component<ToolMessageProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error("[tool-part] render failed", error)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="text-xs text-muted-foreground">{t("chat.tool_step_unavailable")}</div>
      )
    }
    return <ToolMessageInner part={this.props.part} />
  }
}

const ToolMessageInner = ({ part }: ToolMessageProps) => {
  if (isBashToolPart(part)) {
    return <BashTool part={part} />
  }

  if (isEditToolPart(part)) {
    return <EditTool part={part} />
  }

  if (isWriteToolPart(part)) {
    return <WriteFileTool part={part} />
  }

  if (isReadToolPart(part)) {
    return <ReadFileTool part={part} />
  }

  if (isGrepToolPart(part)) {
    return <GrepTool part={part} />
  }

  if (isGlobToolPart(part)) {
    return <GlobTool part={part} />
  }

  if (isLspToolPart(part)) {
    return <LspTool part={part} />
  }

  if (isApplyPatchToolPart(part)) {
    return <ApplyPatchTool part={part} />
  }

  if (isSkillToolPart(part)) {
    return <SkillTool part={part} />
  }

  if (isTodoWriteToolPart(part)) {
    return <TodoWriteTool part={part} />
  }

  if (isWebFetchToolPart(part)) {
    return <WebfetchTool part={part} />
  }

  if (isWebSearchToolPart(part)) {
    return <WebsearchTool part={part} />
  }

  if (isQuestionToolPart(part)) {
    return <QuestionTool part={part} />
  }

  if (isEnvVarRequestToolPart(part)) {
    return <EnvVarRequestTool part={part} />
  }

  return <Tool toolPart={part} />
}

const isEmptyMessage = (message: UIMessage): boolean => message.parts.length === 0

type RetryStatus = Extract<SessionStatus, { type: "retry" }>

function isSessionErrorMessage(message: UIMessage) {
  return message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX)
}

export function getLatestArtifactAssistantMessageId(messages: UIMessage[]) {
  return messages.findLast(
    (message) => message.role === "assistant" && !isSessionErrorMessage(message) && !isStudioResultMessage(message),
  )?.id
}

export function getAssistantGroupArtifactMessages(items: UIMessageWithIndex[]) {
  return items.map((item) => item.message)
}

export function getAssistantRequestOrdinal(messages: UIMessage[], assistantMessageIndex: number) {
  const requestCount = messages
    .slice(0, Math.max(0, assistantMessageIndex))
    .filter((message) => message.role === "user" && !isInternalContinuationMessage(message))
    .length
  return requestCount > 0 ? requestCount - 1 : null
}

function retryDelaySeconds(status: RetryStatus) {
  return Math.max(0, Math.round((status.next - Date.now()) / 1000))
}

interface FileMessageProps {
  part: FileUIPart
  tone: "user" | "assistant"
  streaming?: boolean
  imageStatus?: "failed" | "stopped"
  artifact?: ArtifactItem
}

function FileMessage({ part, tone, streaming, imageStatus, artifact }: FileMessageProps) {
  const { client, workspaceId } = useMessageList()
  const { onOpenTarget } = useOpenTargets()
  const [downloading, setDownloading] = React.useState(false)
  const title = getFileTitle(part)
  const badge = getMediaBadge(part)
  const mediaType = getFileMediaType(part)
  const url = getFileUrl(part)
  const isImage = mediaType.startsWith("image/") && url.length > 0

  if (isImage) {
    const statusLabel = artifact && imageStatus ? t("image.preview.ready")
      : imageStatus === "failed" ? t("image.preview.failed")
      : imageStatus === "stopped" ? t("image.preview.stopped")
        : streaming ? artifact ? t("image.preview.saved_processing") : t("image.preview.generating")
          : artifact ? t("image.preview.ready") : t("image.preview.preview_ready")
    return (
      <div className="flex max-w-full flex-col items-start gap-2">
        {tone === "assistant" ? (
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground" data-testid="assistant-image-status" aria-live="polite">{statusLabel}</span>
        ) : null}
        <Image src={url} alt={title} previewMaxHeight={tone === "user" ? 160 : undefined} loading="lazy" decoding="async" />
        {tone === "assistant" && artifact ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {onOpenTarget ? (
              <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onOpenTarget(artifact.target)}>{t("image.preview.open")}</button>
            ) : null}
            {client && workspaceId ? (
              <button type="button" disabled={downloading} className="underline underline-offset-2 hover:text-foreground disabled:opacity-50" onClick={async () => {
                setDownloading(true)
                try {
                  const result = await client.downloadWorkspaceFile(workspaceId, artifact.path)
                  downloadBlobAsFile(artifact.name, new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }))
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("artifact.download_failed"))
                } finally {
                  setDownloading(false)
                }
              }}>{t("image.preview.download")}</button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-auto w-fit min-w-0 max-w-full shrink items-center justify-start gap-2 rounded-xl border border-border ps-2 pe-4 py-1 text-left text-sm font-medium whitespace-normal">
      <DescriptiveButtonIcon>
        <FileIcon className="size-6 shrink-0" />
      </DescriptiveButtonIcon>
      <DescriptiveButtonContent className="gap-0">
        <DescriptiveButtonTitle>{title}</DescriptiveButtonTitle>
        {badge ? (
          <DescriptiveButtonDescription className="text-xs">
            {badge}
          </DescriptiveButtonDescription>
        ) : null}
      </DescriptiveButtonContent>
    </div>
  )
}

function EmptyMessage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-2 md:px-10 text-muted-foreground",
        className
      )}
      {...props}
    >
      Empty message
    </div>
  )
}

interface CopyMessageButtonProps {
  messages: UIMessage[]
}

function CopyMessageButton({ messages }: CopyMessageButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const text = React.useMemo(() => getMessagesText(messages), [messages])

  const onCopy = React.useCallback(async () => {
    if (!text) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard failures
    }
  }, [text])

  if (!text) {
    return null
  }

  return (
    <MessageAction tooltip={copied ? t("message.copied") : t("message.copy")}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("message.copy")}
        onClick={() => void onCopy()}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </MessageAction>
  )
}

function SaveMessageAsMarkdownButton({ messages }: CopyMessageButtonProps) {
  const { sessionTitle } = useMessageList()
  const text = React.useMemo(() => getMessagesText(messages), [messages])
  if (!text) return null

  return (
    <MessageAction tooltip={t("message.save_markdown")}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("message.save_markdown")}
        onClick={() => downloadTextAsFile(assistantResponseMarkdownFilename(sessionTitle), buildAssistantResponseMarkdown(text), "text/markdown;charset=utf-8")}
      >
        <Download />
      </Button>
    </MessageAction>
  )
}

function QuoteFollowUpButton({ messages }: CopyMessageButtonProps) {
  const { setPrompt } = useMessageList()
  const text = React.useMemo(() => getMessagesText(messages), [messages])
  if (!text) return null

  return (
    <MessageAction tooltip={t("message.quote_follow_up")}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("message.quote_follow_up")}
        onClick={() => setPrompt(buildQuoteFollowUpPrompt(text))}
      >
        <Quote />
      </Button>
    </MessageAction>
  )
}

type AssistantMessageProps = {
  message: UIMessage
  artifactMessages?: UIMessage[]
  isLastMessage: boolean
  isStreaming: boolean
  isLastStep: boolean
  hideProcess?: boolean
  showLatestArtifactsTitle?: boolean
  requestNaming?: ArtifactRequestNaming
  requestOrdinal?: number | null
  artifactRequestOwnership?: readonly ArtifactRequestOwnership[]
  templateEntryPath?: string
  artifactFiles?: readonly string[]
  artifactContext?: ArtifactInteractionContext
  imageStatus?: "failed" | "stopped"
  deferFilesWhileStreaming?: boolean
}

function formatElapsedDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return [
    hours > 0 ? t("message.elapsed_hours", { count: hours }) : null,
    hours > 0 || minutes > 0 ? t("message.elapsed_minutes", { count: minutes }) : null,
    t("message.elapsed_seconds", { count: seconds }),
  ].filter(Boolean).join(" ")
}

function useElapsedNow(startedAt: number | null, active: boolean) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active || startedAt === null) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [active, startedAt])
  return now
}

function AssistantProcessDisclosure(props: {
  groups: AssistantProcessRenderGroup[]
  isStreaming: boolean
  completed?: boolean
  finalizing?: boolean
  hasError?: boolean
  stopped?: boolean
  hasDetails?: boolean
  startedAt?: number | null
  endedAt?: number | null
  durationMs: number | null
  children: React.ReactNode
  contentClassName?: string
}) {
  const { groups, isStreaming, completed = false, finalizing = false, hasError = false, stopped = false, hasDetails = true, startedAt = null, endedAt = null, durationMs, children, contentClassName } = props
  const { waitingLabel } = useMessageList()
  const awaitingConfirmation = isStreaming && Boolean(waitingLabel)
  const [manualOpen, setManualOpen] = React.useState<boolean | null>(null)
  const isOpen = manualOpen ?? (isStreaming && !completed)
  React.useEffect(() => {
    if (completed) setManualOpen(null)
  }, [completed])
  const now = useElapsedNow(startedAt, isStreaming)
  const activeTool = isStreaming ? groups.findLast((group) => group.kind === "tool" && isToolPartInFlight(group.part)) : undefined
  const currentStep = activeTool?.kind === "tool" ? getToolActivityLabel(activeTool.part) : null
  const processState = getAssistantProcessState(isStreaming, hasError)
  const elapsedMs = startedAt !== null && (isStreaming || endedAt !== null)
    ? Math.max(0, (isStreaming ? now : endedAt ?? now) - startedAt)
    : durationMs
  const elapsed = elapsedMs === null ? null : formatElapsedDuration(elapsedMs)
  const label = stopped ? t("message.elapsed_stopped") : awaitingConfirmation ? waitingLabel : finalizing
    ? t("session.status_finalizing")
    : processState === "streaming"
    ? t("message.process_in_progress")
    : processState === "failed"
      ? t("message.process_failed")
      : t("message.process_completed")
  const heading = elapsed === null ? label
    : isStreaming ? `${label} · ${t("message.elapsed_running", { duration: elapsed })}`
    : processState === "completed" && !stopped ? t("message.elapsed_total", { duration: elapsed })
    : `${stopped ? label : t("message.elapsed_failed")} · ${t("message.elapsed_total", { duration: elapsed })}`
  const completedCommands = groups.filter((group) => group.kind === "tool" && !isToolPartInFlight(group.part)).length
  const content = (
    <>
      <span className="min-w-0 truncate">{heading}
        {completedCommands > 0 ? <span> · {t("message.process_handled_tool_count", { count: completedCommands })}</span> : null}
        {currentStep && !isOpen ? <span className="ml-1 text-muted-foreground/85">· {currentStep}</span> : null}
      </span>
      {hasDetails ? <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden /> : null}
    </>
  )

  return (
    <div className="w-full">
      {hasDetails ? <button
        type="button"
        className={cn(
          "chat-process-heading text-muted-foreground hover:text-foreground flex w-full items-center gap-2 px-0 py-2 text-left text-xs font-medium transition-colors",
          processState === "failed" && "text-muted-foreground",
        )}
        aria-expanded={isOpen}
        aria-label={isOpen ? t("message.collapse_process") : t("message.expand_process")}
        onClick={() => setManualOpen(!isOpen)}
      >{content}</button> : <div className="chat-process-heading text-muted-foreground flex items-center gap-2 py-2 text-xs font-medium">{content}</div>}
      {hasDetails && isOpen ? (
        <div className={cn("mt-2 flex w-full flex-col gap-2", !isStreaming && "border-l border-border/70 pl-4", contentClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

function AssistantProcessSection(props: {
  groups: AssistantProcessRenderGroup[]
  isStreaming: boolean
  durationMs: number | null
  imageStatus?: "failed" | "stopped"
  inlineImageArtifacts?: readonly ArtifactItem[]
}) {
  const { groups, isStreaming, durationMs, imageStatus, inlineImageArtifacts } = props

  if (groups.length === 0) {
    return null
  }

  return (
    <AssistantProcessDisclosure groups={groups} isStreaming={isStreaming} durationMs={durationMs}>
      {groups.map((group, index) => renderAssistantGroup(group, index, { streaming: isStreaming, imageStatus, inlineImageArtifacts }))}
    </AssistantProcessDisclosure>
  )
}

const AssistantMessage = React.memo(
  ({ message, artifactMessages, isStreaming, hideProcess = false, showLatestArtifactsTitle = false, requestNaming, requestOrdinal, artifactRequestOwnership, templateEntryPath, artifactFiles, artifactContext, imageStatus, deferFilesWhileStreaming = false }: AssistantMessageProps) => {
    const deliveredPaths = React.useContext(StudioDeliveryPaths)
    const { client, workspaceId, showThinking, highlightQuery, sessionId, sessionTitle, onOpenVideoStudio } = useMessageList()
    const assistantRenderGroups = React.useMemo(
      () => getAssistantRenderGroups(message.parts, showThinking),
      [message.parts, showThinking]
    )
    const assistantRenderSections = React.useMemo(
      () => splitAssistantRenderGroups(assistantRenderGroups),
      [assistantRenderGroups]
    )
    const durationMs = React.useMemo(() => {
      const created = getMessageCreated(message)
      const completed = getMessageCompleted(message)
      return created !== null && completed !== null && completed >= created ? completed - created : null
    }, [message])
    const responseArtifacts = useArtifacts(artifactMessages ?? [message], {
      supplementalFiles: artifactFiles ?? (templateEntryPath ? [templateEntryPath] : undefined),
    })
    const inlineImageArtifacts = React.useMemo(() => selectInlineImageArtifacts(artifactMessages ?? [message], responseArtifacts), [artifactMessages, message, responseArtifacts])
    const inlineImagePaths = inlineImageArtifacts.map((artifact) => artifact.path)
    const visibleArtifactPaths = React.useMemo(() => {
      if (isStreaming) return []
      const requestArtifacts = selectArtifactsForRequest(
        responseArtifacts.filter(artifact => isStudioResultMessage(message) || !deliveredPaths.includes(artifact.path)),
        requestOrdinal ?? null,
        artifactRequestOwnership ?? [],
      )
      return selectConversationArtifactCards(
        templateEntryPath ? selectTemplateEntryArtifacts(requestArtifacts, templateEntryPath) : requestArtifacts,
        artifactContext,
      ).map(artifact => artifact.path)
    }, [artifactContext, artifactRequestOwnership, deliveredPaths, isStreaming, message, requestOrdinal, responseArtifacts, templateEntryPath])

    return (
      <Message
        className={cn(ASSISTANT_COLUMN_CLASS_NAME, "flex flex-col items-start gap-2")}
        data-testid="assistant-message-column"
        data-message-id={message.id}
        data-message-role={message.role}
      >
        <div className="group flex w-full flex-col gap-0 space-y-4">
          {hideProcess ? null : (
            <AssistantProcessSection
              groups={assistantRenderSections.processGroups}
              isStreaming={isStreaming}
              durationMs={durationMs}
              imageStatus={imageStatus}
              inlineImageArtifacts={inlineImageArtifacts}
            />
          )}
          {assistantRenderSections.resultGroups.filter((group) => !(deferFilesWhileStreaming && group.kind === "file")).map((group, index) =>
            renderAssistantGroup(group, index, { highlightQuery, artifactPaths: visibleArtifactPaths, streaming: isStreaming, imageStatus, inlineImageArtifacts })
          )}
          {!isStreaming ? (
            <ArtifactList
              messages={artifactMessages ?? [message]}
              excludedPaths={isStudioResultMessage(message) ? inlineImagePaths : [...deliveredPaths, ...inlineImagePaths]}
              client={client}
              workspaceId={workspaceId}
              sessionId={sessionId}
              sessionTitle={sessionTitle}
              requestNaming={requestNaming}
              requestOrdinal={requestOrdinal}
              artifactRequestOwnership={artifactRequestOwnership}
              title={showLatestArtifactsTitle ? t("session.outputs.latest_turn") : undefined}
              entryPath={templateEntryPath}
              supplementalFiles={artifactFiles ?? (templateEntryPath ? [templateEntryPath] : undefined)}
              artifactContext={artifactContext}
              onOpenVideoStudio={onOpenVideoStudio}
            />
          ) : null}
        </div>
      </Message>
    )
  }
)

AssistantMessage.displayName = "AssistantMessage"

type UserMessageProps = {
  message: UIMessage
  isStreaming: boolean
}

const USER_SKILL_TOKEN_RE = /(Load \[skill [^\]]+\] and follow its instructions\.|\[skill [^\]]+\])/

function UserSkillChip(props: { name: string }) {
  return (
    <span className="mx-0.5 inline-flex items-center rounded-full border border-violet-6/35 bg-violet-3/20 px-2.5 py-1 text-xs font-medium text-violet-11 align-middle" title={`Skill: ${props.name}`}>
      {props.name}
    </span>
  )
}

type DesignSelectionDataPart = UIMessage["parts"][number] & {
  type: "data-design-selection"
  data: { contextId: string; label: string }
}

type AnimationReferencesDataPart = UIMessage["parts"][number] & {
  type: "data-animation-references"
  data: { items: Array<{ name: string; label: string }> }
}

type VoiceReferenceDataPart = UIMessage["parts"][number] & {
  type: "data-voice-reference"
  data: { voiceId: string; model: string; label: string }
}

function isDesignSelectionDataPart(part: UIMessage["parts"][number]): part is DesignSelectionDataPart {
  if (part.type !== "data-design-selection" || !part.data || typeof part.data !== "object") return false
  const data = part.data as { contextId?: unknown; label?: unknown }
  return typeof data.contextId === "string" && typeof data.label === "string" && Boolean(data.label.trim())
}

function isAnimationReferencesDataPart(part: UIMessage["parts"][number]): part is AnimationReferencesDataPart {
  if (part.type !== "data-animation-references" || !part.data || typeof part.data !== "object") return false
  const items = (part.data as { items?: unknown }).items
  return Array.isArray(items) && items.every((item) => (
    Boolean(item)
    && typeof item === "object"
    && typeof (item as { name?: unknown }).name === "string"
    && typeof (item as { label?: unknown }).label === "string"
  ))
}

function isVoiceReferenceDataPart(part: UIMessage["parts"][number]): part is VoiceReferenceDataPart {
  if (part.type !== "data-voice-reference" || !part.data || typeof part.data !== "object") return false
  const data = part.data as { voiceId?: unknown; model?: unknown; label?: unknown }
  return typeof data.voiceId === "string" && typeof data.model === "string" && typeof data.label === "string" && Boolean(data.label.trim())
}

function UserReferenceChip(props: { label: string; kind: "design" | "animation" | "voice" }) {
  return (
    <span
      data-message-design-selection={props.kind === "design" ? "true" : undefined}
      data-message-animation-reference={props.kind === "animation" ? "true" : undefined}
      data-message-voice-reference={props.kind === "voice" ? "true" : undefined}
      className="inline-flex max-w-full items-center rounded-full border border-violet-6/35 bg-violet-3/20 px-2.5 py-1 text-xs font-medium text-violet-11"
      title={`${props.kind === "design" ? "Design selection" : props.kind === "animation" ? "Animation reference" : "Voice reference"}: ${props.label}`}
    >
      <span className="truncate">{props.label}</span>
    </span>
  )
}

function renderPlainTextWithSearchHighlights(text: string, highlightQuery: string | undefined, keyPrefix: string) {
  const needle = highlightQuery?.trim().toLowerCase() ?? ""
  if (needle.length < 2) return text

  const lower = text.toLowerCase()
  if (!lower.includes(needle)) return text

  const nodes: React.ReactNode[] = []
  let cursor = 0
  let matchIndex = lower.indexOf(needle)
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex))
    }
    const end = matchIndex + needle.length
    nodes.push(
      <mark
        key={`${keyPrefix}:match:${matchIndex}`}
        data-search-highlight="true"
        className={SEARCH_HIGHLIGHT_MARK_CLASS}
      >
        {text.slice(matchIndex, end)}
      </mark>
    )
    cursor = end
    matchIndex = lower.indexOf(needle, cursor)
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes
}

function renderUserTextWithSkillChips(text: string, highlightQuery: string | undefined) {
  if (!USER_SKILL_TOKEN_RE.test(text)) return renderPlainTextWithSearchHighlights(text, highlightQuery, "text")
  let offset = 0
  return text.split(USER_SKILL_TOKEN_RE).map((segment) => {
    const key = `${offset}:${segment}`
    offset += segment.length
    const skillMatch = segment.match(/^(?:Load )?\[skill ([^\]]+)\](?: and follow its instructions\.)?$/)
    if (skillMatch?.[1]) return <UserSkillChip key={key} name={skillMatch[1]} />
    return <React.Fragment key={key}>{renderPlainTextWithSearchHighlights(segment, highlightQuery, key)}</React.Fragment>
  })
}

const UserMessage = React.memo(
  ({ message, isStreaming }: UserMessageProps) => {
    const { onRevertToUserMessage, onForkAtMessage, onEditUserMessage, highlightQuery } = useMessageList()
    const messageText = React.useMemo(() => getMessagesText([message]), [message])

    return (
      <Message
        className="mx-auto flex w-full max-w-[800px] flex-col items-end gap-2 px-2 md:px-10"
        data-message-id={message.id}
        data-message-role={message.role}
      >
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div className="group relative flex w-full flex-col items-end gap-1">
                {message.parts.filter(isFileUIPart).map((part, index) => (
                  <FileMessage key={`${part.url}-${index}`} part={part} tone="user" />
                ))}
                {message.parts.some((part) => (
                  isDesignSelectionDataPart(part)
                  || isAnimationReferencesDataPart(part)
                  || isVoiceReferenceDataPart(part)
                )) ? (
                  <div className="flex max-w-full flex-wrap justify-end gap-1">
                    {message.parts.flatMap((part) => {
                      if (isDesignSelectionDataPart(part)) {
                        return [<UserReferenceChip key={`design:${part.data.contextId}`} label={part.data.label} kind="design" />]
                      }
                      if (isAnimationReferencesDataPart(part)) {
                        return part.data.items.map((item) => (
                          <UserReferenceChip key={`animation:${item.name}`} label={item.label} kind="animation" />
                        ))
                      }
                      if (isVoiceReferenceDataPart(part)) {
                        return [<UserReferenceChip key={`voice:${part.data.voiceId}`} label={part.data.label} kind="voice" />]
                      }
                      return []
                    })}
                  </div>
                ) : null}
                {message.parts.some((part) => part.type === "text" && part.text) ? (
                  <MessageContent
                    layoutId={message.id}
                    className="bg-muted text-foreground max-w-[85%] rounded-3xl px-5 py-2.5 text-left whitespace-pre-wrap sm:max-w-[75%]"
                    data-chat-readable-text="true"
                    data-testid="user-message-bubble"
                  >
                    {renderUserTextWithSkillChips(message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""), highlightQuery)}
                  </MessageContent>
                ) : null}
                {!isStreaming && (
                  <MessageActions className={cn(MESSAGE_ACTIONS_CLASS_NAME, "pointer-events-none absolute right-0 top-full z-10 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100")}>
                    <MessageTimestamp message={message} className="mr-1.5" />
                    <CopyMessageButton messages={[message]} />
                    {messageText ? (
                      <MessageAction tooltip={t("message.edit")}>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("message.edit")}
                          onClick={() => onEditUserMessage(message.id, messageText)}
                        >
                          <Pencil />
                        </Button>
                      </MessageAction>
                    ) : null}
                    <MessageAction tooltip={t("message.branch_new_chat")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("message.branch_new_chat")}
                        onClick={() => onForkAtMessage(message.id)}
                      >
                        <Split className="rotate-90" />
                      </Button>
                    </MessageAction>
                    <MessageAction tooltip={t("message.revert")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("message.revert")}
                        onClick={() => onRevertToUserMessage(message.id)}
                      >
                        <Undo2 />
                      </Button>
                    </MessageAction>
                  </MessageActions>
                )}
              </div>
            }
          />
          <ContextMenuContent className="w-56">
            {messageText ? (
              <ContextMenuItem onClick={() => onEditUserMessage(message.id, messageText)}>
                <Pencil className="size-4" />
                {t("message.edit")}
              </ContextMenuItem>
            ) : null}
            {messageText ? (
              <ContextMenuItem onClick={() => void navigator.clipboard.writeText(messageText)}>
                <Copy className="size-4" />
                {t("message.copy")}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onClick={() => onForkAtMessage(message.id)}>
              <Split className="size-4 rotate-90" />
              {t("message.branch_new_chat")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRevertToUserMessage(message.id)}>
              <Undo2 className="size-4" />
              {t("message.revert")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Message>
    )
  }
)

UserMessage.displayName = "UserMessage"

type MessageComponentProps = {
  message: UIMessage
  artifactMessages?: UIMessage[]
  isLastMessage: boolean
  isStreaming: boolean
  isLastStep: boolean
  hideProcess?: boolean
  showLatestArtifactsTitle?: boolean
  requestNaming?: ArtifactRequestNaming
  requestOrdinal?: number | null
  artifactRequestOwnership?: readonly ArtifactRequestOwnership[]
  templateEntryPath?: string
  artifactFiles?: readonly string[]
  artifactContext?: ArtifactInteractionContext
  imageStatus?: "failed" | "stopped"
  deferFilesWhileStreaming?: boolean
}

const MessageComponent = React.memo(
  ({ message, artifactMessages, isLastMessage, isStreaming, isLastStep, hideProcess, showLatestArtifactsTitle, requestNaming, requestOrdinal, artifactRequestOwnership, templateEntryPath, artifactFiles, artifactContext, imageStatus, deferFilesWhileStreaming = false }: MessageComponentProps) => {
    if (isSessionErrorMessage(message)) {
      return <ErrorMessage error={getMessagesText([message]) || t("message.session_failed")} />
    }

    if (isEmptyMessage(message) && !isStreaming) {
      return (
        <EmptyMessage
          data-message-id={message.id}
          data-message-role={message.role}
        />
      )
    }

    if (message.role === "assistant") {
      return (
        <AssistantMessage
          message={message}
          artifactMessages={artifactMessages}
          isLastMessage={isLastMessage}
          isStreaming={isStreaming}
          isLastStep={isLastStep}
          hideProcess={hideProcess}
          showLatestArtifactsTitle={showLatestArtifactsTitle}
          requestNaming={requestNaming}
          requestOrdinal={requestOrdinal}
          artifactRequestOwnership={artifactRequestOwnership}
          templateEntryPath={templateEntryPath}
          artifactFiles={artifactFiles}
          artifactContext={artifactContext}
          imageStatus={imageStatus}
          deferFilesWhileStreaming={deferFilesWhileStreaming}
        />
      )
    }

    return (
      <UserMessage
        message={message}
        isStreaming={isStreaming}
      />
    )
  }
)

MessageComponent.displayName = "MessageComponent"

function ThinkingDots() {
  return <span className="chat-thinking-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
}

function ThinkingIndicator() {
  const label = t("session.assistant_thinking")
  return <><span className="chat-thinking-label" aria-label={label}>{Array.from(label).map((character, index) => <span key={index} aria-hidden="true" style={{ animationDelay: `${index * 0.12}s` }}>{character}</span>)}</span><ThinkingDots /></>
}

function LiveActivityIndicator({ kind, label }: { kind: "tool" | "waiting"; label: string }) {
  return (
    <span className="chat-live-activity inline-flex items-center gap-2" data-testid="assistant-live-activity" data-activity-kind={kind} role="status" aria-live="polite">
      {kind === "tool" ? <LoaderCircle className="size-3.5 shrink-0 animate-spin opacity-65" aria-hidden /> : <Clock3 className="size-3.5 shrink-0 opacity-65" aria-hidden />}
      <span className="truncate">{label}</span>
    </span>
  )
}

const LoadingMessage = React.memo(({ label, paused = false, startedAt = null }: { label?: string; paused?: boolean; startedAt?: number | null }) => {
  const now = useElapsedNow(startedAt, true)
  const elapsed = startedAt === null ? null : formatElapsedDuration(now - startedAt)
  return (
  <Message className="mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-2 md:px-10" data-testid="assistant-loading">
    <div className="group flex w-full flex-col gap-0">
      <div className="chat-process-heading flex items-center gap-2 px-1 py-1 text-xs font-medium text-muted-foreground">
        {paused ? <Clock3 className="size-4 shrink-0" aria-hidden /> : null}
        <span>{label ? label : paused ? t("session.assistant_thinking") : <ThinkingIndicator />}{elapsed ? ` · ${t("message.elapsed_running", { duration: elapsed })}` : ""}</span>
      </div>
    </div>
  </Message>
  )
})

LoadingMessage.displayName = "LoadingMessage"

interface ErrorMessageProps {
  error: string | null
}

export function RunIssueNotice({ detail, kind, onDismiss, children }: {
  detail?: string | null
  kind?: "stopped" | "model-not-found"
  onDismiss?: () => void
  children?: React.ReactNode
}) {
  const interrupted = kind === "stopped" || /MessageAbortedError|run was interrupted before it finished/i.test(detail ?? "")
  const modelUnavailable = kind === "model-not-found" || /model is not supported|model (?:is )?not (?:available|found)|unsupported model/i.test(detail ?? "")
  const providerFailure = !interrupted && !modelUnavailable ? classifyProviderFailure(detail) : null
  const title = interrupted ? t("session.run_stopped_title")
    : modelUnavailable ? t("session.model_unavailable_title")
      : providerFailure?.code === "provider_auth_failed" ? t("session.provider_auth_title")
        : providerFailure?.code === "provider_quota_exhausted" ? t("session.provider_quota_title")
          : providerFailure?.code === "provider_rate_limited" ? t("session.provider_rate_title")
            : t("session.run_failed_title")
  const description = interrupted ? t("session.run_stopped_hint")
    : modelUnavailable ? t("session.model_unavailable_hint")
      : providerFailure?.code === "provider_auth_failed" ? t("session.provider_auth_hint")
        : providerFailure?.code === "provider_quota_exhausted" ? t("session.provider_quota_hint")
          : providerFailure?.code === "provider_rate_limited" ? t("session.provider_rate_hint")
            : t("session.run_failed_hint")

  return (
    <div className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground" role="status" data-testid="run-issue-notice">
      <div className="flex items-start gap-2">
        {interrupted ? <Clock3 size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-muted-foreground">{description}</p>
          {children ? <div className="mt-2">{children}</div> : null}
          {detail ? <details className="mt-2 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer hover:text-foreground">{t("session.error_details")}</summary>
            <div className="mt-2 rounded-md border border-border bg-background p-2">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono">{detail}</pre>
              <button type="button" className="mt-2 inline-flex items-center gap-1 hover:text-foreground" onClick={() => void navigator.clipboard.writeText(detail)}>
                <Copy size={12} aria-hidden />{t("session.copy_error_details")}
              </button>
            </div>
          </details> : null}
        </div>
        {onDismiss ? <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onDismiss} aria-label={t("session.dismiss_error")}>×</button> : null}
      </div>
    </div>
  )
}

function ErrorMessage({ error }: ErrorMessageProps) {
  return (
    <Message className="not-prose mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-0 md:px-10">
      <RunIssueNotice key={error} detail={error} />
    </Message>
  )
}

interface RetryMessageProps {
  status: RetryStatus
}

function RetryActionButton(props: { link: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      onClick={() => void openDesktopUrl(props.link)}
    >
      {props.label}
    </Button>
  )
}

const RetryMessage = React.memo(({ status }: RetryMessageProps) => {
  const [seconds, setSeconds] = React.useState(() => retryDelaySeconds(status))

  React.useEffect(() => {
    const update = () => setSeconds(retryDelaySeconds(status))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const info = status.attempt === 0 && status.next === 0
    ? t("session.model_connection_retry_wait")
    : seconds > 0
    ? t("session.retry_countdown", { seconds, attempt: status.attempt })
    : t("session.retry_attempt", { attempt: status.attempt })
  const action = status.action

  return (
    <Message className="not-prose mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-0 md:px-10">
      <div className="group flex w-full flex-col items-start gap-0">
        <div className="text-foreground flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
          <div className="flex items-start gap-2">
            <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{t("session.retry_recovering")}</p>
              <p className="text-xs text-muted-foreground">{info}</p>
            </div>
          </div>
          {action ? (
            <div className="ml-6 space-y-1 border-t border-border pt-2">
              <p className="text-xs font-medium">{action.title}</p>
              <p className="text-xs text-muted-foreground">{action.message}</p>
              {action.link ? (
                <RetryActionButton link={action.link} label={action.label} />
              ) : null}
            </div>
          ) : null}
          <details className="ml-6 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer hover:text-foreground">{t("session.error_details")}</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-2 font-mono">{status.message}</pre>
          </details>
        </div>
      </div>
    </Message>
  )
})

RetryMessage.displayName = "RetryMessage"

export function VideoJobStatus({ jobs }: { jobs: import("@ipollowork/types/workspace").SessionArtifactPage["videoJobs"] }) {
  // Avatar tasks have their own persistent progress dialog and compact history in Video Studio.
  const visible = (jobs ?? []).filter(job => job.model !== "minimax-h3-avatar" && job.status !== "succeeded" && job.status !== "stopped" && job.status !== "paused");
  const failedJobs = visible.filter(job => job.status === "failed" || job.status === "save_failed");
  const renderJob = (job: (typeof visible)[number]) => {
    const failed = job.status === "failed" || job.status === "save_failed";
    const label = job.status === "submitting" ? "submitting"
      : job.status === "running" ? "running"
      : job.status === "saving" ? "saving"
      : job.status === "uncertain" ? "uncertain"
      : job.status === "save_failed" ? "save_failed" : "failed";
    return <div key={job.id} role="status" data-video-job-status={job.status}
      className={cn("mx-auto w-full max-w-[800px] px-0 py-2 text-sm md:px-10", failed ? "text-destructive" : "text-muted-foreground")}>
      <p>{t(`session.video_job.${label}`)}</p>
      <p className="break-all text-xs">{job.model} · {job.id}</p>
    </div>;
  };
  return <>
    {visible.filter(job => job.status !== "failed" && job.status !== "save_failed").map(renderJob)}
    {failedJobs.length ? <details className="mx-auto w-full max-w-[800px] py-2 text-sm text-muted-foreground md:px-10">
      <summary className="cursor-pointer">{t("session.video_job.previous_failures", { count: failedJobs.length })}</summary>
      <p className="pt-2 text-xs">{t("session.video_job.independent_history")}</p>
      {failedJobs.map(renderJob)}
    </details> : null}
  </>;
}

const isMessageEmptyGroup = (messages: UIMessageWithIndex[]) =>
  messages.every(message => isEmptyMessage(message.message));

const getRenderableMessages = (messages: UIMessageWithIndex[]) =>
  messages.flatMap((item) => {
    const renderableMessage = getRenderableMessage(item.message);

    return renderableMessage ? [{ ...item, message: renderableMessage }] : []
  })

function getRenderableMessage(message: UIMessage) {
  const parts = message.parts.filter((part) => part.type === "text" || part.type === "file");

  return parts.length > 0 ? { ...message, parts } : null;
}

interface AssistantMessageGroupProps {
  items: UIMessageWithIndex[]
  messages: UIMessage[]
  isStreaming: boolean
  finalizing?: boolean
  templateEntryPath?: string
  artifactFiles?: readonly string[]
  artifactRequestOwnership?: readonly ArtifactRequestOwnership[]
  artifactContext?: ArtifactInteractionContext
  latestAssistantMessageId?: string
  activeAssistantMessageId?: string
  imageStatus?: "failed" | "stopped"
  runIncomplete?: boolean
  runOutcome?: "running" | "completed" | "failed" | "stopped" | null
  runStartedAt?: number | null
  runEndedAt?: number | null
  runTimings?: Record<string, { startedAt: number; endedAt: number }>
}

function MessageGroup({
  items,
  messages,
  isStreaming,
  finalizing = false,
  templateEntryPath,
  artifactFiles,
  artifactRequestOwnership = [],
  artifactContext,
  latestAssistantMessageId,
  activeAssistantMessageId,
  imageStatus,
  runIncomplete = false,
  runOutcome = null,
  runStartedAt = null,
  runEndedAt = null,
  runTimings = {},
}: AssistantMessageGroupProps) {
  const { onRevertToUserMessage, onForkAtMessage, sessionTitle, showThinking, waitingLabel } = useMessageList()
  const lastItem = items[items.length - 1]
  // Branch/revert must target a real server-side message id. Synthetic
  // client-side messages (e.g. session errors) don't exist on the server and
  // silently corrupt fork/revert boundaries.
  const lastRealItem = items.findLast((item) => !isSessionErrorMessage(item.message) && !isStudioResultMessage(item.message))
  const isLatestAssistantGroup = items.some(
    (item) => item.message.id === latestAssistantMessageId,
  )
  const isLiveGroup = isStreaming && items.some(
    (item) => item.message.id === activeAssistantMessageId,
  )
  const precedingUser = messages.slice(0, items[0].index).findLast((message) => message.role === "user" && !isInternalContinuationMessage(message))
  const latestUser = messages.findLast((message) => message.role === "user" && !isInternalContinuationMessage(message))
  const currentTurn = isLatestAssistantGroup && precedingUser?.id === latestUser?.id
  const liveProcess = isLiveGroup
  const artifactMessages = React.useMemo(
    () => getAssistantGroupArtifactMessages(items),
    [items],
  )
  const requestOrdinal = getAssistantRequestOrdinal(messages, items[0]?.index ?? 0)
  const requestArtifactFiles = React.useMemo(
    () => selectSupplementalArtifactsForRequest(
      artifactFiles ?? [],
      requestOrdinal,
      artifactRequestOwnership,
      isLatestAssistantGroup,
    ),
    [artifactFiles, artifactRequestOwnership, isLatestAssistantGroup, requestOrdinal],
  )
  const groupArtifacts = useArtifacts(artifactMessages, { supplementalFiles: requestArtifactFiles })
  const inlineImageArtifacts = React.useMemo(
    () => selectInlineImageArtifacts(artifactMessages, groupArtifacts),
    [artifactMessages, groupArtifacts],
  )
  const hasRequestArtifacts = React.useMemo(
    () => selectArtifactsForRequest(
      getArtifactsFromMessages(artifactMessages),
      requestOrdinal,
      artifactRequestOwnership,
    ).length > 0,
    [artifactMessages, artifactRequestOwnership, requestOrdinal],
  )
  const requestNaming = React.useMemo(
    () => artifactRequestNamingContext(messages, items[0]?.index ?? 0, sessionTitle),
    [items, messages, sessionTitle],
  )
  const scheduleApplyResult = React.useMemo(
    () => getScheduleApplyResult(artifactMessages),
    [artifactMessages],
  )

  if (!lastItem || (isMessageEmptyGroup(items) && requestArtifactFiles.length === 0)) {
    return null
  }

  const renderableItems = getRenderableMessages(items.filter((item) => !isSessionErrorMessage(item.message)))
  const lastTextMessage = lastRealItem ? getLastTextPart(lastRealItem.message) : null

  const itemRenderData = items.map((item) => {
    const groups = getAssistantRenderGroups(item.message.parts, showThinking)
    return { item, groups, sections: splitAssistantRenderGroups(groups) }
  })
  // Unphased text can be followed by more tools. Keep it in the live timeline
  // until the turn ends instead of moving the latest paragraph between sections.
  const resultItemIndex = itemRenderData.findLastIndex(({ item, groups }) =>
    ((!liveProcess && !runIncomplete) || isAssistantFinalAnswerMessage(item.message))
      && !isAssistantCommentaryMessage(item.message)
      && !isSessionErrorMessage(item.message)
      && (groups.some((group) => group.kind === "text" && Boolean(group.text.trim()))
        || (!liveProcess && !runIncomplete && groups.some((group) => group.kind === "file"))),
  )
  const resolvedResultItemIndex = resultItemIndex >= 0
    ? resultItemIndex
    : !liveProcess && !runIncomplete && (hasRequestArtifacts || requestArtifactFiles.length > 0)
      ? itemRenderData.findLastIndex(({ item }) => !isSessionErrorMessage(item.message))
      : -1
  const resultData = resolvedResultItemIndex >= 0 ? itemRenderData[resolvedResultItemIndex] : null
  const liveProgressData = liveProcess || runIncomplete
    ? itemRenderData.findLast(({ item, groups }, index) =>
        index > resolvedResultItemIndex
          && !isSessionErrorMessage(item.message)
          && groups.some((group) => group.kind === "text" && Boolean(group.text.trim())),
      )
    : null
  // Keep inline previews available while a response is streaming. They are
  // explicitly marked as previews by FileMessage and are not delivery cards;
  // the completed-file result area is gated separately by SessionSurface.
  const streamingFileGroups = liveProcess || runIncomplete
    ? itemRenderData.flatMap(({ groups }) => groups.filter((group) => group.kind === "file"))
    : []
  const resultTexts = new Set(resultData?.sections.resultGroups.flatMap((group) => group.kind === "text" ? [group.text.trim()] : []) ?? [])
  const processItemGroups = itemRenderData.map(({ item, groups, sections }, index) => {
    if (isSessionErrorMessage(item.message)) return []
    return (index === resolvedResultItemIndex ? sections.processGroups : groups).filter((group) => {
      if (group.kind === "text") return (liveProcess || item.message.id !== liveProgressData?.item.message.id) && !resultTexts.has(group.text.trim())
      return !((liveProcess || runIncomplete) && group.kind === "file")
    })
  })
  const processRows = groupProcessSteps(itemRenderData.flatMap(({ item }, itemIndex) =>
    processItemGroups[itemIndex].map((group, groupIndex) => ({
      key: `${item.message.id}:${groupIndex}`,
      messageId: item.message.id,
      group,
    })),
  ))
  const processRenderGroups = processItemGroups.flatMap((groups) => groups.filter(
    (group): group is AssistantProcessRenderGroup => group.kind !== "text",
  ))
  const activeTool = liveProcess
    ? processRenderGroups.findLast((group) => group.kind === "tool" && isToolPartInFlight(group.part))
    : undefined
  const activeToolLabel = activeTool?.kind === "tool" ? getToolActivityLabel(activeTool.part) : null
  const hasProcessContent = processItemGroups.some((groups) => groups.length > 0)
  const storedTiming = precedingUser ? runTimings[precedingUser.id] : undefined
  const processStartedAt = storedTiming?.startedAt
    ?? (currentTurn ? runStartedAt : null)
    ?? (precedingUser ? getMessageCreated(precedingUser) : null)
  const processCompletedAt = storedTiming?.endedAt
    ?? (currentTurn ? runEndedAt : null)
    ?? getMessageCompleted(lastRealItem?.message ?? lastItem.message)
  const processDurationMs = processStartedAt !== null
    && processCompletedAt !== null
    && processCompletedAt >= processStartedAt
    ? processCompletedAt - processStartedAt
    : null
  const hasSessionError = items.some((item) => isSessionErrorMessage(item.message))
  const sessionErrorItem = items.find((item) => isSessionErrorMessage(item.message))

  const renderProcessRow = (row: ProcessRow) => {
    const firstStep = row.kind === "tools" ? row.steps[0] : row.step
    const activeStep = row.kind === "tools" && liveProcess
      ? row.steps.findLast((step) => step.group.kind === "tool" && isToolPartInFlight(step.group.part))
      : undefined
    const action = row.kind === "tools" ? {
      inspect: { label: t("message.process_action_inspect"), Icon: FileSearch },
      edit: { label: t("message.process_action_edit"), Icon: FilePenLine },
      command: { label: t("message.process_action_command"), Icon: SquareTerminal },
      web: { label: t("message.process_action_web"), Icon: Globe },
      other: { label: t("message.process_action_other"), Icon: Wrench },
    }[row.action] : null
    return (
      <Message
        key={`process-${firstStep.key}`}
        className="mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-0"
        data-message-id={firstStep.messageId}
        data-message-role="assistant"
      >
        {row.kind === "tools" && action ? (
          <details className="chat-tool-action w-full" data-testid="assistant-tool-action" data-tool-action={row.action}>
            <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-2 rounded-md py-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <action.Icon className="size-4 shrink-0" aria-hidden />
              <span>{action.label}</span>
              {activeStep?.group.kind === "tool" ? (
                <span className="chat-tool-action-active min-w-0 truncate font-normal">
                  <LoaderCircle className="mr-1 inline size-3 animate-spin opacity-65" aria-hidden />
                  · {getToolActivityLabel(activeStep.group.part)}
                </span>
              ) : null}
              <ChevronRight className="chat-tool-action-chevron size-3.5 shrink-0 transition-transform" aria-hidden />
            </summary>
            <div className="flex w-full flex-col gap-1 pt-1 pl-6">
              {row.steps.map((step) => <div key={step.key}>{renderAssistantGroup(step.group, 0, { streaming: isLiveGroup, imageStatus, inlineImageArtifacts })}</div>)}
            </div>
          </details>
        ) : renderAssistantGroup(firstStep.group, 0, { streaming: isLiveGroup, imageStatus, inlineImageArtifacts })}
      </Message>
    )
  }

  return (
    <div className="group/message-group relative mt-4 flex flex-col gap-2.5 first:mt-0" data-testid="assistant-message-group">
      {hasProcessContent || processStartedAt !== null ? (
        <div className={ASSISTANT_COLUMN_CLASS_NAME} data-testid="assistant-process-column">
          <AssistantProcessDisclosure
            groups={processRenderGroups}
            isStreaming={liveProcess}
            completed={runOutcome === "completed" && currentTurn}
            finalizing={finalizing && isLiveGroup}
            hasError={hasSessionError || runIncomplete}
            stopped={runOutcome === "stopped" && currentTurn}
            hasDetails={hasProcessContent}
            startedAt={processStartedAt}
            endedAt={processCompletedAt}
            durationMs={processDurationMs}
            contentClassName={liveProcess ? undefined : "max-h-[520px] overflow-y-auto"}
          >
            <div className={cn("flex flex-col gap-3", ASSISTANT_TEXT_EDGES_CLASS_NAME)}>
              {processRows.map(renderProcessRow)}
            </div>
          </AssistantProcessDisclosure>
        </div>
      ) : null}
      {streamingFileGroups.length > 0 ? (
        <div className={cn(ASSISTANT_COLUMN_CLASS_NAME, "flex w-full flex-col gap-2")} data-testid="assistant-streaming-previews">
          {streamingFileGroups.map((group, index) => renderAssistantGroup(group, index, { streaming: isLiveGroup, imageStatus, inlineImageArtifacts }))}
        </div>
      ) : null}
      {liveProgressData && !liveProcess ? (
        <div className={cn(ASSISTANT_COLUMN_CLASS_NAME, ASSISTANT_TEXT_EDGES_CLASS_NAME)} data-testid="assistant-streaming-progress">
          {liveProgressData.groups.filter((group) => group.kind === "text").map((group, index) =>
            renderAssistantGroup(group, index, { streaming: isLiveGroup }),
          )}
        </div>
      ) : null}
      {liveProcess && !resultData && !hasSessionError ? (
        <p
          className={cn(ASSISTANT_COLUMN_CLASS_NAME, "text-muted-foreground")}
          data-testid="assistant-result-pending"
          data-chat-readable-text="true"
          role="status"
        >
          {waitingLabel ? <LiveActivityIndicator kind="waiting" label={waitingLabel} />
            : activeToolLabel ? <LiveActivityIndicator kind="tool" label={activeToolLabel} />
              : finalizing ? t("session.result_pending") : <ThinkingIndicator />}
        </p>
      ) : null}
      {resultData ? (
        <div className={ASSISTANT_TEXT_EDGES_CLASS_NAME} data-assistant-result="true">
          <MessageComponent
            message={resultData.item.message}
            artifactMessages={artifactMessages}
            isLastMessage={resultData.item.index === messages.length - 1}
            isStreaming={resultData.item.index === messages.length - 1 && isStreaming}
            isLastStep
            hideProcess
            showLatestArtifactsTitle={isLatestAssistantGroup}
            requestNaming={requestNaming}
            requestOrdinal={requestOrdinal}
            artifactRequestOwnership={artifactRequestOwnership}
            templateEntryPath={isLatestAssistantGroup ? templateEntryPath : undefined}
            artifactFiles={requestArtifactFiles}
            artifactContext={artifactContext}
            imageStatus={hasSessionError ? "failed" : imageStatus}
            deferFilesWhileStreaming={liveProcess}
          />
        </div>
      ) : null}
      {sessionErrorItem ? <ErrorMessage error={getMessagesText([sessionErrorItem.message]) || t("message.session_failed")} /> : null}
      {!isLiveGroup && scheduleApplyResult ? <ScheduleApplyResultCard result={scheduleApplyResult} /> : null}
      {lastTextMessage && !isStreaming && (
        <div
          className={cn(ASSISTANT_COLUMN_CLASS_NAME, "pointer-events-none absolute left-0 top-full z-10 flex flex-wrap items-center gap-2 opacity-0 transition-opacity duration-150 group-hover/message-group:pointer-events-auto group-hover/message-group:opacity-100 group-focus-within/message-group:pointer-events-auto group-focus-within/message-group:opacity-100")}
          data-testid="assistant-message-actions"
        >
          <MessageActions className={MESSAGE_ACTIONS_CLASS_NAME}>
            <CopyMessageButton messages={renderableItems.map((item) => item.message)} />
            <SaveMessageAsMarkdownButton messages={renderableItems.map((item) => item.message)} />
            <QuoteFollowUpButton messages={renderableItems.map((item) => item.message)} />
            {lastRealItem ? (
              <>
                <MessageAction tooltip={t("message.branch_new_chat")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("message.branch_new_chat")}
                    onClick={() => onForkAtMessage(lastRealItem.message.id)}
                  >
                    <Split className="rotate-90" />
                  </Button>
                </MessageAction>
                <MessageAction tooltip={t("message.revert")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("message.revert")}
                    onClick={() => onRevertToUserMessage(lastRealItem.message.id)}
                  >
                    <Undo2 />
                  </Button>
                </MessageAction>
              </>
            ) : null}
          </MessageActions>
          <MessageTimestamp message={lastRealItem?.message ?? lastItem.message} />
          {/* <MessageSources messages={items.map((item) => item.message)} /> */}
        </div>
      )}
      </div>
  )
}

interface MessageListProps {
  messages: UIMessage[]
  status: ThreadStatus
  retryStatus?: RetryStatus | null
  templateEntryPath?: string
  artifactFiles?: readonly string[]
  artifactRequestOwnership?: readonly ArtifactRequestOwnership[]
  artifactContext?: ArtifactInteractionContext
  activeMessageBaseline?: number | null
  assistantWaitLabel?: string
  stoppedImageMessageIds?: ReadonlySet<string>
  stopAcknowledged?: boolean
  runOutcome?: "running" | "completed" | "failed" | "stopped" | null
  finalizing?: boolean
  runStartedAt?: number | null
  runEndedAt?: number | null
  runTimings?: Record<string, { startedAt: number; endedAt: number }>
}

export function MessageList({ messages, status, retryStatus, templateEntryPath, artifactFiles, artifactRequestOwnership = [], artifactContext, activeMessageBaseline, assistantWaitLabel, stoppedImageMessageIds = EMPTY_STOPPED_IMAGE_MESSAGE_IDS, stopAcknowledged = false, runOutcome = null, finalizing = false, runStartedAt = null, runEndedAt = null, runTimings = {} }: MessageListProps) {
  const { sessionTitle, waitingLabel } = useMessageList()
  const deliveredPaths = React.useMemo(() => getArtifactsFromMessages(messages.filter(isStudioResultMessage)).map(artifact => artifact.path), [messages])
  const isStreaming = !stopAcknowledged && (runOutcome === "running" || (runOutcome === null && (status === "submitted" || status === "streaming" || status === "retrying")))
  const items = React.useMemo(() => groupMessages(messages), [messages])
  const supplementalArtifactFiles = React.useMemo(
    () => [...new Set([
      ...(artifactFiles ?? []),
      ...artifactRequestOwnership.flatMap((entry) => entry.paths),
    ])],
    [artifactFiles, artifactRequestOwnership],
  )
  const resolvedArtifactRequestOwnership = React.useMemo(
    () => artifactRequestOwnership.reduce(
      (current, entry) => assignArtifactRequestOwnership(
        current,
        entry.requestOrdinal,
        entry.paths,
      ),
      inferArtifactRequestOwnership(messages, supplementalArtifactFiles),
    ),
    [artifactRequestOwnership, messages, supplementalArtifactFiles],
  )
  const latestAssistantMessageId = React.useMemo(
    () => getLatestArtifactAssistantMessageId(messages),
    [messages],
  )
  const latestTurnAssistantMessageId = React.useMemo(() => {
    const latestUserIndex = messages.findLastIndex(message => message.role === "user" && !isInternalContinuationMessage(message))
    return getLatestArtifactAssistantMessageId(messages.slice(latestUserIndex + 1))
  }, [messages])
  const activeAssistantMessageId = React.useMemo(
    () => isStreaming ? getActiveAssistantMessageId(messages.filter(message => !isStudioResultMessage(message)), activeMessageBaseline) : undefined,
    [activeMessageBaseline, isStreaming, messages],
  )
  const error = useSessionErrorMessage();
  const hasSessionErrorMessage = React.useMemo(() => messages.some(isSessionErrorMessage), [messages])
  const liveActionLabel = isStreaming
    ? getActiveToolLabel(collectToolParts(messages))
    : null

  return (
    <StudioDeliveryPaths.Provider value={deliveredPaths}>
    <div className={cn("flex flex-col gap-2 @container/message-list")} data-chat-transcript>
      {items.map((item) => {
        if (isMessageGroup(item)) {
          return (
            <MessageGroup
              key={item.messages[0]?.message.id ?? "empty-assistant-group"}
              items={item.messages}
              messages={messages}
              isStreaming={isStreaming}
              finalizing={finalizing}
              runOutcome={runOutcome}
              runStartedAt={runStartedAt}
              runEndedAt={runEndedAt}
              runTimings={runTimings}
              templateEntryPath={templateEntryPath}
              artifactFiles={supplementalArtifactFiles}
              artifactRequestOwnership={resolvedArtifactRequestOwnership}
              artifactContext={artifactContext}
              latestAssistantMessageId={latestAssistantMessageId}
              activeAssistantMessageId={activeAssistantMessageId}
              runIncomplete={Boolean(error || stopAcknowledged) && item.messages.some(({ message }) => message.id === latestTurnAssistantMessageId)}
              imageStatus={error && item.messages.some(({ message }) => message.id === latestTurnAssistantMessageId)
                ? "failed"
                : item.messages.some(({ message }) => stoppedImageMessageIds.has(message.id))
                  ? "stopped" : undefined}
            />
          )
        }

        const isLastMessage = item.index === messages.length - 1
        const isLastStep =
          !messages[item.index + 1] || messages[item.index + 1].role !== item.message.role
        const requestOrdinal = item.message.role === "assistant"
          ? getAssistantRequestOrdinal(messages, item.index)
          : null
        const requestArtifactFiles = item.message.role === "assistant"
          ? selectSupplementalArtifactsForRequest(
              supplementalArtifactFiles,
              requestOrdinal,
              resolvedArtifactRequestOwnership,
              item.message.id === latestAssistantMessageId,
            )
          : undefined

        return (
          <div key={item.message.id} className="mt-8 first:mt-0">
            <MessageComponent
              message={item.message}
              isLastMessage={isLastMessage}
              isStreaming={isLastMessage && isStreaming && !isStudioResultMessage(item.message)}
              isLastStep={isLastStep}
              showLatestArtifactsTitle={item.message.id === latestAssistantMessageId}
              requestNaming={item.message.role === "assistant"
                ? artifactRequestNamingContext(messages, item.index, sessionTitle)
                : undefined}
              requestOrdinal={requestOrdinal}
              artifactRequestOwnership={resolvedArtifactRequestOwnership}
              templateEntryPath={item.message.id === latestAssistantMessageId ? templateEntryPath : undefined}
              artifactFiles={isStudioResultMessage(item.message) ? undefined : requestArtifactFiles}
              artifactContext={artifactContext}
              imageStatus={error && item.message.id === latestTurnAssistantMessageId
                ? "failed"
                : stoppedImageMessageIds.has(item.message.id)
                  ? "stopped" : undefined}
            />
          </div>
        )
      })}

      {(status === "submitted" || status === "streaming") && !activeAssistantMessageId
        && !hasActiveAssistantVisibleResult(messages, activeMessageBaseline)
        ? <LoadingMessage label={waitingLabel ?? liveActionLabel ?? assistantWaitLabel ?? undefined} paused={Boolean(waitingLabel)} startedAt={runStartedAt} />
        : null}
      {retryStatus ? <RetryMessage status={retryStatus} /> : null}
      {error && !hasSessionErrorMessage ? <ErrorMessage error={error} /> : null}
      {stopAcknowledged && !error && !hasSessionErrorMessage ? <Message className="not-prose mx-auto w-full max-w-[800px] px-0 md:px-10"><RunIssueNotice kind="stopped" /></Message> : null}
    </div>
    </StudioDeliveryPaths.Provider>
  )
}
