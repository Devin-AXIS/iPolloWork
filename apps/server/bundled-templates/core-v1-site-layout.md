# Core Site Layout Guide

Start with `../core-v1-index.md` and the website type rules, then `catalog.md`. This guide owns website-specific fit and adaptation. Read `shared-contract.md` for the fragment copy boundary.

All six patterns were extracted from the existing Prototype Web template (`ipollowork.html-anything.prototype-web/entry.html`). They provide reusable section structures; its original section order, sample text and theme are not mandatory. The server installs these files under `core-v1-site/` beside `brief.json`.

| Source | Mapping and adaptation | Avoid |
| --- | --- | --- |
| `hero.html` | Map one promise to title/body; use a meaningful visual and real action. Rebalance columns and stack at narrow widths. | Multiple competing messages, sample decoration replacing useful imagery, broken buttons |
| `feature-grid.html` | Map genuine peers to headings/bodies; choose columns from actual item count and available width. | Flattening a hierarchy into identical cards |
| `step-sequence.html` | Preserve ordered actions and their descriptions; stack while retaining DOM order. | Unordered items or a branching process disguised as one sequence |
| `evidence-pair.html` | Keep quotes and attribution together; use only real supplied evidence, remove empty slots. | Invented endorsements or claims without sources |
| `plan-comparison.html` | Align common criteria across real options; adapt labels and actions to the task. Keep labels legible when stacked. | Invented prices or mismatched comparison dimensions |
| `focused-cta.html` | End a section or page with one supported next action and concise context. | A dead action, fake submission, or mandatory closing section without a content reason |

Source `data-slot` attributes specify the actual copy targets. Trial capacities and allowed variants are indexed in `catalog.md`. Optional slots can be removed; revise geometry accordingly. Repeated fragments need unique IDs and functioning links. Content may increase section height; use content-driven breakpoints, readable measures and intrinsic media proportions. Do not impose a fixed slide canvas.

Check narrow phone, intermediate and desktop widths, long localized headings, reading order, focus, crops and real interactions after inserting final content/assets. Current evidence covers source/materialization checks only; responsive screenshots, client interaction and real-model generation remain separate acceptance work.
