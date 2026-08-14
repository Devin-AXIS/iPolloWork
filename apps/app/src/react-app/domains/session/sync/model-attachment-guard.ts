import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import type { ComposerDraft, ModelRef } from "@/app/types";

export type DraftAttachmentModelValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "image_input_unsupported";
      modelLabel: string;
    };

export function draftHasImageAttachment(draft: ComposerDraft) {
  return draft.attachments.some((attachment) =>
    attachment.kind === "image" || attachment.mimeType.toLowerCase().startsWith("image/"),
  );
}

function selectedModel(
  providerList: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
) {
  if (!providerList || !model?.providerID || !model.modelID) return null;
  const provider = providerList.all.find((item) => item.id === model.providerID);
  return provider?.models?.[model.modelID] ?? null;
}

export function modelSupportsImageInput(
  providerList: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
) {
  const info = selectedModel(providerList, model);
  if (!info) return false;
  if (info.capabilities?.input?.image === true) return true;

  const modalities = (info as { modalities?: { input?: unknown } }).modalities?.input;
  return Array.isArray(modalities) && modalities.includes("image");
}

export function validateDraftAttachmentsForModel(
  draft: ComposerDraft,
  providerList: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
): DraftAttachmentModelValidation {
  if (!draftHasImageAttachment(draft)) return { ok: true };
  if (modelSupportsImageInput(providerList, model)) return { ok: true };

  return {
    ok: false,
    reason: "image_input_unsupported",
    modelLabel: selectedModel(providerList, model)?.name ?? model?.modelID ?? "Selected model",
  };
}
