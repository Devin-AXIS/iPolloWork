import type { UIMessage } from "ai";

type OpenTargetKind = "url" | "file";
export type OpenTargetPreview = "browser" | "markdown" | "sheet" | "slides" | "image" | "pdf" | "html" | "text" | "external";

export interface TextData {
  kind: "text";
  data: string;
}

export interface BinaryData {
  kind: "binary";
  data: ArrayBuffer;
}

export type Data = TextData | BinaryData;

export type OpenTarget = {
  id: string;
  kind: OpenTargetKind;
  value: string;
  name: string;
  preview: OpenTargetPreview;
  confidence: number;
  reason: string;
  exists?: boolean;
  size?: number;
  updatedAt?: number;
};

const WORKSPACES_PREFIX_PATTERN = /^workspaces\/[^/]+\//i;
const WORKSPACE_ID_PREFIX_PATTERN = /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i;

// Covers relative paths plus Windows absolute paths with spaces or CJK directory names.
const FILE_PATTERN = /(?:^|[\s"'`([{：])((?:[a-z]:[/\\][^\r\n"'`<>|]+?\.[a-z][a-z0-9]{0,9}|(?:\.{1,2}[/\\]|~[/\\]|[/\\])?[^\s"'`()\[\]{}<>|:/\\]+(?:[/\\][^\s"'`()\[\]{}<>|:/\\]+)+\.[a-z][a-z0-9]{0,9}|[^\s"'`()\[\]{}<>|:/\\]+\.[a-z][a-z0-9]{0,9}))(?=$|[\s"'`\)\]}>,;:.，。；：、])/gi;
const DIRECTORY_PATTERN = /(?:^|[\s"'`([{：])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?[^\s"'`()\[\]{}<>|:/\\]+(?:[/\\][^\s"'`()\[\]{}<>|:/\\]+)+[/\\])(?=$|[\s"'`\)\]}>,;:.，。；：、])/gi;
const URL_PATTERN = /https?:\/\/[^\s)\]}>"'`]+/gi;
const SOCKET_PATTERN = /(?:ws|wss):\/\/[^\s)\]}>"'`]+/gi;
const SIDEBAR_ARTIFACT_FILE_PREVIEWS = new Set<OpenTargetPreview>(["markdown", "sheet", "slides", "image", "pdf", "html"]);
const STYLESHEET_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const ASSISTANT_ARTIFACT_MENTION_PATTERN = /(?:\b(?:artifact|complete|completed|created|deck|deliverable|exported|file|generated|open|opened|presentation|saved|skill|slides?|updated|wrote)\b|产物|创建|完成|打开|技能|文件|生成|路径|保存|输出|写入|更新)/i;
const DISCOVERY_TOOL_NAMES = new Set(["glob", "grep", "search", "find"]);
const ARTIFACT_METADATA_TOOL_NAMES = new Set(["ipollowork_extension_call"]);
const WRITE_TOOL_NAMES = new Set([
  "apply_patch",
  "edit",
  "edit_file",
  "multi_edit",
  "multiedit",
  "patch",
  "str_replace_editor",
  "write",
  "write_file",
]);
const FILE_METADATA_KEYS = ["path", "file", "filePath", "filepath"];
const FILE_METADATA_COLLECTION_KEYS = ["files"];
const FILE_METADATA_CONTAINER_KEYS = ["artifacts", "changes", "output", "outputs", "result", "results"];
const FILE_METADATA_MAX_DEPTH = 4;
const FILE_METADATA_MAX_VALUES = 100;
const PATCH_FILE_PATTERN = /^\*\*\* (?:Add File|Update File):\s*(.+)$/gmi;
const PATCH_MOVE_TO_PATTERN = /^\*\*\* Move to:\s*(.+)$/gmi;
const URI_PATTERN = /^(?:https?|wss?|file):\/\//i;

type DeriveOpenTargetsOptions = {
  includeFileMentions?: boolean;
  supplementalFiles?: readonly string[];
};

function normalizePath(path: string) {
  return path
    .trim()
    .replace(/[\\]+/g, "/")
    .replace(/^\.\//, "")
    .replace(WORKSPACES_PREFIX_PATTERN, "")
    .replace(WORKSPACE_ID_PREFIX_PATTERN, "");
}

function basename(value: string) {
  const clean = value.split(/[?#]/)[0] ?? value;
  return clean.split("/").filter(Boolean).pop() ?? value;
}

function extname(value: string) {
  const name = basename(value).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function classifyOpenTarget(value: string, kind: OpenTargetKind): OpenTargetPreview {
  if (kind === "url") return "browser";
  const ext = extname(value);
  if ([".md", ".markdown", ".mdx"].includes(ext)) return "markdown";
  if ([".csv", ".tsv", ".xlsx", ".xls", ".ods"].includes(ext)) return "sheet";
  if ([".ppt", ".pptx", ".pptm", ".pot", ".potx", ".odp", ".key", ".sxi"].includes(ext)) return "slides";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".txt", ".log", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".ts", ".tsx", ".js", ".jsx", ".css", ".scss"].includes(ext)) return "text";
  return "external";
}

function shouldScanAssistantFileMentions(text: string) {
  return ASSISTANT_ARTIFACT_MENTION_PATTERN.test(text);
}

export function getAssistantFileMentionPaths(text: string) {
  if (!shouldScanAssistantFileMentions(text)) return [];
  return getContextualFileMentionPaths(text);
}

function getFileMentionPaths(text: string) {
  const paths: string[] = [];
  FILE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FILE_PATTERN)) {
    if (match[1]) paths.push(match[1]);
  }
  return paths;
}

function getDirectoryMentionPaths(text: string) {
  const paths: string[] = [];
  DIRECTORY_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(DIRECTORY_PATTERN)) {
    if (match[1]) paths.push(match[1]);
  }
  return paths;
}

function getContextualFileMentionPaths(text: string) {
  const paths: string[] = [];
  let directory: string | null = null;
  let foundFileInDirectory = false;

  for (const line of text.split(/\r?\n/)) {
    const directories = getDirectoryMentionPaths(line);
    const nextDirectory = directories.at(-1);
    if (nextDirectory) {
      directory = nextDirectory.replace(/[\\]+/g, "/");
      foundFileInDirectory = false;
    }

    const files = getFileMentionPaths(line);
    for (const file of files) {
      if (directory && !file.includes("/") && !file.includes("\\")) {
        paths.push(`${directory}${file}`);
        foundFileInDirectory = true;
      } else {
        paths.push(file);
      }
    }

    if (directory && foundFileInDirectory && line.trim() && directories.length === 0 && files.length === 0) {
      directory = null;
      foundFileInDirectory = false;
    }
  }

  return paths;
}

function textWithoutRedundantMarkdownLinkLabels(text: string) {
  return text.replace(MARKDOWN_LINK_PATTERN, (match, label: string, href: string) => {
    const cleanLabel = label.trim();
    const cleanHref = href.trim();
    return cleanLabel === basename(cleanHref) ? `[](${cleanHref})` : match;
  });
}

function targetFromFile(path: string, confidence: number, reason: string): OpenTarget | null {
  const normalized = normalizePath(path).replace(/[.,;:]+$/, "");
  if (!normalized || normalized.length > 500 || !normalized.includes(".")) return null;
  return {
    id: `file:${normalized.toLowerCase()}`,
    kind: "file",
    value: normalized,
    name: basename(normalized),
    preview: classifyOpenTarget(normalized, "file"),
    confidence,
    reason,
  };
}

function targetFromUrl(url: string, confidence: number, reason: string): OpenTarget | null {
  const stripped = url.trim().replace(/[.,;:`\\]+$/, "");
  let clean = stripped;
  try {
    const parsed = new URL(stripped);
    if (/^\/+$/i.test(parsed.pathname) && !parsed.search && !parsed.hash) {
      clean = parsed.origin;
    }
  } catch {
    // Keep the stripped value; regex extraction already validated the shape.
  }
  if (!clean) return null;
  return {
    id: `url:${clean}`,
    kind: "url",
    value: clean,
    name: basename(clean) || clean,
    preview: "browser",
    confidence,
    reason,
  };
}

function addTarget(map: Map<string, OpenTarget>, target: OpenTarget | null) {
  if (!target) return;
  const existing = map.get(target.id);
  if (!existing || target.confidence >= existing.confidence) map.set(target.id, target);
}

function isArtifactTarget(target: OpenTarget) {
  return target.kind === "url" || target.kind === "file";
}

export function isCollectibleArtifactTarget(target: OpenTarget) {
  return target.kind === "file" && target.exists === true && (
    SIDEBAR_ARTIFACT_FILE_PREVIEWS.has(target.preview) || isStylesheetArtifactTarget(target)
  );
}

export function isStylesheetArtifactTarget(target: OpenTarget) {
  return target.kind === "file" && target.preview === "text" && STYLESHEET_EXTENSIONS.has(extname(target.value));
}

export function isOpenableFileTarget(target: OpenTarget) {
  return target.kind === "file" && target.exists === true;
}

export function isLocalhostBrowserTarget(target: OpenTarget) {
  return target.kind === "url" && /(?:https?|wss?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(target.value);
}

function scanText(
  map: Map<string, OpenTarget>,
  text: string,
  confidence: number,
  reason: string,
  options: { includeFiles: boolean },
) {
  if (!text) {
    return;
  }

  let scanValue = text;

  MARKDOWN_LINK_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    const href = match[2];
    if (!href) continue;
    if (/^(?:https?|wss?):\/\//i.test(href)) {
      addTarget(map, targetFromUrl(href, confidence, reason));
    } else if (options.includeFiles) {
      addTarget(map, targetFromFile(href, confidence, reason));
    }
  }

  if (options.includeFiles) {
    scanValue = textWithoutRedundantMarkdownLinkLabels(text);
  }

  URL_PATTERN.lastIndex = 0;

  for (const match of scanValue.matchAll(URL_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }

  SOCKET_PATTERN.lastIndex = 0;

  for (const match of scanValue.matchAll(SOCKET_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }

  if (!options.includeFiles) return;

  for (const path of getContextualFileMentionPaths(scanValue)) {
    addTarget(map, targetFromFile(path, confidence, reason));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizedToolName(toolName: string) {
  return toolName.trim().toLowerCase().replace(/^functions[._-]/, "");
}

function isDiscoveryTool(toolName: string) {
  return DISCOVERY_TOOL_NAMES.has(normalizedToolName(toolName));
}

function isWriteTool(toolName: string) {
  return WRITE_TOOL_NAMES.has(normalizedToolName(toolName));
}

function isArtifactMetadataTool(toolName: string) {
  return ARTIFACT_METADATA_TOOL_NAMES.has(normalizedToolName(toolName));
}

function collectFileMetadataValues(
  value: unknown,
  depth = 0,
  allowString = false,
  values: string[] = [],
) {
  if (values.length >= FILE_METADATA_MAX_VALUES || depth > FILE_METADATA_MAX_DEPTH) return values;
  if (typeof value === "string") {
    if (allowString) values.push(value);
    return values;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFileMetadataValues(item, depth + 1, allowString, values);
      if (values.length >= FILE_METADATA_MAX_VALUES) break;
    }
    return values;
  }
  if (!isObject(value)) return values;

  for (const key of FILE_METADATA_KEYS) {
    const file = value[key];
    if (typeof file === "string") values.push(file);
  }
  for (const key of FILE_METADATA_COLLECTION_KEYS) {
    collectFileMetadataValues(value[key], depth + 1, true, values);
  }
  for (const key of FILE_METADATA_CONTAINER_KEYS) {
    collectFileMetadataValues(value[key], depth + 1, false, values);
  }
  return values;
}

function collectNestedFileMetadataValues(value: unknown) {
  return collectFileMetadataValues(value);
}

function collectPatchFileValues(value: unknown) {
  if (!isObject(value)) return [];
  const patchText = value.patchText ?? value.patch ?? value.diff;
  if (typeof patchText !== "string") return [];
  const values: string[] = [];
  PATCH_FILE_PATTERN.lastIndex = 0;
  for (const match of patchText.matchAll(PATCH_FILE_PATTERN)) {
    if (match[1]) values.push(match[1]);
  }
  PATCH_MOVE_TO_PATTERN.lastIndex = 0;
  for (const match of patchText.matchAll(PATCH_MOVE_TO_PATTERN)) {
    if (match[1]) values.push(match[1]);
  }
  return values;
}

function addFileValues(map: Map<string, OpenTarget>, values: string[], confidence: number, reason: string) {
  for (const value of values) {
    addTarget(map, targetFromFile(value, confidence, reason));
  }
}

export function getWrittenFilePaths(toolName: string, input: unknown, output: unknown) {
  if (!isWriteTool(toolName)) return [];
  const values = [
    ...collectFileMetadataValues(input),
    ...collectFileMetadataValues(output),
    ...collectPatchFileValues(input),
    ...(typeof output === "string" ? getFileMentionPaths(output) : []),
  ];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function deriveOpenTargets(messages: UIMessage[], options: DeriveOpenTargetsOptions = {}): OpenTarget[] {
  const targets = new Map<string, OpenTarget>();

  addFileValues(targets, [...(options.supplementalFiles ?? [])], 100, "template entry");

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        scanText(targets, part.text, message.role === "assistant" ? 65 : 40, "message", {
          includeFiles: options.includeFileMentions === true || (message.role === "assistant" && shouldScanAssistantFileMentions(part.text)),
        });
        continue;
      }

      if (part.type === "source-document") {
        addTarget(
          targets,
          part.filename
            ? targetFromFile(part.filename, 95, "attachment source")
            : URI_PATTERN.test(part.title)
              ? targetFromUrl(part.title, 95, "attachment source")
              : targetFromFile(part.title, 95, "attachment source"),
        );
        continue;
      }

      if (part.type !== "dynamic-tool") {
        continue;
      }

      const discoveryTool = isDiscoveryTool(part.toolName);
      const writeTool = isWriteTool(part.toolName);
      const artifactMetadataTool = isArtifactMetadataTool(part.toolName);

      if (writeTool) {
        addFileValues(
          targets,
          getWrittenFilePaths(part.toolName, part.input, part.output),
          95,
          "write tool metadata",
        );
      }

      if (artifactMetadataTool) {
        addFileValues(
          targets,
          [part.input, part.output].flatMap(collectNestedFileMetadataValues),
          95,
          "artifact tool metadata",
        );
      }

      if (!discoveryTool) {
        scanText(targets, JSON.stringify(part.output ?? part.input ?? ""), 75, "tool output", { includeFiles: false });
      }
    }
  }

  return Array.from(targets.values())
    .filter(isArtifactTarget)
    .sort((left, right) => right.confidence - left.confidence);
}
