---
name: ipollowork-video-studio
description: Create or edit the HyperFrames project owned by an active iPolloWork Video Studio session without changing the embedded Studio, starting another server, or writing to another project.
---

# iPolloWork Video Studio

Use this Skill only for the video project owned by the active iPolloWork session. The built-in Video Studio, timeline, preview, templates, and HyperFrames runtime exist independently of this Skill.

## Session contract

- Treat the active session's injected Video task contract, project directory, Studio port, and exact `index.html` path as authoritative.
- Read the current `index.html`, confirmed brief, template metadata, and `design-tokens.css` before editing.
- Keep all changes and assets inside the current `video/<session-id>/` project.
- Never create another video project, start a second preview server, restart app-owned services, or stop shared Node processes.

## Editing workflow

1. On the initial brief application, derive a content-led storyboard and use the installed template as a reusable visual and motion system. Add, remove, reorder, or retime scenes when the brief requires it; do not inherit sample scene structure, copy, or media by default.
2. Preserve the root composition contract, stable editor hooks, visual system, editable variables, and deterministic timeline so Video Studio controls continue to work.
3. For targeted and follow-up edits, preserve unrelated user-authored scenes and media. Keep the root duration and every scene, clip, transition, audio, and animation timestamp consistent after structural changes.
4. Use the shared `--ipw-*` design tokens when the project provides them.
5. Save changes to the exact session-owned `index.html` and keep referenced assets inside the same project.
6. Run the HyperFrames check required by the active session against that exact project before reporting completion.

If the active session provides stricter timing, template, media, or validation instructions, those instructions take precedence.
