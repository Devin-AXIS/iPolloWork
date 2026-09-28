# Core-v1 Layout Index

This is the common entry point for structural reuse. The active deliverable category comes first; a content relationship alone never authorizes a cross-type implementation.

## Ownership and reading order

1. Read shared creative guidelines for content, evidence, assets, authorization and delivery. This index does not redefine those policies.
2. Read the active type rules for its canvas, interaction, editing and export requirements.
3. Match the content relationship below, then read the active type's `catalog.md`. Catalogs index implementations; `layout.md` explains slots, variants and fit; `shared-contract.md` specifies the type's copy boundary.
4. Compare suitable global and template-local patterns. Prefer a fitting reusable pattern; write a new composition when none fits. Counts are trial hints, never required page counts or content limits.
5. Apply the selected template's typography, palette, spacing and graphic language. A custom task derives its own coherent visual system under the shared rules.
6. Validate real content and assets under the type rules. Verification listed in a catalog is historical scope, not proof that a new output passes.

Global structures supply information hierarchy and reusable geometry. Template tokens and local authoring guides own visual identity. Similar relationships may share terminology, but PPT, website and video HTML/CSS remain independent implementations.

## Type routing

| Active type | Catalog | Implementation boundary |
| --- | --- | --- |
| `slides` | `core-v1-slides/catalog.md` | Fixed slide canvas, page sequence and supported editable/export objects |
| `site` | `core-v1-site/catalog.md` | Flowing sections, responsive reflow, semantic landmarks and real interactions |
| `video` | `core-v1-video/catalog.md` and `core-v1-video/motion/catalog.md` | Scene bodies, temporal story recipes, declared stage, deterministic motion and synchronized audio/timing |

The server places this index beside `brief.json` and materializes only the active type's directory. Other-type paths are routing metadata, not installed files to open. App, poster, cards, report, article and other types do not yet have catalogs here. Follow their type rules and local sources; do not invent a directory or borrow incompatible markup.

## Shared content relationships

These are descriptive labels, not a whitelist. New relationships and compositions remain valid.

| Relationship | Meaning | PPT candidates | Website candidates | Video candidates |
| --- | --- | --- | --- | --- |
| `statement-visual` | One claim supported by a meaningful visual | statement-visual | hero | statement-visual |
| `parallel` | Items of equal rank | parallel-principles | feature-grid | feature-orbit |
| `sequence` | Ordered actions or stages | step-sequence | step-sequence | step-sequence |
| `comparison` | Alternatives evaluated on shared criteria | comparison | plan-comparison | two-zone |
| `attributed-evidence` | Attributed voices or observations | quote-wall | evidence-pair | evidence-wall |
| `lead-support` | One case with supporting observations | lead-support | No indexed implementation | No indexed implementation |
| `milestones` | Outcomes enabling subsequent stages | milestone-staircase | No indexed implementation | timeline |
| `visual-narrative` | A visual carries the narrative | editorial-visual | No indexed implementation | No indexed implementation |
| `evidence-matrix` | Findings across shared dimensions | evidence-matrix | No indexed implementation | No indexed implementation |
| `metrics` | A primary result with supporting measures | metric-scorecard | No indexed implementation | No indexed implementation |
| `relationship` | Factors or stages connected to a shared outcome | No indexed implementation | No indexed implementation | relationship-map |
| `decision` | A visible checkpoint determines what happens next | No indexed implementation | No indexed implementation | checkpoint |
| `waterfall` | A baseline changes through contributing factors | No indexed implementation | No indexed implementation | waterfall |
| `action` | One next action after context | No indexed implementation | focused-cta | No indexed implementation |

For example, `sequence` is a shared content relationship: a PPT implementation must fit its fixed stage or split into pages; a website implementation may grow vertically and stack at narrow widths; a video implementation reveals stages in the active scene's timing window and must remain correct when seeking. Never copy breakpoint reflow into PPT or impose a slide's fixed height on a web section.

## Catalog fields and verification

All type catalogs use the same fields: source file, type, relationship, fit, slots, trial capacity, variants and verification. The file is relative to that catalog; details and provenance live in its layout guide. Qualified identities are category plus file, such as `slides/step-sequence.html` and `site/step-sequence.html`.

Verification states describe evidence, not quality promises: source/materialization checks, rendered preview checks, real-model generation, client editing and export are distinct. Only record checks actually performed; never promote a one-off composition into the shared library automatically.
