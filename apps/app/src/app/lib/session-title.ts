import { t } from "../../i18n";

/** Raw English string — used for prefix matching against stored titles. */
export const DEFAULT_SESSION_TITLE = "New session";
export const LEGACY_DEFAULT_SESSION_TITLE = "New conversation";

const GENERATED_SESSION_TITLE_PREFIX = `${DEFAULT_SESSION_TITLE} - `;
const FIRST_PROMPT_TITLE_MAX_LENGTH = 48;

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

export function getDisplaySessionTitle(
  title: string | null | undefined,
  fallback?: string,
) {
  const trimmed = title?.trim() ?? "";
  if (isDefaultSessionTitle(trimmed)) return fallback ?? t("session.default_title");
  return trimmed;
}
