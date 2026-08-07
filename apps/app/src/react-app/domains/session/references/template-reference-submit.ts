import { prepareOriginalReferenceAttachment } from "./ingestion";
import { packReferenceContext } from "./prompt-pack";
import type { ReferenceIngestionResult, TemplateReferenceItem } from "./types";

export async function buildTemplateReferenceSubmitPayload(references: TemplateReferenceItem[]) {
  const ingestions = references
    .map((reference) => reference.ingestion)
    .filter((item): item is ReferenceIngestionResult => Boolean(item));
  const contextPack = packReferenceContext(ingestions);
  const attachments = await Promise.all(
    references
      .filter((reference) => reference.sendOriginal)
      .map((reference) => prepareOriginalReferenceAttachment(reference.file)),
  );

  return { contextPack, attachments };
}
