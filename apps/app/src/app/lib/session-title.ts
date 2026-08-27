import { t } from "../../i18n";

/** Raw English string — used for prefix matching against stored titles. */
export const DEFAULT_SESSION_TITLE = "New session";
export const LEGACY_DEFAULT_SESSION_TITLE = "New conversation";

const GENERATED_SESSION_TITLE_PREFIX = `${DEFAULT_SESSION_TITLE} - `;
const FIRST_PROMPT_TITLE_MAX_LENGTH = 48;
const ARTIFACT_FILENAME_STEM_MAX_LENGTH = 56;

export function isGeneratedSessionTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  if (!trimmed.startsWith(GENERATED_SESSION_TITLE_PREFIX)) return false;
  const suffix = trimmed.slice(GENERATED_SESSION_TITLE_PREFIX.length).trim();
  return Boolean(suffix) && Number.isFinite(Date.parse(suffix));
}

export function isDefaultSessionTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  return (
    !trimmed ||
    trimmed === DEFAULT_SESSION_TITLE ||
    trimmed === LEGACY_DEFAULT_SESSION_TITLE ||
    trimmed === t("session.default_title") ||
    trimmed === "新建会话" ||
    trimmed === "新会话" ||
    isGeneratedSessionTitle(trimmed)
  );
}

export function sessionTitleFromFirstPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= FIRST_PROMPT_TITLE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, FIRST_PROMPT_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

export function htmlArtifactFilenameFromTitle(title: string | null | undefined) {
  if (isDefaultSessionTitle(title)) return null;
  const stem = (title?.trim() ?? "")
    .replace(/^(?:请|麻烦)?\s*(?:帮我|给我|我要|我需要|我想要)?\s*/i, "")
    .replace(/^(?:生成|制作|创建|设计|开发|搭建|编写|起草|输出|写|做)\s*(?:一个|一份|一套)?\s*/i, "")
    .replace(/^(?:please\s+)?(?:create|make|build|design|generate|write)\s+(?:an?\s+)?/i, "")
    .replace(/(?:的)?\s*(?:pptx?|html|网页演示|演示文稿|幻灯片)\s*$/i, "")
    .replace(/\.html?$/i, "")
    .replace(/[<>:"/\\|?*：，。！？；、\u0000-\u001f]/g, " ")
    .replace(/[\s_-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, ARTIFACT_FILENAME_STEM_MAX_LENGTH)
    .replace(/[.-]+$/g, "");
  return stem ? `${stem}.html` : null;
}

export function getDisplaySessionTitle(
  title: string | null | undefined,
  fallback?: string,
) {
  const trimmed = title?.trim() ?? "";
  if (isDefaultSessionTitle(trimmed)) return fallback ?? t("session.default_title");
  return trimmed;
}
