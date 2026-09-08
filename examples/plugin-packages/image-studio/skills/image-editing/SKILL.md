---
name: image-editing
description: Edit an image from the active iPolloWork Image Studio selection or mask without overwriting the source image.
---

# Image editing

Use this Skill when an existing workspace image is open in Image Studio or the conversation includes an attached Image Studio selection.

1. When the conversation includes a captured `selectionId`, call `openai-image-generation/image_edit` using that ID, its `sourcePath`, selected model and the user's edit prompt. The snapshot includes the original image and full mask; it remains authoritative if the workbench changes or closes. Do not replace it with the current UI selection or a bounding rectangle. Without a snapshot, use the active workbench source and selection.
2. Change only the requested region when a mask is present. Preserve unselected composition, identity, typography, and brand details.
3. Ask for a clearer selection only when the requested target cannot be inferred from the mask and prompt.
4. Save every generated edit as a new workspace image. Never overwrite or delete the source image.
5. Return the edited workspace path so Design, Video, websites, and chat artifacts can reuse it.

Native-mask providers receive the mask directly. Other supported models receive the original and a pixel-aligned selection reference. The server composites through the exact mask, including soft edges and subtracted holes, so unselected pixels and the original dimensions are preserved. A purple selection preview is context, not image content to reproduce.
