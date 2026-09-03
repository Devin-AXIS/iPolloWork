import { t } from "../../i18n";

/** Raw English string — used for prefix matching against stored titles. */
export const DEFAULT_SESSION_TITLE = "New session";
export const LEGACY_DEFAULT_SESSION_TITLE = "New conversation";

const GENERATED_SESSION_TITLE_PREFIX = `${DEFAULT_SESSION_TITLE} - `;
const FIRST_PROMPT_TITLE_MAX_LENGTH = 48;
const ARTIFACT_FILENAME_STEM_MAX_LENGTH = 56;

export type HtmlArtifactDisplayKind = "design" | "slides" | "video" | "website";

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
  const request = (title?.trim() ?? "")
    .replace(/^(?:(?:然后|接着|另外|再|还要|并且)\s*)+/i, "")
    .replace(/^(?:请|麻烦)?\s*(?:帮我|给我|我要|我需要|我想要)?\s*/i, "")
    .replace(/^(?:生成|制作|创建|设计|开发|搭建|编写|起草|输出|写|做)\s*(?:一个|一份|一套|个|份|套)?\s*/i, "")
    .replace(/^(?:please\s+)?(?:create|make|build|design|generate|write)\s+(?:an?\s+)?/i, "")
    .replace(/\.html?$/i, "")
    .trim();
  const subject = request
    .replace(/(?:的)?\s*(?:(?:pptx?|html?|网页演示|网页|网站|演示文稿|幻灯片|视频)(?:\s*(?:和|及|与|以及|、|,|and)\s*)?)+\s*$/i, "")
    .trim() || request;
  const stem = subject
    .replace(/[<>:"/\\|?*：，。！？；、\u0000-\u001f]/g, " ")
    .replace(/[\s_-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, ARTIFACT_FILENAME_STEM_MAX_LENGTH)
    .replace(/[.-]+$/g, "");
  return stem ? `${stem}.html` : null;
}

function htmlFilenameStem(filename: string) {
  return filename.replace(/\.html?$/i, "");
}

/** A model-facing filename that remains related to the request and distinct per user turn. */
export function uniqueHtmlArtifactFilenameFromTitle(
  title: string | null | undefined,
  requestId: string,
) {
  const filename = htmlArtifactFilenameFromTitle(title);
  if (!filename) return null;
  const suffix = requestId.trim().replace(/[^a-z0-9]+/gi, "").slice(-10).toLowerCase();
  return suffix ? `${htmlFilenameStem(filename)}-${suffix}.html` : filename;
}

/** A friendly card name for stable technical entries such as entry.html and index.html. */
export function htmlArtifactDisplayFilename(
  title: string | null | undefined,
  kind: HtmlArtifactDisplayKind,
  occurrence = 1,
) {
  const filename = htmlArtifactFilenameFromTitle(title);
  if (!filename) return null;
  const stem = htmlFilenameStem(filename);
  const chinese = /[\u3400-\u9fff]/u.test(title ?? "");
  const labels: Record<HtmlArtifactDisplayKind, string> = chinese
    ? { design: "设计", slides: "PPT", video: "视频", website: "网页" }
    : { design: "design", slides: "slides", video: "video", website: "website" };
  const label = labels[kind];
  const labelledStem = stem.toLocaleLowerCase() === label.toLocaleLowerCase()
    || stem.toLocaleLowerCase().endsWith(`-${label.toLocaleLowerCase()}`)
    ? stem
    : `${stem}-${label}`;
  return `${labelledStem}${occurrence > 1 ? `-${occurrence}` : ""}.html`;
}

export function getDisplaySessionTitle(
  title: string | null | undefined,
  fallback?: string,
) {
  const trimmed = title?.trim() ?? "";
  if (isDefaultSessionTitle(trimmed)) return fallback ?? t("session.default_title");
  return trimmed;
}
