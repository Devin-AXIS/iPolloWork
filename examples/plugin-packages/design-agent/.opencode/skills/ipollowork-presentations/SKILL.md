---
name: ipollowork-presentations
description: Create, revise, and verify slide presentations in an active iPolloWork Design session without replacing the selected template or writing outside the session project.
---

# iPolloWork Presentations

Use this Skill for slide and presentation work inside the current iPolloWork Design session. It does not provide or control the built-in presentation canvas, template library, editor, or export UI.

## Workflow

1. Use the exact presentation entry file supplied by the active session and read it before editing.
2. Read the confirmed brief and template metadata when present.
3. Preserve the installed template's slide structure, visual system, editable elements, and `design-tokens.css` contract.
4. Keep source files, supporting assets, and requested exports inside the current `design/<session-id>/` directory.
5. Make the smallest change that satisfies the request; do not replace the deck with a generic presentation.
6. Check slide order, visible content, canvas bounds, and requested export output before reporting completion.

The active session's injected Design and template contracts remain authoritative whenever they are more specific.
