---
name: ipollowork-design-studio
description: Create or edit HTML designs inside an active iPolloWork Design Studio session while preserving its visual system, selection, theme tokens, and project boundaries.
---

# iPolloWork Design Studio

Use this Skill only for a design project already owned by the active iPolloWork session. The built-in Design Studio, templates, editor, undo history, and exports exist independently of this Skill.

Before initial/full authoring, call `media/artifact_media_review` phase=plan with the active HTML sourcePath and visual needs; follow references/shared-guidelines.md. Before final delivery call phase=check, resolve pending/missing assets and disclose fallbacks. For websites, call `media/artifact_preview_review` once with `kind="site"` after authoring and again only after repairing reported issues. This client action is the sole preview and responsive batch-acceptance entry. Never start a temporary server, create helper preview HTML, use generic browser screenshots, or open multiple preview tabs. Do not replace either workflow with a verbal assessment or a self-selected geometric style.

## Session contract

- Treat the active session's injected Design contract and exact editable path as authoritative.
- Read the current HTML and its adjacent `design-tokens.css` before editing.
- Keep all changes inside the current `design/<session-id>/` project.
- Never create a replacement project, start another preview server, or alter iPolloWork application files.

## Required type rules

Before editing, resolve the category from the session contract and manifest, or infer it from the requested deliverable when no manifest is available. For Design categories, read this Skill's [references/shared-guidelines.md](references/shared-guidelines.md) and [references/design.md](references/design.md) once, then only the matching category reference listed there. Do not reread full rule files after edits. For `slides` or `video`, route directly to the owning Skill below and let its packaged shared reference replace this one; do not load both shared-rule copies. Resolve paths relative to the current installed Skill, not a remembered checkout. If a file is missing, check the advertised Skill location once and report the gap; never pretend to have read it.

Use this sequence for bundled/custom templates, fully custom generation and follow-up edits while preserving the narrower edit scope. Type references own structure, interaction and acceptance checks; shared guidelines and media Skills own asset and model decisions.

For `category: "slides"`, use `ipollowork-presentations` and its packaged `references/shared-guidelines.md`, `references/slides-ppt.md` and `references/layout.md`, including for HTML decks. Preserve the HTML presentation runtime or native editable PPTX contract as appropriate.

For `category: "video"`, use `ipollowork-video-studio` and the session's Video surface contract. Do not replace the timed composition with a Design HTML page.

## Editing rules

1. On the initial brief application, derive the content structure from the brief and treat the installed template's sections and components as reusable visual patterns. Add, remove, reorder, repeat, or recombine them when the content requires it; do not carry inherited sample structure forward by default.
2. Preserve the template's distinctive visual language, editor/runtime hooks, responsive behavior, artwork language, animation vocabulary, and final `design-tokens.css` link.
3. Use the existing `--ipw-*` theme tokens for themeable colors, typography, spacing, radii, shadows, surfaces, and page dimensions so the Design System controls keep working.
4. For targeted and follow-up edits, preserve unrelated user content, structure, and styles. Do not replace a specific design with a generic page scaffold.
5. When iPolloWork supplies a selected-element locator, edit only that element. If the locator no longer resolves, stop without changing the file and ask the user to select it again.
6. Save the requested change to the exact session file and verify the resulting HTML remains readable and structurally complete before finishing.

If the active session provides stricter instructions, those instructions take precedence.

## Content-led layout adaptation

Follow the injected template layout contract. Before editing, identify reusable typography, palette, spacing, shapes and artwork in the source; sample section geometry is not fixed. Match each section to its purpose: comparison, steps, evidence, case study or key message. Reuse a fitting pattern, vary its proportions/columns/alignment, or compose a new layout from the same primitives. Keep coherent reading order and responsive behavior across widths; do not reduce every section to the same card grid.

Respect an explicit request to match the template exactly, fixed-brand regions and selected-element scope. Inspect rendered sections for overflow, excessive density, unjustified repetition and style drift. Recompose dense content rather than shrinking text or deleting facts; do not introduce variety merely for decoration.

For slides and sites, read `core-v1-index.md` beside `brief.json` once, then use catalog metadata to shortlist at most three plausible layouts from only the active type's `core-v1-slides/` or `core-v1-site/` source. Open layout source only for that shortlist; a new layout remains valid when none fits. The index maps shared content relationships; implementations remain type-specific. PPT keeps its fixed canvas and supported editable markers; websites use responsive flow and semantic interactions. Video uses the Video Studio workflow and its `core-v1-video/` catalog with separate timing and playback constraints. Copy only structural fragments and scoped styles, excluding preview hosts, palettes and scripts. Preserve the active template's tokens unless restyling is requested, and verify real content/assets under the type rules. Catalog verification never substitutes for current delivery checks.
