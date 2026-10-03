export const VIDEO_STUDIO_HOST_CHANNEL = "ipollowork-video-studio-host-v1";

export type VideoAiSelectionTarget = {
  file: string;
  locator: string;
};

export type VideoStudioSelection = VideoAiSelectionTarget & {
  tag: string;
  text: string;
  src: string;
  alt: string;
  styles: Record<string, string>;
};

export type VideoStudioHostMessage =
  | {
    channel: typeof VIDEO_STUDIO_HOST_CHANNEL;
    type: "ask-video-ai";
  }
  | {
    channel: typeof VIDEO_STUDIO_HOST_CHANNEL;
    type: "ask-ai-selection";
    selection: VideoStudioSelection;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizedStyles(value: unknown) {
  if (!isRecord(value)) return {};
  const styles: Record<string, string> = {};
  for (const [name, style] of Object.entries(value).slice(0, 80)) {
    if (name.length <= 100 && typeof style === "string" && style.trim()) {
      styles[name] = style.trim().slice(0, 240);
    }
  }
  return styles;
}

function attributeSelector(name: string, value: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[${name}="${escaped}"]`;
}

function normalizeProjectFile(value: unknown) {
  const candidate = optionalString(value) || "index.html";
  const normalized = candidate.replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)
    || normalized.includes("\0")
    || normalized.includes("?")
    || normalized.includes("#")
  ) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return null;
  const file = segments.filter((segment) => segment && segment !== ".").join("/");
  return file || null;
}

export function resolveVideoAiSelectionTarget(value: unknown): VideoAiSelectionTarget | null {
  if (!isRecord(value)) return null;
  const file = normalizeProjectFile(value.file);
  if (!file) return null;
  const hfId = optionalString(value.hfId);
  const id = optionalString(value.id);
  const selector = optionalString(value.selector);
  const locator = hfId
    ? attributeSelector("data-hf-id", hfId)
    : id
      ? attributeSelector("id", id)
      : selector;
  return locator ? { file, locator } : null;
}

export function parseHyperframesAskAiMessage(value: unknown): VideoStudioSelection | null {
  if (!isRecord(value) || value.type !== "ipollowork:hyperframes:ask-ai-selection") return null;
  const target = resolveVideoAiSelectionTarget(value.target);
  if (!target) return null;
  return {
    ...target,
    tag: optionalString(value.tag).toLowerCase() || "element",
    text: optionalString(value.text).slice(0, 2_000),
    src: optionalString(value.src).slice(0, 1_000),
    alt: optionalString(value.alt).slice(0, 1_000),
    styles: normalizedStyles(value.styles),
  };
}

export function isVideoStudioHostMessage(value: unknown): value is VideoStudioHostMessage {
  if (!isRecord(value) || value.channel !== VIDEO_STUDIO_HOST_CHANNEL) return false;
  if (value.type === "ask-video-ai") return true;
  return value.type === "ask-ai-selection" && parseVideoStudioSelection(value.selection) !== null;
}

function parseVideoStudioSelection(value: unknown): VideoStudioSelection | null {
  if (!isRecord(value)) return null;
  const file = normalizeProjectFile(value.file);
  const locator = optionalString(value.locator);
  const styles = isRecord(value.styles) ? value.styles : null;
  if (!file || !locator || !styles) return null;
  if (!Object.values(styles).every((entry) => typeof entry === "string")) return null;
  return {
    file,
    locator,
    tag: optionalString(value.tag).toLowerCase() || "element",
    text: optionalString(value.text).slice(0, 2_000),
    src: optionalString(value.src).slice(0, 1_000),
    alt: optionalString(value.alt).slice(0, 1_000),
    styles: Object.fromEntries(Object.entries(styles).map(([name, style]) => [name, String(style).slice(0, 240)])),
  };
}

export function videoStudioDocumentPrompt(projectDirectory: string) {
  return [
    "Help me improve the current iPolloWork HyperFrames video.",
    `Project: ${projectDirectory}`,
    `Read ${projectDirectory}/index.html, design-tokens.css, manifest.json, and brief.json when present before editing.`,
    "Preserve the composition id, scene timing, editable hierarchy, and unrelated user edits.",
    "After editing, call ipollowork_video_validate for this workspace and session, fix every reported error, then stop.",
    "My requested change:",
  ].join("\n");
}

export function videoStudioSelectionPrompt(projectDirectory: string, selection: VideoStudioSelection) {
  const details = [
    selection.text ? `Text: ${selection.text.slice(0, 240)}` : "",
    selection.alt ? `Alt: ${selection.alt.slice(0, 240)}` : "",
    selection.src ? `Source: ${selection.src.slice(0, 240)}` : "",
    Object.keys(selection.styles).length ? `Computed styles: ${JSON.stringify(selection.styles)}` : "",
  ].filter(Boolean);
  return [
    "Help me edit the selected element in iPolloWork iVideo.",
    `File: ${projectDirectory}/${selection.file}`,
    `Element: <${selection.tag}>`,
    `CSS locator: ${selection.locator}`,
    ...details,
    "Read the current file before editing. Change only this element unless I explicitly request a wider redesign.",
    "Preserve the composition timing, data-hf-id values, unrelated elements, and linked design tokens.",
    "After editing, call ipollowork_video_validate for this workspace and session.",
    "My requested change:",
  ].join("\n");
}
