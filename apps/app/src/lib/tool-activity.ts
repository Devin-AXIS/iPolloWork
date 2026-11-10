import { t } from "@/i18n"
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai"
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
  isTaskToolPart,
  isTodoWriteToolPart,
  isWebFetchToolPart,
  isWebSearchToolPart,
  isWriteToolPart,
} from "@/lib/build-in-tools"
import { parseFilename, truncateText } from "@/components/tools/path"

type AnyToolPart = ToolUIPart | DynamicToolUIPart

export function isToolPartInFlight(part: AnyToolPart): boolean {
  return part.state === "input-streaming" || part.state === "input-available"
}

export function collectToolParts(messages: UIMessage[]): DynamicToolUIPart[] {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part): part is DynamicToolUIPart => part.type === "dynamic-tool"
    )
  )
}

function hostnameOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/**
 * Human-readable "what is this tool doing" label. Safe against partial
 * streamed input (fields may be missing despite the type contract).
 */
export function getToolActivityLabel(part: AnyToolPart): string {
  if (isBashToolPart(part)) {
    const description = part.input?.description?.trim()
    return truncateText(description || part.input?.command?.trim() || t("chat.activity.command"), 96)
  }
  if (isReadToolPart(part)) {
    return t("chat.activity.read", { name: parseFilename(part.input?.filePath) })
  }
  if (isEditToolPart(part)) {
    return t("chat.activity.edit", { name: parseFilename(part.input?.filePath) })
  }
  if (isWriteToolPart(part)) {
    return t("chat.activity.write", { name: parseFilename(part.input?.filePath) })
  }
  if (isApplyPatchToolPart(part)) {
    return t("chat.activity.patch")
  }
  if (isGrepToolPart(part) || isGlobToolPart(part)) {
    const pattern = part.input?.pattern?.trim()
    return pattern
      ? t("chat.activity.search_pattern", { name: truncateText(pattern, 44) })
      : t("chat.activity.search")
  }
  if (isLspToolPart(part)) {
    return t("chat.activity.inspect", { name: parseFilename(part.input?.filePath) })
  }
  if (isSkillToolPart(part)) {
    const name = part.input?.name?.trim()
    return name ? t("chat.activity.skill_name", { name }) : t("chat.activity.skill")
  }
  if (isTodoWriteToolPart(part)) {
    return t("chat.activity.plan")
  }
  if (isWebFetchToolPart(part)) {
    const host = hostnameOf(part.input?.url)
    return host ? t("chat.activity.read", { name: host }) : t("chat.activity.page")
  }
  if (isWebSearchToolPart(part)) {
    const query = part.input?.query?.trim()
    return query
      ? t("chat.activity.web_query", { name: truncateText(query, 44) })
      : t("chat.activity.web")
  }
  if (isQuestionToolPart(part)) {
    return t("chat.activity.question")
  }
  if (isEnvVarRequestToolPart(part)) {
    const key = part.input?.key?.trim()
    return key ? t("chat.activity.environment", { name: key }) : t("chat.activity.environment_generic")
  }
  if (isTaskToolPart(part)) {
    const description = part.input?.description?.replace(/\[project-agent:[^\]]+\]\s*/gu, "").trim()
    return description
      ? t("chat.activity.agent_name", { name: truncateText(description, 56) })
      : t("chat.activity.agent")
  }
  if (part.type === "dynamic-tool") {
    return /image.?generation/i.test(part.toolName) ? t("chat.activity.image") : /video.?generation/i.test(part.toolName) ? t("chat.activity.video") : t("chat.activity.tool")
  }
  return t("chat.activity.tool")
}

/** Label for the most recent tool still in flight, if any. */
export function getActiveToolLabel(parts: DynamicToolUIPart[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part && isToolPartInFlight(part)) {
      return getToolActivityLabel(part)
    }
  }
  return null
}
