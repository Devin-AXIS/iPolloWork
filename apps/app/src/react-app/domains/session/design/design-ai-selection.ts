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

export function designAiSelectionToken(id: string) {
  return `[[design-ai:${id}]]`;
}

export function parseDesignAiSelectionToken(token: string) {
  return DESIGN_AI_SELECTION_TOKEN.exec(token)?.[1] ?? null;
}

export function designAiSelectionInstruction(context: DesignAiSelectionContext) {
  return [
    "Design selection request:",
    `- Edit only the file: ${context.filePath}`,
    `- Edit only the selected element at CSS locator: ${context.target.locator}`,
    "- Do not modify any other element, page structure, slide, or file unless the user explicitly asks for a wider change.",
    "- If the locator no longer resolves in the file, stop without changing the file and ask the user to select the element again.",
    "- Preserve unrelated content and styles.",
  ].join("\n");
}
