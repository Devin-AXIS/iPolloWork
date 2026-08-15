import type { DesignAiSelectionContext } from "./ai-selection";

export const DESIGN_STUDIO_HOST_CHANNEL = "ipollowork-design-studio-host-v1";

export type DesignStudioAskAiRequest = Omit<DesignAiSelectionContext, "beforeHtml">;

export type DesignStudioHostMessage = {
  channel: typeof DESIGN_STUDIO_HOST_CHANNEL;
  type: "ask-ai";
  request: DesignStudioAskAiRequest;
};

export function designStudioAskAiRequest(
  context: DesignAiSelectionContext,
): DesignStudioAskAiRequest {
  const { beforeHtml: _beforeHtml, ...request } = context;
  return request;
}

export function isDesignStudioHostMessage(value: unknown): value is DesignStudioHostMessage {
  if (!value || typeof value !== "object") return false;
  if (Reflect.get(value, "channel") !== DESIGN_STUDIO_HOST_CHANNEL) return false;
  if (Reflect.get(value, "type") !== "ask-ai") return false;
  const request = Reflect.get(value, "request");
  if (!request || typeof request !== "object") return false;
  const target = Reflect.get(request, "target");
  return typeof Reflect.get(request, "id") === "string"
    && typeof Reflect.get(request, "sessionId") === "string"
    && typeof Reflect.get(request, "workspaceId") === "string"
    && typeof Reflect.get(request, "filePath") === "string"
    && Boolean(target)
    && typeof target === "object"
    && typeof Reflect.get(target, "locator") === "string"
    && typeof Reflect.get(target, "label") === "string";
}

export function designStudioAskAiPrompt(request: DesignStudioAskAiRequest): string {
  const target = request.target;
  const summary = [
    target.text ? `Text: ${target.text.slice(0, 240)}` : "",
    target.alt ? `Alt: ${target.alt.slice(0, 240)}` : "",
    target.src ? `Source: ${target.src.slice(0, 240)}` : "",
  ].filter(Boolean);
  return [
    "Help me edit the selected element in iPolloWork Design Studio.",
    `File: ${request.filePath}`,
    `Element: ${target.label}`,
    `CSS locator: ${target.locator}`,
    ...summary,
    "Read the current file before editing. Change only this element unless I explicitly request a wider redesign, preserve unrelated structure and styles, and keep the linked design-tokens.css theme contract.",
    "My requested change:",
  ].join("\n");
}
