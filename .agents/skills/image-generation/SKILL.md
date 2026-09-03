---
name: image-generation
description: Generate image assets through the active iPolloWork Image Studio while preserving structured style, camera, lighting, size, and quality choices.
---

# Image generation

Use this Skill when the user wants a new image and Image Studio is active.

1. Preserve the user's subject, composition, text, brand, and format requirements.
2. Put visual style, camera, and lighting into the matching structured Image Studio fields when possible instead of repeating them throughout the prompt.
3. Use the installed provider exposed by Image Studio. Never request, print, or place API keys in a prompt or workspace file.
4. Save generated results as new workspace artifacts and report the exact returned path.
5. Keep the first pass focused. Generate variants only when the user asks for alternatives.
