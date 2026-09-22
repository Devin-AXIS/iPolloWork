---
name: image-editing
description: Edit an image from the active iPolloWork Image Studio selection or mask without overwriting the source image.
---

# Image editing

Use this Skill when an existing workspace image is open in Image Studio or the conversation includes an attached Image Studio selection.

1. Use the model explicitly selected by the user in the Image Studio reference. For a captured workbench annotation without a model, honor its selection instructions. For other edits, call `openai-image-generation/status` and follow the image-generation Skill’s model policy: verified user preference/automatic strategy or a sole suitable authorized model, otherwise ask once. The status `defaultModel` candidate is not a saved user preference. Never replace an explicit unavailable choice silently.
2. When the conversation includes a captured `selectionId`, call `openai-image-generation/image_edit` using that ID, its `sourcePath`, the exact selected model ID and the user's edit prompt. The snapshot includes the original image and full mask; it remains authoritative if the workbench changes or closes. Do not replace it with the current UI selection or a bounding rectangle. Without a snapshot, use the active workbench source and selection.
3. Change only the requested region when a mask is present. Preserve unselected composition, identity, typography, and brand details.
4. Ask for a clearer selection only when the requested target cannot be inferred from the mask and prompt.
5. Save every generated edit as a new workspace image. Never overwrite or delete the source image.
6. In the final response, embed the edited image using a Markdown image link and report its exact workspace-relative path. This gives the conversation both an image preview and a reusable file card for Design, Video, websites, and other artifacts.

Native-mask providers receive the mask directly. Other supported models receive the original and a pixel-aligned selection reference. The server composites through the exact mask, including soft edges and subtracted holes, so unselected pixels and the original dimensions are preserved. A purple selection preview is context, not image content to reproduce.
