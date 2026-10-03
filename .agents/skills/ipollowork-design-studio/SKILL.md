---
name: ipollowork-design-studio
description: Create or edit HTML designs inside an active iPolloWork Design Studio session while preserving its visual system, selection, theme tokens, and project boundaries.
---

# iPolloWork Design Studio

Work in the active session's existing Design project. The editor, templates, undo history and exports belong to the host.

## Session contract

- Use the injected editable path and manifest category; keep files inside `design/<session-id>/`. Read the current source and adjacent `design-tokens.css` before editing.
- Preserve the visual identity, runtime/editor hooks, responsive or fixed-canvas contract, and `--ipw-*` tokens unless the user requests the relevant change. Theme-only edits preserve content, assets and geometry.
- Respect selected-element scope and preserve unrelated work. If a supplied locator no longer resolves, stop without editing and request a new selection.
- Do not create a replacement project, preview server or helper preview page, or edit application source. Save to the exact session file and verify the affected result.

## Read by task

Resolve references from this installed Skill. Read once when needed; reuse unchanged guidance. Missing references mean an incomplete installation: check the advertised location once and report the gap, without searching another checkout.

- For `slides`, route directly to `ipollowork-presentations`; for `video`, to `ipollowork-video-studio`. Do not load this Skill's shared/type guides first.
- For a copy, selected-element or theme edit, use the current source, tokens and the affected type's rules only as needed. Do not load catalogs, layout guidance or media rules for an unchanged part of the project.
- For initial/full authoring, structural changes or an unfamiliar medium, read [Design routing and authoring](references/design.md), then the matching category only. Consult applicable sections of [Shared creative guidelines](references/shared-guidelines.md); do not preload other categories.
- When assets are required or changed, use the shared guide's media workflow. Initial/full authoring plans media needs before layout and checks outcomes before delivery. A local/theme edit with unchanged media and valid existing assets requires no new media plan or generation request.

Content determines structure; retain the user's design system without inheriting sample content or counts. Read layout catalogs only when choosing or recomposing layouts. Follow the active type's delivery checks and host acceptance gates; never claim an unperformed preview or export passed.
