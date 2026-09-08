import { imageSelectionSnapshotSchema } from "@ipollowork/types/plugins";
import type { ComposerDraft } from "@/app/types";
import type { WorkspaceImageSelection } from "@/react-app/plugin-ui/workspace-app-frame";

/** Shared by immediate send and queue: capture before either clears the composer. */
export async function withImageSelection(draft: ComposerDraft, selection: WorkspaceImageSelection, supportsImages: boolean): Promise<ComposerDraft> {
  const frozen = imageSelectionSnapshotSchema.parse(await selection.capture());
  const { selectionId, sourcePath, model, size, quality, selectionBlend, guidance, previewDataUrl } = frozen;
  const instruction = [
    "The user attached an immutable Image Studio selection. The attached preview marks the selected area in purple; that overlay is not part of the source image.",
    'To edit it, call extension action "openai-image-generation/image_edit" directly with the following arguments and a prompt describing the requested change:',
    JSON.stringify({ selectionId, sourcePath, model, size, quality, selectionBlend }),
    guidance,
    "The server supplies the frozen original and exact mask and preserves unselected pixels. Do not reconstruct a rectangle, call generate_or_edit on the live workbench, or regenerate the whole image. Do not include the purple overlay in the output.",
    "Return the resulting new image artifact, with an image preview and workspace-relative file link. Never overwrite the original.",
  ].filter(Boolean).join("\n");
  const attachments = [...draft.attachments];
  if (supportsImages) {
    const bytes = Uint8Array.from(atob(previewDataUrl.slice(previewDataUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0));
    const file = new File([bytes], "image-selection.png", { type: "image/png" });
    attachments.push({ id: selectionId, name: file.name, mimeType: file.type, size: file.size, kind: "image", file });
  }
  return {
    ...draft,
    attachments,
    capability: {
      id: draft.capability ? `${draft.capability.id}+image-selection` : "image-selection",
      instruction: [draft.capability?.instruction, instruction].filter(Boolean).join("\n\n"),
    },
  };
}
