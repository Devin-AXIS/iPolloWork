import type { ComposerDraft, ComposerPart } from "@/app/types";

import { decodeComposerMentionValue, type ComposerMentionKind } from "./mention-encoding";

type ParseComposerPartsInput = {
  mentions: Record<string, ComposerMentionKind>;
  pasteParts: Array<{ id: string; label: string; text: string; lines: number }>;
  designSelectionLabel: (contextId: string) => string | undefined;
};

export function parseComposerParts(text: string, input: ParseComposerPartsInput): ComposerPart[] {
  const parts: ComposerPart[] = [];
  const segments = text.split(/(\[\[design-ai:[a-zA-Z0-9_-]+\]\]|\[pasted text [^\]]+\]|\[skill [^\]]+\]|@[^\s@]+)/);
  for (const segment of segments) {
    if (!segment) continue;
    const designSelectionMatch = segment.match(/^\[\[design-ai:([a-zA-Z0-9_-]+)\]\]$/);
    if (designSelectionMatch?.[1]) {
      const contextId = designSelectionMatch[1];
      parts.push({
        type: "design-selection",
        contextId,
        label: input.designSelectionLabel(contextId) ?? "Design selection",
      });
      continue;
    }
    const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
    if (pasteMatch) {
      const target = input.pasteParts.find((item) => item.label === pasteMatch[1]);
      if (target) {
        parts.push({ type: "paste", id: target.id, label: target.label, text: target.text, lines: target.lines });
        continue;
      }
    }
    const skillMatch = segment.match(/^\[skill (.+)\]$/);
    if (skillMatch?.[1]) {
      parts.push({ type: "skill", name: skillMatch[1] });
      continue;
    }
    if (segment.startsWith("@")) {
      const value = decodeComposerMentionValue(segment.slice(1));
      const kind = input.mentions[value];
      if (kind === "agent") {
        parts.push({ type: "agent", name: value });
        continue;
      }
      if (kind === "file") {
        parts.push({ type: "file", path: value, label: value });
        continue;
      }
      if (kind === "app") {
        parts.push({ type: "app", name: value });
        continue;
      }
    }
    parts.push({ type: "text", text: segment });
  }
  return parts;
}

export function shouldPreserveComposerDraftAfterSendFailure(draft: ComposerDraft) {
  return draft.parts.some((part) => part.type === "design-selection");
}

export function failedDraftRetrySurface(draft: ComposerDraft) {
  return shouldPreserveComposerDraftAfterSendFailure(draft) ? "composer" : "queue";
}

export function replaceDesignSelectionToken(draft: string, token: string) {
  const withoutPrevious = draft.replace(/\[\[design-ai:[a-zA-Z0-9_-]+\]\]\s*/g, "").trimEnd();
  return `${withoutPrevious}${withoutPrevious ? "\n" : ""}${token} `;
}
