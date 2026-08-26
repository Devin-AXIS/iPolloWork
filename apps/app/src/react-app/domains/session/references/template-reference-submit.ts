import type { ComposerAttachment } from "@/app/types";
import { canSendOriginalReference, prepareOriginalReferenceAttachment } from "./ingestion";
import { packReferenceContext } from "./prompt-pack";
import type { PromptPackOptions, ReferenceIngestionResult, TemplateReferenceItem } from "./types";

export function revokeTemplateReferenceAttachmentPreviews(attachments: ComposerAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}

export async function buildTemplateReferenceSubmitPayload(
  references: TemplateReferenceItem[],
  options?: PromptPackOptions,
) {
  const ingestions = references
    .map((reference) => reference.ingestion)
    .filter((item): item is ReferenceIngestionResult => Boolean(item));
  const contextPack = packReferenceContext(ingestions, options);
  const attachments: ComposerAttachment[] = [];
  try {
    for (const reference of references) {
      if (reference.sendOriginal && canSendOriginalReference(reference.file)) {
        attachments.push(await prepareOriginalReferenceAttachment(reference.file));
      }
    }
  } catch (error) {
    revokeTemplateReferenceAttachmentPreviews(attachments);
    throw error;
  }

  return { contextPack, attachments };
}
