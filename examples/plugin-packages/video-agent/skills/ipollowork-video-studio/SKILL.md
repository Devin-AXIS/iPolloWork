---
name: ipollowork-video-studio
description: Create or edit the HyperFrames project owned by an active iPolloWork Video Studio session without changing the embedded Studio, starting another server, or writing to another project.
---

# iPolloWork Video Studio

Use this Skill only for the video project owned by the active iPolloWork session. The built-in Video Studio, timeline, preview, templates, and HyperFrames runtime exist independently of this Skill.

Before editing, read [references/shared-guidelines.md](references/shared-guidelines.md), then [references/video.md](references/video.md). Shared rules own content/media decisions; the video reference owns scene, timing, playback and acceptance constraints.

Before initial/full authoring, call `media/artifact_media_review` phase=plan with the active HTML sourcePath and visual needs; follow references/shared-guidelines.md. Before final delivery call phase=check, resolve pending/missing assets and disclose fallbacks. The host queries capabilities and checks saved-file placement and generation receipts; preview remains required. Do not replace this workflow with a verbal assessment or a self-selected geometric style.

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

## Content-led layout adaptation

Follow the injected template layout contract. Extract the template's typography, palette, spacing, graphic primitives and motion vocabulary. Choose scene compositions for their content: a comparison, sequence, data explanation, case study or key message. Reuse a fitting scene, vary its composition, or build a new scene from the same primitives instead of repeating the template's text placeholders. Keep transitions and movement stylistically consistent; new layouts must retain deterministic timing and editor hooks.

Respect explicit exact-layout requests, fixed-brand regions and the scope of follow-up edits. Inspect representative frames and transitions for readability, density, clipping, unjustified repetition and style drift. Allow enough time for the actual narration and synchronize the timeline after changes; do not shrink text, drop facts or accelerate narration to fit sample geometry or timing.

Video sessions receive `core-v1-index.md` and `core-v1-video/` by default. Read the index, then this type's catalog, layout guide and shared contract. Reuse fitting scene bodies with scoped styles; do not copy preview hosts, scripts, theme defaults or composition roots. Preserve active tokens unless restyling is requested, and integrate motion into the current timeline. Local/new compositions remain valid; verify real content, seeks and playback under the video rules.
