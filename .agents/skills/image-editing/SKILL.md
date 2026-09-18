---
name: image-editing
description: Edit an image from the active iPolloWork Image Studio selection or mask without overwriting the source image.
---

# Image editing

Use this Skill when an existing workspace image is open in Image Studio.

1. Treat the active source path and current selection as authoritative.
2. Change only the requested region when a mask is present. Preserve unselected composition, identity, typography, and brand details.
3. Ask for a clearer selection only when the requested target cannot be inferred from the mask and prompt.
4. Save every generated edit as a new workspace image. Never overwrite or delete the source image.
5. Return the edited workspace path so Design, Video, websites, and chat artifacts can reuse it.
