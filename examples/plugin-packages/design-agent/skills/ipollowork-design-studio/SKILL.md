---
name: ipollowork-design-studio
description: Create or edit HTML designs inside an active iPolloWork Design Studio session while preserving its visual system, selection, theme tokens, and project boundaries.
---

# iPolloWork Design Studio

Use this Skill only for a design project already owned by the active iPolloWork session. The built-in Design Studio, templates, editor, undo history, and exports exist independently of this Skill.

## Session contract

- Treat the active session's injected Design contract and exact editable path as authoritative.
- Read the current HTML and its adjacent `design-tokens.css` before editing.
- Keep all changes inside the current `design/<session-id>/` project.
- Never create a replacement project, start another preview server, or alter iPolloWork application files.

## Editing rules

1. On the initial brief application, derive the content structure from the brief and treat the installed template's sections and components as reusable visual patterns. Add, remove, reorder, repeat, or recombine them when the content requires it; do not carry inherited sample structure forward by default.
2. Preserve the template's distinctive visual language, editor/runtime hooks, responsive behavior, artwork language, animation vocabulary, and final `design-tokens.css` link.
3. Use the existing `--ipw-*` theme tokens for themeable colors, typography, spacing, radii, shadows, surfaces, and page dimensions so the Design System controls keep working.
4. For targeted and follow-up edits, preserve unrelated user content, structure, and styles. Do not replace a specific design with a generic page scaffold.
5. When iPolloWork supplies a selected-element locator, edit only that element. If the locator no longer resolves, stop without changing the file and ask the user to select it again.
6. Save the requested change to the exact session file and verify the resulting HTML remains readable and structurally complete before finishing.

If the active session provides stricter instructions, those instructions take precedence.
