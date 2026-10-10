---
name: ipollowork-presentations
description: Create, revise, and verify slide presentations in an active iPolloWork Design session while retaining the selected template's visual and editable contracts.
---

# iPolloWork Presentations

Use the exact entry in the current `design/<session-id>/` project. Read its source and `design-tokens.css`; the host owns the canvas, editor, navigation and exports.

## Keep the presentation contract

- Preserve the template's visual system, fixed canvas, stable `data-ipw-slide` roots and object IDs, runtime and token link. Theme-only edits change semantic `--ipw-*` values while preserving content, page count/order, assets and object geometry; check font fit without silently rearranging objects.
- In native editable PPT, keep separate `data-pptx-text`, `data-pptx-shape` and `data-pptx-image` objects; let the Design panel own navigation. Do not add presentation scripts, controls, speaker-note nodes or responsive slide reflow. HTML decks retain their existing supported runtime.
- Targeted edits preserve unrelated slides and objects. Content determines new decks' narrative and page count; samples are reusable patterns, not required structure or facts.

## Read by task

Resolve references relative to this installed Skill, not a repository or remembered project. Read relevant sections once and reuse them; report missing installed references accurately.

- **Copy, selected-object or theme edit:** use the current source/tokens and applicable sections of [PPT rules](references/slides-ppt.md). Do not load layout catalogs or media guidance for unchanged assets and structure.
- **Creation, narrative rewrite or structural change:** read the PPT scope/narrative/mode rules and relevant [Shared creative guidelines](references/shared-guidelines.md). Read [Layout selection](references/layout.md) only when selecting or recomposing a layout; open only fitting candidates from the actual session library or local source.
- **Asset work:** apply the shared media workflow, including live capabilities, authorized model selection, actual placement and plan/check outcomes. Initial/full authoring plans needs before layout; unchanged media with valid existing assets in a local/theme edit needs no new plan or generation.
- **Delivery:** use the PPT acceptance section. `media/artifact_preview_review` is the sole client batch preview; shared token/style changes require one whole-deck batch. Never substitute a server, helper page, generic browser screenshots or per-slide captures. Check editor/export behavior when affected or requested and distinguish checked, unavailable and unverified work.
