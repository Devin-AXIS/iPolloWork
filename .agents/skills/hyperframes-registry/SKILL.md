---
name: hyperframes-registry
description: Reuse approved HyperFrames blocks and components inside the active iPollo Video project.
---

# HyperFrames Registry

Use this Skill when a reusable block or component fits the current video brief.

1. Select component IDs from the active project's supplied component map.
2. Call `ipollowork_extension_call` with `extensionId=media`, `action=video_component_install`, and `args={sourcePath:"video/<exact-project-id>/index.html",componentIds:[...]}`. Install all selected IDs in one bounded call.
3. Use the returned `data-composition-src` snippets. Preserve `data-ipw-registry-component`, assign a unique `data-composition-id`, add the selected `data-motion-pattern`, and pass real content through `data-variable-values`. Do not recreate a selected component from memory.
4. Add only the minimum components required by the active project. Adapt tokens, timing, content, and the component's existing paused timeline to the real narration window.
5. If no component fits structurally, author a local scene with `data-ipw-component-decision="custom:<specific reason>"`; visual preference or convenience is not sufficient.
6. Do not install global Skills or modify unrelated projects.
7. Save the complete composition once. The client runs `media/video_component_check` for the exact `sourcePath` inside its aggregate delivery gate and may request one bounded repair continuation.
