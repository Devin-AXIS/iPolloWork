import { isReasoningUIPart, isToolUIPart, type DynamicToolUIPart, type FileUIPart, type ToolUIPart, type UIMessage } from "ai"
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "@/app/types"
import { t } from "@/i18n"
import { formatFileSize } from "@/lib/utils"
import {
  type ArtifactItem,
  getArtifactStudioTarget,
  getArtifactTypeLabel,
} from "@/lib/artifacts"

interface MessageGroup {
  messages: UIMessageWithIndex[]
}

export type UIMessageWithIndex = { index: number, message: UIMessage }
type MessageListItem = MessageGroup | UIMessageWithIndex

export type ScheduleApplyResult = {
  itemCount: number
  focusAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    return value
  }
}

function findScheduleApplyPayload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4) return null
  const parsed = parseJson(value)
  if (isRecord(parsed)) {
    if (parsed.ok === true && Array.isArray(parsed.items)) return parsed
    for (const key of ["structuredContent", "result", "output", "content", "text"]) {
      const nested = findScheduleApplyPayload(parsed[key], depth + 1)
      if (nested) return nested
    }
    return null
  }
  if (!Array.isArray(parsed)) return null
  for (const item of parsed.slice(0, 20)) {
    const nested = findScheduleApplyPayload(item, depth + 1)
    if (nested) return nested
  }
  return null
}

export function getScheduleApplyResult(messages: readonly UIMessage[]): ScheduleApplyResult | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message) continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!part || !isToolUIPart(part) || part.state !== "output-available") continue
      const toolName = part.type === "dynamic-tool" ? part.toolName : part.type
      if (!toolName.toLowerCase().endsWith("ipollowork_schedule_apply")) continue
      const payload = findScheduleApplyPayload(part.output)
      if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) continue
      const scheduledTimes = payload.items.flatMap((item) => {
        if (!isRecord(item)) return []
        const value = typeof item.startAt === "number" ? item.startAt : item.dueAt
        return typeof value === "number" && Number.isFinite(value) ? [value] : []
      })
      if (scheduledTimes.length === 0) continue
      return { itemCount: payload.items.length, focusAt: Math.min(...scheduledTimes) }
    }
  }
  return null
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

export function getMessagesText(messages: UIMessage[]): string {
  return messages
    .map(getMessageText)
    .filter(Boolean)
    .join("\n\n")
}

export function buildAssistantResponseMarkdown(text: string): string {
  return `${text.trim()}\n`
}

const ARTIFACT_TITLE_FIELD_PATTERN = /(?:视频主题|设计主题|网页主题|演示主题|PPT主题|主题|标题)\s*[：:]\s*(.+?)(?=\s+(?:面向谁|受众|目标|想传达|核心内容|总?时长|场景(?:数)?|页数)\s*[：:]|$)/i

export function artifactCardTitle(requestTitle: string, fallbackTitle: string) {
  const structuredTitle = ARTIFACT_TITLE_FIELD_PATTERN.exec(requestTitle)?.[1]
    ?.replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/AI\s*Agent/gi, "AI Agent")
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, "$1 $2")
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, "$1 $2")
    .trim()
  return structuredTitle || fallbackTitle.replace(/\.html?$/i, "")
}

export function artifactCardDescription(artifact: ArtifactItem, sourceText: string) {
  const studioTarget = getArtifactStudioTarget(artifact)
  const type = studioTarget?.surface === "video" ? "video" : artifact.type
  const typeLabel = type === "video"
    ? t("session.outputs.kind_video")
    : type === "slides"
      ? t("session.outputs.kind_slides")
      : type === "image"
        ? t("session.outputs.kind_image")
        : type === "html" || type === "website"
          ? t("session.outputs.kind_design")
          : getArtifactTypeLabel(type)
  const duration = /(?:总?时长\s*[：:]?\s*)?(\d{1,4})\s*(?:秒|seconds?|secs?\b|s\b)/i.exec(sourceText)?.[1]
  const scenes = /(\d{1,3})\s*(?:个\s*)?场景|(?:scene count|scenes?)\s*[：:]?\s*(\d{1,3})/i.exec(sourceText)
  const sceneCount = scenes?.[1] ?? scenes?.[2]
  const imageFormat = type === "image" ? artifact.path.split(".").at(-1)?.toUpperCase() : null
  const imageSize = type === "image" && artifact.target.size !== undefined
    ? formatFileSize(artifact.target.size)
    : null

  return [
    imageFormat || typeLabel,
    imageSize,
    duration ? t("session.outputs.duration_seconds", { count: Number(duration) }) : null,
    sceneCount ? t("session.outputs.scene_count", { count: Number(sceneCount) }) : null,
  ].filter(Boolean).join(" · ")
}

function normalizedArtifactPath(path: string) {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  return /(?:^|\/)((?:design|video)\/[^\s]+)$/i.exec(normalized)?.[1] ?? normalized
}

/** Keep delivery paths in the artifact card instead of repeating path-only lines in the reply. */
export function stripArtifactPathLines(text: string, artifactPaths: readonly string[]) {
  const paths = artifactPaths.map(normalizedArtifactPath).filter(Boolean)
  if (paths.length === 0) return text

  return text
    .split(/\r?\n/)
    .filter((line) => {
      const normalizedLine = line.replaceAll("\\", "/").replace(/[`*_]/g, "").trim()
      const labelledPath = /^(?:生成文件|更新(?:文件)?|音频(?:位于|文件)?|文件(?:路径)?|输出(?:文件)?|保存(?:到|至)?|路径|generated file|updated file|audio(?: files?)?|file|output|saved to)\s*[:：-]/i.test(normalizedLine)
      if (labelledPath) return false
      if (/^(?:\.\/)?(?:design|video)\/[^\s]+\.[a-z][a-z0-9]{0,9}[。.;；]?$/i.test(normalizedLine)) return false

      const mentionedPath = paths.find((path) => normalizedLine.includes(path))
      if (!mentionedPath) return true

      const withoutPunctuation = normalizedLine.replace(/[。.;；]+$/, "").trim()
      const standalonePath = withoutPunctuation === mentionedPath
        || withoutPunctuation === `./${mentionedPath}`
      return !standalonePath
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
}

export function assistantResponseMarkdownFilename(title: string, timestamp = new Date()): string {
  const safeTitle = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "ipollowork-response"
  const safeTimestamp = timestamp.toISOString().replace(/[:.]/g, "-")
  return `${safeTitle}-${safeTimestamp}.md`
}

export function buildQuoteFollowUpPrompt(text: string): string {
  const quote = text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")

  return `${quote}\n\n${t("message.quote_follow_up_prompt")}`
}

export function sessionMarkdownFilename(title: string, timestamp = new Date()): string {
  const safeTitle = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "ipollowork-session"
  const safeTimestamp = timestamp.toISOString().replace(/[:.]/g, "-")
  return `${safeTitle}-${safeTimestamp}.md`
}

function markdownSection(title: string, body: string) {
  return `## ${title}\n\n${body.trim() || "_No visible text._"}`
}

export function buildSessionMarkdown(title: string, messages: UIMessage[]): string {
  const sections = messages.flatMap((message, index) => {
    const text = getMessageText(message)
    if (!text) return []
    const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : message.role
    return [markdownSection(`${index + 1}. ${role}`, text)]
  })
  const heading = `# ${title.trim() || "iPolloWork session"}`
  return `${heading}\n\n${sections.join("\n\n")}\n`
}

export function buildReviseFilePrompt(path: string): string {
  return `${t("session.outputs.revise_file_prompt")} ${path}`
}

export function getLastTextPart(message: UIMessage): UIMessage | null {
  const lastTextPart = message.parts.findLast((part) => part.type === "text")

  return lastTextPart ? { ...message, parts: [lastTextPart] } : null
}

export function getFileUrl(part: FileUIPart) {
  return typeof part.url === "string" ? part.url : ""
}

export function getFileMediaType(part: FileUIPart) {
  return typeof part.mediaType === "string" ? part.mediaType : ""
}

export function getFileTitle(part: FileUIPart) {
  if (part.filename) {
    return part.filename
  }

  const url = getFileUrl(part)
  if (url.startsWith("data:")) {
    return "Attached file"
  }

  return url || "File"
}

export function getMediaBadge(part: FileUIPart) {
  const mediaType = getFileMediaType(part)
  if (mediaType && mediaType !== "application/octet-stream") {
    return mediaType.replace(/^application\//, "").replace(/^text\//, "").toUpperCase()
  }

  return part.filename?.split(".").pop()?.toUpperCase() ?? null
}

export function getMessageCreated(message: UIMessage): number | null {
  return getMessageOpencodeTime(message, "created")
}

export function getMessageCompleted(message: UIMessage): number | null {
  return getMessageOpencodeTime(message, "completed")
}

function getMessageOpencodeTime(message: UIMessage, key: "created" | "completed"): number | null {
  const metadata: unknown = message.metadata
  if (!metadata || typeof metadata !== "object" || !("opencode" in metadata)) return null

  const opencode: unknown = metadata.opencode
  if (!opencode || typeof opencode !== "object" || !(key in opencode)) return null

  const timestamp: unknown = Reflect.get(opencode, key)
  return typeof timestamp === "number" ? timestamp : null
}

export function formatProcessDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const twoDigits = (value: number) => String(value).padStart(2, "0")
  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`
}

export function formatMessageTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  if (date.toDateString() === now.toDateString()) {
    return time
  }

  const sameYear = date.getFullYear() === now.getFullYear()
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })

  return `${day}, ${time}`
}

export function isMessageGroup(item: MessageListItem): item is MessageGroup {
  return "messages" in item
}

export function isInternalContinuationMessage(message: UIMessage): boolean {
  return message.role === "user" && message.parts.length === 0
}

function assistantMessageHasRenderableContent(message: UIMessage) {
  if (message.role !== "assistant") return false
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") return part.text.trim().length > 0
    if (part.type === "file") return true
    return isToolUIPart(part)
  })
}

export function getActiveAssistantMessageId(
  messages: UIMessage[],
  activeMessageBaseline?: number | null,
) {
  const latestVisibleUserIndex = messages.findLastIndex(
    (message) => message.role === "user" && !isInternalContinuationMessage(message),
  )
  const turnStart = activeMessageBaseline ?? Math.max(0, latestVisibleUserIndex)
  return messages.slice(turnStart).findLast(
    (message) => message.role === "assistant"
      && assistantMessageHasRenderableContent(message)
      && !message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX),
  )?.id
}

export function isStudioResultMessage(message: UIMessage) {
  return message.id.startsWith("studio-result:")
}

export function groupMessages(messages: UIMessage[]): MessageListItem[] {
  const items: MessageListItem[] = []
  const visibleMessages = messages.flatMap((message, index) =>
    isInternalContinuationMessage(message) ? [] : [{ index, message }]
  )
  let index = 0

  while (index < visibleMessages.length) {
    const item = visibleMessages[index]

    if (item.message.role !== "assistant") {
      items.push(item)
      index++
      continue
    }

    if (isStudioResultMessage(item.message)) {
      items.push({ messages: [item] })
      index++
      continue
    }

    const assistantMessages: UIMessageWithIndex[] = []

    while (index < visibleMessages.length && visibleMessages[index].message.role === "assistant" && !isStudioResultMessage(visibleMessages[index].message)) {
      assistantMessages.push(visibleMessages[index])
      index++
    }

    items.push({ messages: assistantMessages })
  }

  return items
}

type AssistantRenderGroup =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string; isStreaming: boolean }
  | { kind: "file"; part: FileUIPart }
  | { kind: "tool"; part: ToolUIPart | DynamicToolUIPart }

export type AssistantProcessRenderGroup = Extract<AssistantRenderGroup, { kind: "reasoning" | "file" | "tool" }>

export type AssistantProcessState = "streaming" | "failed" | "completed"

export function getAssistantProcessState(isStreaming: boolean, hasError: boolean): AssistantProcessState {
  if (isStreaming) return "streaming"
  return hasError ? "failed" : "completed"
}

export interface AssistantRenderSections {
  processGroups: AssistantProcessRenderGroup[]
  resultGroups: AssistantRenderGroup[]
}

export function getAssistantRenderGroups(
  parts: UIMessage["parts"],
  showThinking: boolean
): AssistantRenderGroup[] {
  const filteredParts = parts.filter((part) => showThinking || !isReasoningUIPart(part))
  const groups: AssistantRenderGroup[] = []

  const appendText = (text: string) => {
    if (!text) {
      return
    }

    const previous = groups.at(-1)
    if (previous?.kind === "text") {
      previous.text += text
      return
    }

    groups.push({ kind: "text", text })
  }

  const appendReasoning = (part: UIMessage["parts"][number]) => {
    if (!isReasoningUIPart(part)) {
      return
    }

    const previous = groups.at(-1)
    if (previous?.kind === "reasoning") {
      previous.text += part.text
      previous.isStreaming = previous.isStreaming || part.state === "streaming"
      return
    }

    if (!part.text.trim()) {
      return
    }

    groups.push({ kind: "reasoning", text: part.text, isStreaming: part.state === "streaming" })
  }

  for (const part of filteredParts) {
    if (part.type === "text") {
      appendText(part.text)
      continue
    }

    if (isReasoningUIPart(part)) {
      if (showThinking) {
        appendReasoning(part)
      }
      continue
    }

    if (part.type === "file") {
      groups.push({ kind: "file", part })
      continue
    }

    if (isToolUIPart(part)) {
      groups.push({ kind: "tool", part })
    }
  }

  return groups
}

export function splitAssistantRenderGroups(groups: AssistantRenderGroup[]): AssistantRenderSections {
  const lastTextIndex = groups.findLastIndex((group) => group.kind === "text" && Boolean(group.text.trim()))
  if (lastTextIndex <= 0) {
    return { processGroups: [], resultGroups: groups }
  }

  const leadingGroups = groups.slice(0, lastTextIndex)
  if (!leadingGroups.every((group): group is AssistantProcessRenderGroup => group.kind !== "text")) {
    return { processGroups: [], resultGroups: groups }
  }

  return {
    processGroups: leadingGroups,
    resultGroups: groups.slice(lastTextIndex),
  }
}
