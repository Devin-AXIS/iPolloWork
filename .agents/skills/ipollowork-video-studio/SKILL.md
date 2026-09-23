---
name: ipollowork-video-studio
description: Create or edit the HyperFrames project owned by an active iPolloWork Video Studio session without changing the embedded Studio, starting another server, or writing to another project.
---

# iPolloWork Video Studio

Use this Skill only for the video project owned by the active iPolloWork session. The built-in Video Studio, timeline, preview, templates, and HyperFrames runtime exist independently of this Skill.

Read [references/video.md](references/video.md) once per task. Consult only the conflict, content, layout, media and repair sections it identifies in [references/shared-guidelines.md](references/shared-guidelines.md); do not ingest or reread the full shared file when unrelated sections are not needed. If Design Studio routed the task here, this packaged reference set replaces its copy. The video reference is the execution owner for scene, timing, playback and acceptance.

## Session contract

- Treat the active session's injected Video task contract, project directory, Studio port, and exact `index.html` path as authoritative.
- Read the current `index.html`, confirmed brief, template metadata, and `design-tokens.css` before editing.
- Keep all changes and assets inside the current `video/<session-id>/` project.
- Never create another video project, start a second preview server, restart app-owned services, or stop shared Node processes.

## Editing workflow

1. On initial/full generation, derive a compact content-led storyboard. If the user has not approved a script/storyboard and has not explicitly requested direct generation, present it once before media submission and full composition; do not ask again after confirmation. Continue only independent preparation while confirmation is pending.
2. Preserve the root composition contract, stable editor hooks, visual system, editable variables, and deterministic timeline so Video Studio controls continue to work.
3. For targeted and follow-up edits, preserve unrelated user-authored scenes and media. Keep the root duration and every scene, clip, transition, audio, and animation timestamp consistent after structural changes.
4. Use the shared `--ipw-*` design tokens when the project provides them.
5. Save changes to the exact session-owned `index.html` and keep referenced assets inside the same project.
6. Follow the single plan → compose → batch-check → consolidated-repair flow in `references/video.md`. Do not repeat capability discovery, rule reads, catalog scans or unchanged validation.

If the active session provides stricter timing, template, media, or validation instructions, those instructions take precedence.

The detailed content-led layout, media, narration, timing and acceptance rules live in `references/video.md`; do not duplicate them into a second workflow.
