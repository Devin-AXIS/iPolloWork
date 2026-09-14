---
name: image-generation
description: Generate image assets through iPolloWork's image service, whether Image Studio is open or closed.
---

# Image generation

Use this Skill when the user wants a new image. Image Studio does not need to be open.

1. Preserve the user's subject, composition, text, brand, and format requirements.
2. Discover `openai-image-generation` using `ipollowork_extension_list_actions`, then call its `status` action. Show the configured, available image models to the user and ask them to choose one unless the current Image Studio context already contains a model they selected. Never infer a model, use `defaultModel` as consent, or choose the first result—even when only one model is configured.
3. After the user chooses, call `image_generate` through `ipollowork_extension_call` with that exact stable `model` ID, the prompt, and optional quality/size. Include style, camera, and lighting requirements in the prompt.
4. Use this server action for ordinary chat requests even when Image Studio is open. UI tool discovery and opening the workbench are unnecessary. Use workbench tools only when the user explicitly requests the current workbench settings or selection. Never request, print, or place API keys in a prompt or workspace file.
5. Save generated results as new workspace artifacts and include a Markdown image link to the exact returned path in the final response. Never claim success until the action returns the saved file. The image artifact can be opened in Image Studio from the conversation.
6. Keep the first pass focused. Generate variants only when the user asks for alternatives.
