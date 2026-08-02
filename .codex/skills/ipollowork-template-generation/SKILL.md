---
name: ipollowork-template-generation
description: Create or update reusable iPolloWork templates through conversation for Design, Slides/native editable PPT, and HyperFrames Video. Use when planning, generating, repairing, validating, or saving a template package, manifest, reusable variables, cover, slide/PPT markers, video composition, or design-system token integration.
---

# iPolloWork Template Generation

Create a reusable template, not a one-off artifact. The product-selected category and server validator are authoritative.

## Route The Work

1. Read [references/template-generation-contract.md](references/template-generation-contract.md).
2. Read exactly one surface reference:
   - Design: [references/design.md](references/design.md)
   - Slides or native editable PPT: [references/slides-ppt.md](references/slides-ppt.md)
   - HyperFrames Video: [references/video.md](references/video.md)
3. When converting an existing project, preserve its category, surface, structure, and source files. Saving creates a new personal template; it never updates the source template.

## Conversational Authoring

Guide the user in this order: purpose and audience, content structure, reusable variables, visual/design system, surface-specific constraints, generation and validation.

- Ask one consequential question at a time.
- Do not ask for information the user already supplied.
- Once the project is sufficiently specified, edit the project and show the result instead of extending the interview.
- Keep the package manifest, variable declarations, cover, and validation checklist current after every structural change.
- Treat the selected design system as optional context. Load only its manifest, usage guide, and design rules; never load every installed system.
- Use local assets or stable user-provided asset URLs. Do not invent dependencies.

## Package Loop

1. Maintain `manifest.json`, the surface entry, `design-tokens.css`, local assets when needed, and a 960 x 540 cover.
2. Put reusable content in typed manifest/HyperFrames variables and reusable visual choices in `--ipw-*` tokens. Do not mix content variables with design tokens.
3. Preserve structural invariants while applying themes: DOM meaning, responsive layout, slide geometry/PPT markers, or video timing/tracks/compositions.
4. Run the product validator before saving:

```powershell
node .codex/skills/ipollowork-template-generation/scripts/audit-template.mjs <template-directory>
```

5. Repair every error. Warnings must be resolved or deliberately accepted.
6. Re-instantiate the staged package and verify that the correct right-side editor opens, variables remain editable, theme switching preserves structure, and the source project is unchanged.

## Hard Boundary

This Skill is guidance for repository agents. Product runtime behavior does not depend on Skill discovery. Authoring System Context and the shared server validator provide the same category rules to every user.

## Completion

Report the selected surface/category, files changed, reusable variables, design-system coverage, preserved surface invariants, validator result, re-instantiation result, and any remaining warning.
