---
name: image-editing
description: Edit an image from the active iPolloWork Image Studio selection or mask without overwriting the source image.
---

# Image editing

Use this Skill when an existing workspace image is open in Image Studio or the conversation includes an attached Image Studio selection.

1. Use the model explicitly selected by the user in the Image Studio reference. If the reference has no model, call `openai-image-generation/status`, show the configured and available choices, and wait for the user to choose. Never infer a model, use `defaultModel` as consent, or choose the first result.
2. When the conversation includes a captured `selectionId`, call `openai-image-generation/image_edit` using that ID, its `sourcePath`, the exact selected model ID and the user's edit prompt. The snapshot includes the original image and full mask; it remains authoritative if the workbench changes or closes. Do not replace it with the current UI selection or a bounding rectangle. Without a snapshot, use the active workbench source and selection.
3. Change only the requested region when a mask is present. Preserve unselected composition, identity, typography, and brand details.
4. Ask for a clearer selection only when the requested target cannot be inferred from the mask and prompt.
5. Save every generated edit as a new workspace image. Never overwrite or delete the source image.
6. In the final response, embed the edited image using a Markdown image link and report its exact workspace-relative path. This gives the conversation both an image preview and a reusable file card for Design, Video, websites, and other artifacts.

Native-mask providers receive the mask directly. Other supported models receive the original and a pixel-aligned selection reference. The server composites through the exact mask, including soft edges and subtracted holes, so unselected pixels and the original dimensions are preserved. A purple selection preview is context, not image content to reproduce.
