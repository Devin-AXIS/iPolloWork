import type { ComposerAttachment, ComposerDraft } from "@/app/types";
import type { ConversationPromptPart } from "@/react-app/domains/session/engine/conversation-engine";
import {
  designAiSelectionInstruction,
  type DesignAiSelectionContext,
} from "@ipollowork/design-studio";
import { useDesignAiSelectionStore } from "@/react-app/domains/session/design/design-ai-selection-store";
import { firstLineLocalFileParts } from "@/react-app/domains/session/sync/prompt-file-parts";
import { attachmentRequiresNativeModelSupport } from "@/react-app/domains/session/sync/attachment-support";
import { appMentionInstruction } from "@/react-app/domains/session/surface/composer/app-mentions";

type DesignSelectionScope = {
  sessionId: string;
  workspaceId: string;
};

type DesignSelectionWorkspaceClient = {
  readWorkspaceFile: (workspaceId: string, path: string) => Promise<{ content: string; updatedAt?: number | null }>;
  writeWorkspaceFile: (workspaceId: string, payload: { path: string; content: string; baseUpdatedAt?: number | null }) => Promise<{ updatedAt?: number | null }>;
};

type DesignSelectionStore = Pick<typeof useDesignAiSelectionStore, "getState">;

type DraftToPartsOptions = {
  supportsNativeAttachments?: boolean;
};

export function serializeSDKError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      const message = (error as Record<string, unknown>).message;
      return typeof message === "string" ? message : String(error);
    }
  }
  return String(error);
}

async function fileToDataUrl(file: File, mimeType: string) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read attachment: ${file.name}`));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(new Blob([file], { type: mimeType }));
  });
}

function attachmentMime(attachment: ComposerAttachment) {
  if (attachment.kind === "image") return attachment.mimeType;
  if (attachment.mimeType === "application/pdf") return attachment.mimeType;
  // Everything else is sent as text; unsupported binary mimes poison
  // server-side session history (see sync/attachment-support.ts).
  return "text/plain";
}

export function designSelectionContextsForDraft(
  draft: ComposerDraft,
  designSelectionStore: DesignSelectionStore,
  scope: DesignSelectionScope | undefined,
) {
  const contexts = new Map<string, DesignAiSelectionContext>();
  const errors: string[] = [];
  for (const part of draft.parts) {
    if (part.type !== "design-selection") continue;
    const context = designSelectionStore.getState().contexts[part.contextId];
    if (!context) {
      errors.push("The selected Design element is no longer available.");
      continue;
    }
    if (!scope || context.sessionId !== scope.sessionId) {
      errors.push("The selected Design element does not belong to this session.");
      continue;
    }
    if (context.workspaceId !== scope.workspaceId) {
      errors.push("The selected Design element does not belong to this workspace.");
      continue;
    }
    contexts.set(context.id, context);
  }
  if (errors.length > 0) throw new Error(errors[0]);
  if (contexts.size > 1) throw new Error("Only one Design element can be edited at a time.");
  return [...contexts.values()];
}

export async function promptDesignSelectionContexts<T>(input: {
  contexts: DesignAiSelectionContext[];
  workspaceClient: DesignSelectionWorkspaceClient;
  prompt: () => Promise<T>;
  designSelectionStore?: DesignSelectionStore;
}) {
  const designSelectionStore = input.designSelectionStore ?? useDesignAiSelectionStore;
  try {
    for (const context of input.contexts) {
      const current = await input.workspaceClient.readWorkspaceFile(context.workspaceId, context.filePath);
      const prepared = await input.workspaceClient.writeWorkspaceFile(context.workspaceId, {
        path: context.filePath,
        content: current.content,
        baseUpdatedAt: current.updatedAt ?? null,
      });
      const rebased = designSelectionStore.getState().rebasePendingContext(context.id, {
        beforeHtml: current.content,
        baseUpdatedAt: prepared.updatedAt ?? current.updatedAt ?? null,
      });
      if (!rebased) throw new Error("The selected Design element is no longer ready for an AI update.");
      designSelectionStore.getState().markRunning(context.id);
    }
    const result = await input.prompt();
    if (result && typeof result === "object" && "error" in result && result.error) {
      throw new Error(serializeSDKError(result.error));
    }
    return result;
  } catch (error) {
    for (const context of input.contexts) designSelectionStore.getState().fail(context.id);
    throw error;
  }
}

export async function draftToParts(
  draft: ComposerDraft,
  workspaceRoot: string,
  designSelectionStore: DesignSelectionStore = useDesignAiSelectionStore,
  scope?: DesignSelectionScope,
  options: DraftToPartsOptions = {},
) {
  const parts: ConversationPromptPart[] = [];
  const root = workspaceRoot.trim();

  const toAbsolutePath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("/")) return trimmed;
    if (/^[a-zA-Z]:\\/.test(trimmed)) return trimmed;
    if (!root) return "";
    return `${root}/${trimmed}`.replace(/\/\/+/g, "/");
  };

  const filenameFromPath = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "file";
  };

  const designContexts = new Map(
    designSelectionContextsForDraft(draft, designSelectionStore, scope).map((context) => [context.id, context]),
  );
  const expandedDesignContextIds = new Set<string>();
  for (const part of draft.parts) {
    if (part.type === "design-selection") {
      if (expandedDesignContextIds.has(part.contextId)) continue;
      const context = designContexts.get(part.contextId);
      if (!context) throw new Error("The selected Design element is no longer available.");
      expandedDesignContextIds.add(part.contextId);
      parts.push({
        type: "text",
        text: designAiSelectionInstruction(context),
        synthetic: true,
      });
      continue;
    }
    if (part.type === "text") {
      parts.push({
        type: "text",
        text: part.text,
        ...(part.synthetic ? { synthetic: true } : {}),
      });
      continue;
    }
    if (part.type === "paste") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "agent") {
      parts.push({ type: "agent", name: part.name });
      continue;
    }
    if (part.type === "skill") {
      parts.push({ type: "text", text: `Load [skill ${part.name}] and follow its instructions.` });
      continue;
    }
    if (part.type === "app") {
      parts.push({ type: "text", text: appMentionInstruction(part.name) });
      continue;
    }
    if (part.type === "file") {
      const absolute = toAbsolutePath(part.path);
      if (!absolute) continue;
      parts.push({
        type: "file",
        mime: "text/plain",
        url: `file://${absolute}`,
        filename: filenameFromPath(part.path),
      });
    }
  }

  parts.push(...firstLineLocalFileParts(draft.resolvedText ?? draft.text, root));
  parts.push(
    ...(await Promise.all(
      draft.attachments.map(async (attachment) => {
        if (options.supportsNativeAttachments === false) {
          if (attachmentRequiresNativeModelSupport(attachment.mimeType)) {
            throw new Error("The selected model cannot read image or PDF attachments.");
          }
          return {
            type: "text" as const,
            text: `Attached file: ${attachment.name}\n\n${await attachment.file.text()}`,
            synthetic: true,
          };
        }
        const mime = attachmentMime(attachment);
        return {
          type: "file" as const,
          url: await fileToDataUrl(attachment.file, mime),
          filename: attachment.name,
          mime,
        };
      }),
    )),
  );

  return parts;
}
