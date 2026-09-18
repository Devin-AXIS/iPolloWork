---
name: ipollowork-presentations
description: Create, revise, and verify slide presentations in an active iPolloWork Design session while retaining the selected template's visual and editable contracts.
---

# iPolloWork Presentations

Use this Skill for slide and presentation work inside the current iPolloWork Design session. It does not provide or control the built-in presentation canvas, template library, editor, or export UI.

## Workflow

1. Use the exact presentation entry file supplied by the active session and read it before editing.
2. Read the confirmed brief and template metadata when present.
3. On the initial brief application, plan a content-led narrative and page count, then select, repeat, recombine, remove, or reorder the installed template's slide patterns. Do not inherit its sample slide count, order, copy, or assets unless they fit the brief.
4. Preserve the template's distinctive visual system, fixed stage, navigation/runtime behavior, editable object contract, and `design-tokens.css` link so Design System controls and exports continue to work.
5. For targeted and follow-up edits, preserve unrelated user-authored slides and content. Never replace the deck with a generic presentation.
6. Keep source files, supporting assets, and requested exports inside the current `design/<session-id>/` directory.
7. Check narrative order, visible content, canvas bounds, editability, and requested export output before reporting completion.

The active session's injected Design and template contracts remain authoritative whenever they are more specific.
