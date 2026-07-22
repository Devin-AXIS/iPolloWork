import type { UIMessage } from "ai";
import * as React from "react";

import {
  isApplyPatchToolPart,
  isEditToolPart,
  isWriteToolPart,
} from "@/lib/build-in-tools";
import { useOpenTargets } from "@/lib/target-provider";
import { isCollectibleArtifactTarget, isOpenableFileTarget, type OpenTarget, type OpenTargetPreview } from "@/react-app/domains/session/artifacts/open-target";

export type ArtifactType = "website" | "markdown" | "sheet" | "slides" | "document" | "image" | "video" | "audio" | "pdf" | "html" | "text" | "unknown";

export type ArtifactItem = {
  id: string
  name: string
  path: string
  type: ArtifactType
  messageId: string
  messageIndex: number
  updatedAt?: number
  legacy_target: OpenTarget
}

export type ConversationOutputGroup = {
  id: string
  primary: ArtifactItem
  artifacts: ArtifactItem[]
  bundled: boolean
}

type ArtifactEntry = ArtifactItem & {
  sequence: number
}

type GetArtifactsOptions = {
  includeTargetFallbacks?: boolean
  supplementalFiles?: readonly string[]
}

const WORKSPACES_PREFIX_PATTERN = /^workspaces\/[^/]+\//i;
const WORKSPACE_ID_PREFIX_PATTERN = /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i;

export function isMarkdownPreviewSupported(extension: string) {
  return ["md", "markdown", "mdx"].includes(extension);
}

export function isSheetPreviewSupported(extension: string) {
  return ["csv", "tsv", "xlsx", "xls", "ods"].includes(extension);
}

export function isImagePreviewSupported(extension: string) {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension);
}

export function isPdfPreviewSupported(extension: string) {
  return ["pdf"].includes(extension);
}

export function isHtmlPreviewSupported(extension: string) {
  return ["html", "htm"].includes(extension);
}

export function isTextPreviewSupported(extension: string) {
  return ["txt", "log", "json", "jsonc", "yaml", "yml", "toml", "xml", "ts", "tsx", "js", "jsx", "css", "scss"].includes(extension);
}

export function isPreviewSupported(extension: string) {
  return isMarkdownPreviewSupported(extension) || isSheetPreviewSupported(extension) || isImagePreviewSupported(extension) || isPdfPreviewSupported(extension) || isHtmlPreviewSupported(extension) || isTextPreviewSupported(extension);
}

export function getArtifactType(filename: string): ArtifactType {
  const extension = getFileExtension(filename);

  if (!extension) {
    return "unknown";
  }

  if (["md", "markdown", "mdx", "rmd", "rst"].includes(extension)) {
    return "markdown";
  }

  if (["csv", "tsv", "xlsx", "xls", "xlsm", "xlsb", "ods", "numbers"].includes(extension)) {
    return "sheet";
  }

  if (["ppt", "pptx", "pptm", "pot", "potx", "odp", "key", "sxi"].includes(extension)) {
    return "slides";
  }

  if (["doc", "docx", "odt", "rtf", "pages"].includes(extension)) {
    return "document";
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic", "heif", "tif", "tiff"].includes(extension)) {
    return "image";
  }

  if (["mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "m4v", "ogv", "mpeg", "mpg", "3gp"].includes(extension)) {
    return "video";
  }

  if (["mp3", "wav", "flac", "aac", "ogg", "oga", "m4a", "wma", "opus", "aiff", "aif", "mid", "midi"].includes(extension)) {
    return "audio";
  }

  if (["pdf"].includes(extension)) {
    return "pdf";
  }

  if (["html", "htm", "xhtml"].includes(extension)) {
    return "html";
  }

  if (["txt", "log", "json", "jsonc", "json5", "yaml", "yml", "toml", "xml", "ini", "env", "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "css", "scss", "sass", "less", "py", "rb", "go", "rs", "java", "kt", "swift", "php", "c", "cpp", "h", "cs", "sql", "sh", "bash", "zsh"].includes(extension)) {
    return "text";
  }

  return "unknown";
}

function getFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase();
}

const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  website: "Website",
  markdown: "Markdown",
  sheet: "Spreadsheet",
  slides: "Slides",
  document: "Document",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  html: "HTML",
  text: "Text",
  unknown: "File",
};

export function getArtifactTypeLabel(type: ArtifactType) {
  return ARTIFACT_TYPE_LABELS[type];
}

export function canPreviewArtifact(artifact: ArtifactItem) {
  return isCollectibleArtifactTarget(artifact.legacy_target);
}

export function canOpenArtifact(artifact: ArtifactItem) {
  return canPreviewArtifact(artifact) || isOpenableFileTarget(artifact.legacy_target);
}

function getArtifactName(path: string) {
  const segments = path.split(/[/\\]/);

  return segments[segments.length - 1] ?? path;
}

const INTERNAL_OUTPUT_PATH_PATTERN = /(?:^|\/)(?:\.opencode|\.claude|node_modules|skills|references?|sources?|citations?|plans?|sub[-_]?agents?)(?:\/|$)/i;
const INTERNAL_OUTPUT_NAME_PATTERN = /^(?:SKILL|AGENTS|CLAUDE|brief|template|manifest|plan|todo|source|references?|citations?)\.(?:md|mdx|json)$/i;

/** Only user-facing files belong in the conversation output list. */
export function isConversationOutputArtifact(artifact: ArtifactItem) {
  if (artifact.type === "unknown") return false;
  if (INTERNAL_OUTPUT_PATH_PATTERN.test(artifact.path)) return false;
  if (INTERNAL_OUTPUT_NAME_PATTERN.test(artifact.name)) return false;
  return true;
}

/** HTML compositions under the video workspace open the session's Video Studio. */
export function isVideoHtmlArtifact(artifact: ArtifactItem) {
  return artifact.type === "html" && /(?:^|\/)video(?:\/|$)/i.test(artifact.path);
}

const BUNDLE_PRIMARY_TYPES = new Set<ArtifactType>(["website", "html", "video", "slides", "document", "pdf"]);
const PRIMARY_NAME_PATTERN = /(?:^|[-_.\s])(index|main|final|output|preview|composition|render)(?:[-_.\s]|$)/i;
const BROAD_OUTPUT_CONTAINER_NAMES = new Set(["artifacts", "build", "design", "dist", "exports", "hyperframes", "output", "outputs", "projects", "renders", "video", "videos"]);

function getArtifactBundleDirectory(path: string) {
  const segments = normalizeArtifactPath(path).split("/").filter(Boolean);
  if (segments.length <= 1) return undefined;
  if (segments.length > 2 && BROAD_OUTPUT_CONTAINER_NAMES.has(segments[0]?.toLowerCase() ?? "")) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
}

function artifactPrimaryScore(artifact: ArtifactItem) {
  const typeScore: Record<ArtifactType, number> = {
    video: 100,
    html: 90,
    website: 85,
    slides: 80,
    pdf: 78,
    document: 74,
    markdown: 64,
    sheet: 62,
    image: 50,
    audio: 44,
    text: 10,
    unknown: 0,
  };

  return typeScore[artifact.type] + (PRIMARY_NAME_PATTERN.test(artifact.name) ? 8 : 0);
}

function compareArtifactsForPrimary(left: ArtifactItem, right: ArtifactItem) {
  const scoreDelta = artifactPrimaryScore(right) - artifactPrimaryScore(left);
  if (scoreDelta !== 0) return scoreDelta;

  const updatedAtDelta = (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  if (updatedAtDelta !== 0) return updatedAtDelta;

  const messageDelta = right.messageIndex - left.messageIndex;
  if (messageDelta !== 0) return messageDelta;

  return right.path.localeCompare(left.path);
}

function shouldBundleOutputArtifacts(artifacts: ArtifactItem[]) {
  if (artifacts.length <= 1) return false;
  if (artifacts.some((artifact) => BUNDLE_PRIMARY_TYPES.has(artifact.type))) return true;
  return artifacts.length >= 4;
}

export function groupConversationOutputArtifacts(artifacts: ArtifactItem[]): ConversationOutputGroup[] {
  const standalone: ConversationOutputGroup[] = [];
  const byDirectory = new Map<string, ArtifactItem[]>();

  for (const artifact of artifacts) {
    const directory = getArtifactBundleDirectory(artifact.path);
    if (!directory) {
      standalone.push({ id: artifact.id, primary: artifact, artifacts: [artifact], bundled: false });
      continue;
    }

    const existing = byDirectory.get(directory) ?? [];
    existing.push(artifact);
    byDirectory.set(directory, existing);
  }

  for (const [directory, directoryArtifacts] of byDirectory) {
    if (!shouldBundleOutputArtifacts(directoryArtifacts)) {
      for (const artifact of directoryArtifacts) {
        standalone.push({ id: artifact.id, primary: artifact, artifacts: [artifact], bundled: false });
      }
      continue;
    }

    const primary = [...directoryArtifacts].sort(compareArtifactsForPrimary)[0];
    if (!primary) continue;

    standalone.push({
      id: `bundle:${directory}`,
      primary,
      artifacts: [primary, ...directoryArtifacts.filter((artifact) => artifact.id !== primary.id)],
      bundled: true,
    });
  }

  return standalone.sort((left, right) => {
    const updatedAtDelta = (right.primary.updatedAt ?? 0) - (left.primary.updatedAt ?? 0);
    if (updatedAtDelta !== 0) return updatedAtDelta;

    const messageDelta = right.primary.messageIndex - left.primary.messageIndex;
    if (messageDelta !== 0) return messageDelta;

    return left.primary.path.localeCompare(right.primary.path);
  });
}

function normalizeArtifactPath(path: string) {
  return path
    .trim()
    .replace(/[\\]+/g, "/")
    .replace(/^\.\//, "")
    .replace(WORKSPACES_PREFIX_PATTERN, "")
    .replace(WORKSPACE_ID_PREFIX_PATTERN, "");
}

function artifactTypeToPreview(type: ArtifactType): OpenTargetPreview {
  if (type === "markdown") return "markdown";
  if (type === "sheet") return "sheet";
  if (type === "slides") return "slides";
  if (type === "image") return "image";
  if (type === "pdf") return "pdf";
  if (type === "html") return "html";
  if (type === "text") return "text";
  if (type === "website") return "browser";
  return "external";
}

function artifactPathMatchesTarget(path: string, targetValue: string) {
  const normalized = normalizeArtifactPath(path).toLowerCase();
  const target = normalizeArtifactPath(targetValue).toLowerCase();
  return normalized === target || normalized.endsWith(`/${target}`);
}

function openTargetFromArtifactPath(
  path: string,
  name: string,
  type: ArtifactType,
  verifiedTargets: OpenTarget[],
): OpenTarget {
  const normalized = normalizeArtifactPath(path);
  const id = `file:${normalized.toLowerCase()}`;
  const verified = verifiedTargets.find(
    (target) => target.id === id || artifactPathMatchesTarget(normalized, target.value),
  );

  return verified ?? {
    id,
    kind: "file",
    value: normalized,
    name,
    preview: artifactTypeToPreview(type),
    confidence: 95,
    reason: "artifact",
  };
}

function parseApplyPatchPaths(patchText: string) {
  const paths: string[] = [];

  for (const line of patchText.split("\n")) {
    if (line.startsWith("*** Add File:")) {
      paths.push(line.slice("*** Add File:".length).trim());
      continue;
    }

    if (line.startsWith("*** Update File:")) {
      paths.push(line.slice("*** Update File:".length).trim());
      continue;
    }

    if (line.startsWith("*** Move to:")) {
      paths.push(line.slice("*** Move to:".length).trim());
    }
  }

  return paths;
}

const FILE_PATTERN = /(?:^|[\s"'`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?[\w.\-]+(?:[/\\][\w.\-]+)+\.[a-z][a-z0-9]{0,9}|[\w.\-]+\.[a-z][a-z0-9]{0,9})/gi;
const ASSISTANT_ARTIFACT_MENTION_PATTERN = /\b(?:artifact|created|deck|deliverable|exported|file|generated|opened|presentation|saved|slides?|updated|wrote)\b/i;

function getArtifactPathsFromText(text: string) {
  if (!ASSISTANT_ARTIFACT_MENTION_PATTERN.test(text)) return [];
  const paths: string[] = [];

  FILE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FILE_PATTERN)) {
    if (match[1] && getArtifactType(match[1]) !== "unknown") {
      paths.push(match[1]);
    }
  }

  return paths;
}

function getArtifactPathsFromMessage(message: UIMessage) {
  const paths: (string | undefined)[] = [];

  for (const part of message.parts) {
    if (part.type === "text" && message.role === "assistant") {
      paths.push(...getArtifactPathsFromText(part.text));
      continue;
    }

    if (part.type !== "dynamic-tool" || part.state !== "output-available") {
      continue;
    }

    if (isWriteToolPart(part)) {
      paths.push(part.input.filePath);
      continue;
    }

    if (isEditToolPart(part)) {
      paths.push(part.input.filePath);
      continue;
    }
    if (isApplyPatchToolPart(part)) {
      paths.push(...parseApplyPatchPaths(part.input.patchText));
    }
  }

  return paths.flatMap((path) => {
    const normalized = path?.trim().toLowerCase();
    return normalized ? [normalized] : [];
  });
}

function addArtifact(
  artifacts: Map<string, ArtifactEntry>,
  path: string,
  messageId: string,
  messageIndex: number,
  sequence: number,
  verifiedTargets: OpenTarget[],
  verifiedTarget?: OpenTarget,
) {
  const normalized = normalizeArtifactPath(path);
  const key = normalized.toLowerCase();
  const type = getArtifactType(normalized);
  const legacyTarget = verifiedTarget ?? openTargetFromArtifactPath(normalized, getArtifactName(normalized), type, verifiedTargets);
  const name = legacyTarget.name;

  artifacts.set(key, {
    id: key,
    name,
    path: normalized,
    type,
    messageId,
    messageIndex,
    sequence,
    updatedAt: legacyTarget.updatedAt,
    legacy_target: legacyTarget,
  });
}

export function getArtifactsFromMessages(messages: UIMessage[], openTargets: OpenTarget[] = [], options: GetArtifactsOptions = {}) {
  const artifacts = new Map<string, ArtifactEntry>();
  let sequence = 0;

  messages.forEach((message, messageIndex) => {
    for (const path of getArtifactPathsFromMessage(message)) {
      addArtifact(artifacts, path, message.id, messageIndex, sequence, openTargets);
      sequence += 1;
    }
  });

  const latestAssistantIndex = messages.findLastIndex((message) => message.role === "assistant");
  const latestAssistantMessage = latestAssistantIndex >= 0 ? messages[latestAssistantIndex] : undefined;
  for (const path of options.supplementalFiles ?? []) {
    const normalized = normalizeArtifactPath(path);
    const target = openTargets.find((item) => artifactPathMatchesTarget(normalized, item.value));
    addArtifact(
      artifacts,
      normalized,
      latestAssistantMessage?.id ?? target?.id ?? "open-target",
      latestAssistantIndex >= 0 ? latestAssistantIndex : messages.length,
      sequence,
      openTargets,
      target,
    );
    sequence += 1;
  }

  if (options.includeTargetFallbacks ?? true) {
    const fallbackMessageId = messages[messages.length - 1]?.id ?? "open-target";
    for (const target of openTargets) {
      if (isOpenableFileTarget(target)) {
        addArtifact(artifacts, target.value, fallbackMessageId, messages.length, sequence, openTargets, target);
        sequence += 1;
      }
    }
  }

  return [...artifacts.values()].sort((left, right) => {
    const updatedAtDelta = (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    if (updatedAtDelta !== 0) return updatedAtDelta;

    const messageDelta = right.messageIndex - left.messageIndex;
    if (messageDelta !== 0) return messageDelta;

    return right.sequence - left.sequence;
  });
}

export function useArtifacts(messages: UIMessage[], options: GetArtifactsOptions = {}) {
  const { openTargets } = useOpenTargets();
  const includeTargetFallbacks = options.includeTargetFallbacks ?? false;
  const supplementalFiles = options.supplementalFiles;

  return React.useMemo(
    () => getArtifactsFromMessages(messages, openTargets, { includeTargetFallbacks, supplementalFiles }),
    [includeTargetFallbacks, messages, openTargets, supplementalFiles],
  );
}

export function usePreviewArtifact() {
  const { onOpenTarget } = useOpenTargets();

  return React.useCallback((artifact: ArtifactItem) => {
    async function previewArtifact() {
      onOpenTarget?.(artifact.legacy_target);
    }

    void previewArtifact();
  }, [onOpenTarget]);
}
