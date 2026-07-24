export type DesignAiSelectionContext = {
  id: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  baseUpdatedAt: number | null;
  beforeHtml: string;
  target: {
    tag: string;
    label: string;
    locator: string;
    text: string;
    src: string;
    alt: string;
    styles: Record<string, string>;
  };
};

export type DesignAiUndoCheckpoint = {
  contextId: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  baseUpdatedAt: number | null;
  beforeHtml: string;
  afterHtml: string;
  afterUpdatedAt: number | null;
};

const DESIGN_AI_SELECTION_TOKEN = /^\[\[design-ai:([a-zA-Z0-9_-]+)\]\]$/;
const DESIGN_AI_SELECTION_DISPLAY_PREFIX = "Design selection display:";

export function designAiSelectionToken(id: string) {
  return `[[design-ai:${id}]]`;
}

export function parseDesignAiSelectionToken(token: string) {
  return DESIGN_AI_SELECTION_TOKEN.exec(token)?.[1] ?? null;
}

export function designAiSelectionDisplayMetadata(contextId: string, label: string) {
  return `${DESIGN_AI_SELECTION_DISPLAY_PREFIX}${JSON.stringify({ contextId, label })}`;
}

export function parseDesignAiSelectionDisplayMetadata(text: string) {
  const line = text.split(/\r?\n/, 1)[0]?.trim();
  if (!line?.startsWith(DESIGN_AI_SELECTION_DISPLAY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(line.slice(DESIGN_AI_SELECTION_DISPLAY_PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const contextId = "contextId" in parsed ? (parsed as { contextId?: unknown }).contextId : null;
    const label = "label" in parsed ? (parsed as { label?: unknown }).label : null;
    if (typeof contextId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(contextId)) return null;
    if (typeof label !== "string" || !label.trim()) return null;
    return { contextId, label: label.trim() };
  } catch {
    return null;
  }
}

export function designAiSelectionInstruction(context: DesignAiSelectionContext) {
  return [
    designAiSelectionDisplayMetadata(context.id, context.target.label),
    "Design selection request:",
    `- Edit only the file: ${context.filePath}`,
    `- Edit only the selected element at CSS locator: ${context.target.locator}`,
    "- Do not modify any other element, page structure, slide, or file unless the user explicitly asks for a wider change.",
    "- Preserve unrelated content and styles.",
  ].join("\n");
}
