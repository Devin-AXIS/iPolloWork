"use memo";

import * as React from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileIcon,
  LoaderCircle,
  Pencil,
  Quote,
  Split,
  Undo2,
} from "lucide-react"
import {
  DynamicToolUIPart,
  isFileUIPart,
  ToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
import { openDesktopUrl } from "@/app/lib/desktop"
import { downloadTextAsFile } from "@/app/lib/download"
import { publicAssetUrl } from "@/app/lib/public-asset"
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
import { ArtifactList } from "@/components/chat/artifact"
import type { ArtifactInteractionContext } from "@/lib/artifacts"
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
} from "@/lib/tool-activity"
import { cn } from "@/lib/utils"
import { assistantResponseMarkdownFilename, buildAssistantResponseMarkdown, buildQuoteFollowUpPrompt, groupMessages, isMessageGroup, getLastTextPart, getAssistantRenderGroups, getFileTitle, getMediaBadge, getMessageCompleted, getMessageCreated, formatMessageTimestamp, formatProcessDuration, type UIMessageWithIndex, getMessagesText, isInternalContinuationMessage, splitAssistantRenderGroups, type AssistantProcessRenderGroup } from "./utils"

const SEARCH_HIGHLIGHT_MARK_CLASS = "rounded px-0.5 bg-amber-4/70 text-current"

type RenderAssistantGroupOptions = {
  highlightQuery?: string
}

function renderAssistantGroup(group: ReturnType<typeof getAssistantRenderGroups>[number], index: number, options: RenderAssistantGroupOptions = {}) {
  if (group.kind === "text") {
    return (
      <MessageContent
        key={`text-${index}`}
        className="text-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
        markdown
        highlightQuery={options.highlightQuery}
      >
        {group.text}
      </MessageContent>
    )
  }

  if (group.kind === "reasoning") {
    return (
      <MessageContent
        key={`reasoning-${index}`}
        className="text-muted-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
        markdown
      >
        {group.text}
      </MessageContent>
    )
  }

  if (group.kind === "file") {
    return (
      <div key={`file-${index}`} className="w-full">
        <FileMessage part={group.part} tone="assistant" />
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
    (message) => message.role === "assistant" && !isSessionErrorMessage(message),
  )?.id
}

export function getAssistantGroupArtifactMessages(items: UIMessageWithIndex[]) {
  return items.map((item) => item.message)
}

function retryDelaySeconds(status: RetryStatus) {
  return Math.max(0, Math.round((status.next - Date.now()) / 1000))
}

interface FileMessageProps {
  part: FileUIPart
  tone: "user" | "assistant"
}

// TODO: Add tone to the file message
function FileMessage({ part }: FileMessageProps) {
  const title = getFileTitle(part)
  const badge = getMediaBadge(part)
  const isImage = part.mediaType.startsWith("image/") && part.url

  if (isImage) {
    return (
      <Image
        src={part.url}
        alt={title}
        loading="lazy"
        decoding="async"
      />
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
  templateEntryPath?: string
  artifactFiles?: readonly string[]
  artifactContext?: ArtifactInteractionContext
}

function assistantProcessSummary(groups: AssistantProcessRenderGroup[], durationMs: number | null) {
  let reasoningCount = 0
  let toolCount = 0
  let fileCount = 0

  for (const group of groups) {
    if (group.kind === "reasoning") {
      reasoningCount += 1
    } else if (group.kind === "tool") {
      toolCount += 1
    } else {
      fileCount += 1
    }
  }

  const segments: string[] = []
  if (reasoningCount > 0) segments.push(t("message.process_reasoning_count", { count: reasoningCount }))
  if (toolCount > 0) segments.push(t("message.process_tool_count", { count: toolCount }))
  if (fileCount > 0) segments.push(t("message.process_file_count", { count: fileCount }))
  if (durationMs !== null) segments.push(t("message.process_duration", { duration: formatProcessDuration(durationMs) }))
  return segments.length > 0 ? segments.join(" · ") : t("message.process_steps")
}

function AssistantProcessDisclosure(props: {
  groups: AssistantProcessRenderGroup[]
  isStreaming: boolean
  durationMs: number | null
  children: React.ReactNode
  contentClassName?: string
}) {
  const { groups, isStreaming, durationMs, children, contentClassName } = props
  const [isOpen, setIsOpen] = React.useState(isStreaming)
  const previousStreamingRef = React.useRef(isStreaming)

  React.useEffect(() => {
    if (isStreaming) {
      setIsOpen(true)
    } else if (previousStreamingRef.current) {
      setIsOpen(false)
    }
    previousStreamingRef.current = isStreaming
  }, [isStreaming])

  const label = isStreaming ? t("message.process_in_progress") : t("message.process_completed")

  return (
    <div className="w-full">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 rounded-md px-0 py-1 text-left text-sm transition-colors"
        aria-expanded={isOpen}
        aria-label={isOpen ? t("message.collapse_process") : t("message.expand_process")}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isStreaming ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Check className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">
          {label}
          <span className="ml-1 text-muted-foreground/75">{assistantProcessSummary(groups, durationMs)}</span>
        </span>
        <ChevronDown className={cn("ml-auto size-3.5 shrink-0 transition-transform", isOpen && "rotate-180")} aria-hidden />
      </button>
      {isOpen ? (
        <div className={cn("mt-2 flex w-full flex-col gap-2 border-l border-border/70 pl-4", contentClassName)}>
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
}) {
  const { groups, isStreaming, durationMs } = props

  if (groups.length === 0) {
    return null
  }

  return (
    <AssistantProcessDisclosure groups={groups} isStreaming={isStreaming} durationMs={durationMs}>
      {groups.map((group, index) => renderAssistantGroup(group, index))}
    </AssistantProcessDisclosure>
  )
}

const AssistantMessage = React.memo(
  ({ message, artifactMessages, isStreaming, hideProcess = false, showLatestArtifactsTitle = false, templateEntryPath, artifactFiles, artifactContext }: AssistantMessageProps) => {
    const { showThinking, highlightQuery, sessionId, onOpenVideoStudio } = useMessageList()
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

    return (
      <Message
        className="mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-2 md:px-10"
        data-message-id={message.id}
        data-message-role={message.role}
      >
        <div className="group flex w-full flex-col gap-0 space-y-2">
          {hideProcess ? null : (
            <AssistantProcessSection
              groups={assistantRenderSections.processGroups}
              isStreaming={isStreaming}
              durationMs={durationMs}
            />
          )}
          {assistantRenderSections.resultGroups.map((group, index) =>
            renderAssistantGroup(group, index, { highlightQuery })
          )}
          {!isStreaming ? (
            <ArtifactList
              messages={artifactMessages ?? [message]}
              sessionId={sessionId}
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

type IllustrationReferenceDataPart = UIMessage["parts"][number] & {
  type: "data-illustration-reference"
  data: { id: string; label: string; repository: string }
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

function isIllustrationReferenceDataPart(part: UIMessage["parts"][number]): part is IllustrationReferenceDataPart {
  if (part.type !== "data-illustration-reference" || !part.data || typeof part.data !== "object") return false
  const data = part.data as { id?: unknown; label?: unknown; repository?: unknown }
  return typeof data.id === "string" && Boolean(data.id.trim())
    && typeof data.label === "string" && Boolean(data.label.trim())
    && typeof data.repository === "string" && Boolean(data.repository.trim())
}

function UserReferenceChip(props: { label: string; kind: "design" | "animation" | "voice" | "illustration" }) {
  return (
    <span
      data-message-design-selection={props.kind === "design" ? "true" : undefined}
      data-message-animation-reference={props.kind === "animation" ? "true" : undefined}
      data-message-voice-reference={props.kind === "voice" ? "true" : undefined}
      data-message-illustration-reference={props.kind === "illustration" ? "true" : undefined}
      className="inline-flex max-w-full items-center rounded-full border border-violet-6/35 bg-violet-3/20 px-2.5 py-1 text-xs font-medium text-violet-11"
      title={`${props.kind === "design" ? "Design selection" : props.kind === "animation" ? "Animation reference" : props.kind === "voice" ? "Voice reference" : "Illustration reference"}: ${props.label}`}
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
              <div className="group flex w-full flex-col items-end gap-1">
                {message.parts.filter(isFileUIPart).map((part, index) => (
                  <FileMessage key={`${part.url}-${index}`} part={part} tone="user" />
                ))}
                {message.parts.some((part) => (
                  isDesignSelectionDataPart(part)
                  || isAnimationReferencesDataPart(part)
                  || isVoiceReferenceDataPart(part)
                  || isIllustrationReferenceDataPart(part)
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
                      if (isIllustrationReferenceDataPart(part)) {
                        return [<UserReferenceChip key={`illustration:${part.data.id}`} label={`插画 · ${part.data.label}`} kind="illustration" />]
                      }
                      return []
                    })}
                  </div>
                ) : null}
                {message.parts.some((part) => part.type === "text" && part.text) ? (
                  <MessageContent
                    layoutId={message.id}
                    className="bg-muted text-foreground max-w-[85%] rounded-3xl px-5 py-2.5 whitespace-pre-wrap sm:max-w-[75%]"
                  >
                    {renderUserTextWithSkillChips(message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""), highlightQuery)}
                  </MessageContent>
                ) : null}
                {!isStreaming && (
                  <MessageActions
                    className={cn(
                      "flex items-center gap-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    )}
                  >
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
  templateEntryPath?: string
  artifactFiles?: readonly string[]
  artifactContext?: ArtifactInteractionContext
}

const MessageComponent = React.memo(
  ({ message, artifactMessages, isLastMessage, isStreaming, isLastStep, hideProcess, showLatestArtifactsTitle, templateEntryPath, artifactFiles, artifactContext }: MessageComponentProps) => {
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
          templateEntryPath={templateEntryPath}
          artifactFiles={artifactFiles}
          artifactContext={artifactContext}
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

const LoadingMessage = React.memo(({ label }: { label?: string }) => (
  <Message className="mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-2 md:px-10">
    <div className="group flex w-full flex-col gap-0">
      <div className="flex items-center gap-2 px-1 py-1 text-sm text-muted-foreground">
        <img
          src={publicAssetUrl("ipollowork-thinking-logo-v2.gif")}
          alt=""
          aria-hidden="true"
          className="size-6 shrink-0 object-contain"
        />
        <span>{label ?? t("session.assistant_thinking")}</span>
      </div>
    </div>
  </Message>
))

LoadingMessage.displayName = "LoadingMessage"

interface ErrorMessageProps {
  error: string | null
}

function ErrorMessage({ error }: ErrorMessageProps) {
  return (
    <Message className="not-prose mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-0 md:px-10">
      <div className="group flex w-full flex-col items-start gap-0">
        <div className="text-foreground flex min-w-0 flex-1 flex-row items-start gap-2 rounded-lg border-2 border-red-300 bg-red-300/20 px-2 py-1">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
          <p className="whitespace-pre-wrap text-destructive">{error}</p>
        </div>
      </div>
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
      className="h-7 border-amber-500/70 bg-amber-50 text-xs text-amber-950 hover:bg-amber-100"
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

  const info = seconds > 0
    ? `Retrying in ${seconds}s · attempt ${status.attempt}`
    : `Retrying · attempt ${status.attempt}`
  const action = status.action

  return (
    <Message className="not-prose mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-0 md:px-10">
      <div className="group flex w-full flex-col items-start gap-0">
        <div className="text-foreground flex min-w-0 flex-1 flex-col gap-2 rounded-lg border-2 border-amber-300 bg-amber-300/20 px-3 py-2">
          <div className="flex items-start gap-2">
            <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-amber-700" />
            <div className="min-w-0 space-y-1">
              <p className="whitespace-pre-wrap text-sm font-medium text-amber-900">{status.message}</p>
              <p className="text-xs text-amber-800">{info}</p>
            </div>
          </div>
          {action ? (
            <div className="ml-6 space-y-1 border-t border-amber-400/60 pt-2">
              <p className="text-xs font-medium text-amber-950">{action.title}</p>
              <p className="text-xs text-amber-900">{action.message}</p>
              {action.link ? (
                <RetryActionButton link={action.link} label={action.label} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Message>
  )
})

RetryMessage.displayName = "RetryMessage"

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
  templateEntryPath?: string
  artifactFiles?: readonly string[]
  artifactContext?: ArtifactInteractionContext
  latestAssistantMessageId?: string
}

function MessageGroup({
  items,
  messages,
  isStreaming,
  templateEntryPath,
  artifactFiles,
  artifactContext,
  latestAssistantMessageId,
}: AssistantMessageGroupProps) {
  const { onRevertToUserMessage, onForkAtMessage, showThinking } = useMessageList()
  const lastItem = items[items.length - 1]
  // Branch/revert must target a real server-side message id. Synthetic
  // client-side messages (e.g. session errors) don't exist on the server and
  // silently corrupt fork/revert boundaries.
  const lastRealItem = items.findLast((item) => !isSessionErrorMessage(item.message))
  const isLiveGroup = isStreaming
    && lastItem !== undefined
    && messages.slice(lastItem.index + 1).every(isInternalContinuationMessage)
  const stepsRef = React.useRef<HTMLDivElement>(null)
  const artifactMessages = React.useMemo(
    () => getAssistantGroupArtifactMessages(items),
    [items],
  )

  // Keep the capped step run pinned to the latest step while streaming.
  React.useEffect(() => {
    const node = stepsRef.current
    if (node && isLiveGroup) {
      node.scrollTop = node.scrollHeight
    }
  })

  if (!lastItem || isMessageEmptyGroup(items)) {
    return null
  }

  const renderableItems = getRenderableMessages(items)
  const lastTextMessage = getLastTextPart(lastItem.message)

  const itemRenderData = items.map((item) => {
    const groups = getAssistantRenderGroups(item.message.parts, showThinking)
    return { item, groups, sections: splitAssistantRenderGroups(groups) }
  })
  const isLatestAssistantGroup = items.some(
    (item) => item.message.id === latestAssistantMessageId,
  )
  const textResultItemIndex = itemRenderData.findLastIndex(({ groups }) =>
    groups.some((group) => group.kind === "text" && Boolean(group.text.trim())),
  )
  const resultItemIndex = isLiveGroup
    ? -1
    : textResultItemIndex >= 0
      ? textResultItemIndex
      : isLatestAssistantGroup && artifactFiles?.length
        ? itemRenderData.length - 1
        : -1
  const resultData = resultItemIndex >= 0 ? itemRenderData[resultItemIndex] : null
  const processRenderGroups = itemRenderData.flatMap(({ groups, sections }, index) => {
    const processGroups = index === resultItemIndex ? sections.processGroups : groups
    return processGroups.filter(
      (group): group is AssistantProcessRenderGroup => group.kind !== "text",
    )
  })
  const hasProcessContent = itemRenderData.some(({ groups, sections }, index) =>
    (index === resultItemIndex ? sections.processGroups : groups).length > 0,
  )
  const processStartedAt = getMessageCreated(items[0].message)
  const processCompletedAt = getMessageCompleted(lastItem.message)
  const processDurationMs = processStartedAt !== null
    && processCompletedAt !== null
    && processCompletedAt >= processStartedAt
    ? processCompletedAt - processStartedAt
    : null

  const renderProcessItem = (
    data: (typeof itemRenderData)[number],
    groupIndex: number,
  ) => {
    const groups = groupIndex === resultItemIndex ? data.sections.processGroups : data.groups
    if (groups.length === 0) return null

    return (
      <Message
        key={`process-${data.item.message.id}`}
        className="mx-auto flex w-full max-w-[800px] flex-col items-start gap-2 px-0"
        data-message-id={data.item.message.id}
        data-message-role={data.item.message.role}
      >
        <div className="flex w-full flex-col gap-2">
          {groups.map((group, index) => renderAssistantGroup(group, index))}
        </div>
      </Message>
    )
  }

  return (
      <div className="flex flex-col gap-2 group/message-group">
      {hasProcessContent ? (
        <AssistantProcessDisclosure
          groups={processRenderGroups}
          isStreaming={isLiveGroup}
          durationMs={processDurationMs}
          contentClassName="max-h-[520px] overflow-y-auto"
        >
          <div ref={stepsRef}>
            {itemRenderData.map(renderProcessItem)}
          </div>
        </AssistantProcessDisclosure>
      ) : null}
      {resultData ? (
        <MessageComponent
          message={resultData.item.message}
          artifactMessages={artifactMessages}
          isLastMessage={resultData.item.index === messages.length - 1}
          isStreaming={resultData.item.index === messages.length - 1 && isStreaming}
          isLastStep
          hideProcess
          showLatestArtifactsTitle={isLatestAssistantGroup}
          templateEntryPath={isLatestAssistantGroup ? templateEntryPath : undefined}
          artifactFiles={isLatestAssistantGroup ? artifactFiles : undefined}
          artifactContext={artifactContext}
        />
      ) : null}
      {lastTextMessage && !isStreaming && (
        <div className="mx-auto flex w-full max-w-[800px] flex-wrap items-center gap-2 px-2 opacity-0 transition-opacity duration-150 group-hover/message-group:opacity-100 md:px-8">
          <MessageActions className="flex gap-0">
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
          <MessageTimestamp message={lastItem.message} />
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
  artifactContext?: ArtifactInteractionContext
}

export function MessageList({ messages, status, retryStatus, templateEntryPath, artifactFiles, artifactContext }: MessageListProps) {
  const isStreaming = status === "submitted" || status === "streaming" || status === "retrying"
  const items = React.useMemo(() => groupMessages(messages), [messages])
  const latestAssistantMessageId = React.useMemo(
    () => getLatestArtifactAssistantMessageId(messages),
    [messages],
  )
  const error = useSessionErrorMessage();
  const hasSessionErrorMessage = React.useMemo(() => messages.some(isSessionErrorMessage), [messages])
  const liveActionLabel = isStreaming
    ? getActiveToolLabel(collectToolParts(messages))
    : null

  return (
    <div className={cn("flex flex-col gap-2 @container/message-list")}>
      {items.map((item) => {
        if (isMessageGroup(item)) {
          return (
            <MessageGroup
              key={item.messages[0]?.message.id ?? "empty-assistant-group"}
              items={item.messages}
              messages={messages}
              isStreaming={isStreaming}
              templateEntryPath={templateEntryPath}
              artifactFiles={artifactFiles}
              artifactContext={artifactContext}
              latestAssistantMessageId={latestAssistantMessageId}
            />
          )
        }

        const isLastMessage = item.index === messages.length - 1
        const isLastStep =
          !messages[item.index + 1] || messages[item.index + 1].role !== item.message.role

        return (
          <div key={item.message.id}>
            <MessageComponent
              message={item.message}
              isLastMessage={isLastMessage}
              isStreaming={isLastMessage && isStreaming}
              isLastStep={isLastStep}
              showLatestArtifactsTitle={item.message.id === latestAssistantMessageId}
              templateEntryPath={item.message.id === latestAssistantMessageId ? templateEntryPath : undefined}
              artifactFiles={item.message.id === latestAssistantMessageId ? artifactFiles : undefined}
              artifactContext={artifactContext}
            />
          </div>
        )
      })}

      {status === "streaming" && <LoadingMessage label={liveActionLabel ?? undefined} />}
      {retryStatus ? <RetryMessage status={retryStatus} /> : null}
      {error && !hasSessionErrorMessage ? <ErrorMessage error={error} /> : null}
    </div>
  )
}
