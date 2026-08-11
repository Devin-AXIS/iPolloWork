"use client"

import { Tool } from "@/components/ui/tool"
import { t } from "@/i18n"
import type { SkillToolPart } from "@/lib/build-in-tools"

interface SkillToolProps {
  part: SkillToolPart
}

function getSkillToolTitle(part: SkillToolPart): string | null {
  const name = part.input?.name?.trim() ?? ""

  if (part.state === "output-error") {
    return name
      ? t("tool_status.load_skill_named_attempted", { name })
      : t("tool_status.load_skill_attempted")
  }

  if (part.state !== "output-available") {
    return null
  }

  return name
    ? t("tool_status.load_skill_named", { name })
    : t("tool_status.load_skill")
}

export function SkillTool({ part }: SkillToolProps) {
  return <Tool toolPart={part} title={getSkillToolTitle(part) ?? undefined} />
}
