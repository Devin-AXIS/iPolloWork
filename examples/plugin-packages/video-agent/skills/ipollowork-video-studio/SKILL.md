---
name: ipollowork-video-studio
description: Create or edit the HyperFrames project owned by an active iPolloWork Video Studio session without changing the embedded Studio, starting another server, or writing to another project.
---

# iPolloWork Video Studio

Use this Skill only for the video project owned by the active iPolloWork session. The built-in Video Studio, timeline, preview, templates, and HyperFrames runtime exist independently of this Skill.

Read [references/video.md](references/video.md) once per task. For initial generation or substantial scene redesign, also read [references/video-motion-principles.md](references/video-motion-principles.md) once; targeted edits do not need it. Read [references/video-acceptance.md](references/video-acceptance.md) once before final validation. Consult only the conflict, content, layout, and media sections identified in [references/shared-guidelines.md](references/shared-guidelines.md); do not ingest or reread the full shared file when unrelated sections are not needed. If Design Studio routed the task here, this packaged reference set replaces its copy. The video reference is the execution owner for scene, timing, and playback; the acceptance reference owns the final video verdict.

## Session contract

- Treat the active session's injected Video task contract, project directory, Studio port, and exact `index.html` path as authoritative.
- Read the current `index.html`, confirmed brief, template metadata, and `design-tokens.css` before editing.
- Keep all changes and assets inside the current `video/<session-id>/` project.
- Never create another video project, start a second preview server, restart app-owned services, or stop shared Node processes.

## Editing workflow

1. On initial/full generation, identify the narrative driver, map intended audience changes to observable events, shortlist executable recipes by intent and capacity, then save a compact content-led storyboard. Continue production by default. Pause after the script only when the user explicitly requests script review or a script-only result; do not ask again after confirmation.
2. Preserve the root composition contract, stable editor hooks, visual system, editable variables, and deterministic timeline so Video Studio controls continue to work.
3. For targeted and follow-up edits, preserve unrelated user-authored scenes and media. Keep the root duration and every scene, clip, transition, audio, and animation timestamp consistent after structural changes.
4. Use the shared `--ipw-*` design tokens when the project provides them.
5. Save changes to the exact session-owned `index.html` and keep referenced assets inside the same project.
6. For initial generation or structural reordering, use the Sequence templates section in `references/video.md` to select a fitting structure, assign executable recipe slots and plan adjacent handoffs before transitions. Follow the recipe-selection method and single plan → compose → batch-check → consolidated-repair flow in `references/video.md`. Record fit and tradeoffs in the existing script; review delivered recipe fit through `references/video-acceptance.md`. Do not repeat capability discovery, rule reads, catalog scans or unchanged validation.

If the active session provides stricter timing, template, media, or validation instructions, those instructions take precedence.

The detailed content-led layout, media, narration, timing and acceptance rules live in `references/video.md`; do not duplicate them into a second workflow.
