<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# PPT Layout Guide · core-v1

This guide describes the ten reusable structures currently in the iPolloWork PPT library. It explains when to choose each structure, how to map content into it and when to adapt or replace it. The library is a preferred reuse source, not a mandatory whitelist or a complete inventory of template-local layouts. Use a better-fitting local pattern or write a new one when necessary, retaining the active visual and editable contracts.

Start with `../core-v1-index.md` beside the session's category directory for shared relationships and type routing. This guide supplies PPT-specific fit and adaptation; shared creative/media policy remains in the shared guidelines.

## Locate the source

For a session that declares `layoutLibrary: "core-v1"`, the server materializes `core-v1-slides/` beside `brief.json`. This directory contains the quick index `catalog.md`, this `layout.md`, `shared-contract.md`, `shared.css` and the ten HTML files below. Resolve those files from the current session, not from the installed Skill's `references/` directory. A Skill-packaged copy of this guide is documentation, not a second copy of the HTML library.

If the directory is absent in an older session, inspect available local patterns and the active contract. Do not invent file paths, assume missing layouts exist or overwrite the user's project merely to obtain a library. Read only the relevant candidate HTML and styles.

Repository ownership: this document is maintained in `.codex/skills/ipollowork-template-generation/references/layout.md`. The server bundle and both presentation Skill distributions carry checked copies. Source HTML/CSS lives under `apps/server/bundled-templates/core-v1-slides-*`; the server assembles those flat resources into the session directory above.

## Selection map

| Layout file | Content relationship | Main slots | Trial capacity |
| --- | --- | --- | --- |
| `comparison.html` | Two alternatives on shared criteria | Title, option names, criteria, paired evidence, takeaway | 2–3 criteria |
| `statement-visual.html` | One main statement supported by a visual | Eyebrow, title, paragraph, visual | One message and one visual |
| `parallel-principles.html` | Peer principles or capabilities | Title, numbered labels, headings, paragraphs | 2–3 peer items |
| `lead-support.html` | A lead case with supporting observations | Title, case label/heading/body, supporting headings/bodies | One case and 1–2 observations |
| `step-sequence.html` | Ordered actions or learning stages | Title, numbers, step headings/bodies | 3–5 steps |
| `milestone-staircase.html` | Successive milestones earned through evidence | Title, stage/date labels, outcomes, evidence, note | 3–4 stages |
| `editorial-visual.html` | Image-led narrative or setting | Eyebrow, title, paragraph, main visual, caption/source | One image and short explanation |
| `quote-wall.html` | Related but distinct attributed voices | Title, segment, main quote/attribution, supporting quotes/attributions | One lead and 1–2 short quotes |
| `evidence-matrix.html` | Findings across comparable groups or options | Title, column/row labels, findings, details, source | Up to 3 rows × 3 comparison columns |
| `metric-scorecard.html` | One key result with supporting measures | Title, primary label/value/context, supporting labels/values, source | One primary and 2–4 secondary metrics |

These counts describe trial structures, not quotas or validated limits for every language/theme. Source grids demonstrate particular counts; removing an item also requires adjusting columns, rows and proportions. Content and explicit user constraints determine page count.

## Reuse procedure

1. Identify the message, evidence and content relationship. Assess asset purpose, existing files and gaps, and make required capability queries under the shared guidelines before committing to text or geometry.
2. Compare the template's local patterns and relevant entries below. Open candidate source HTML, read `data-layout-description` and `data-slot`, and inspect the actual DOM and `shared.css` dependencies.
3. Read `shared-contract.md`. Copy the selected `<section data-layout>` and the relevant scoped CSS, including shared baseline selectors covering that layout. Omit `html`, `body`, `main`, preview `:root` values and demo scripts. Bind to the active theme's semantic `--ipw-*` tokens.
4. Replace every example and assign valid unique slide/object identifiers and ordering. Retain `data-ipw-slide` and the matching editable-object markers. Optional slots may be removed; update layout geometry accordingly.
5. Generate/reuse and place required assets, then trial real short/dense content and long titles with final fonts. Adjust locally or split within user constraints. Never use all-page font shrinking, hidden overflow or responsive reflow as a fixed-canvas workaround.
6. Check actual rendering, relevant client editing and requested exports separately. Do not claim one-off extensions or untested exports are verified library capabilities.

The structural library and asset Skills have separate responsibilities. Example shapes do not prohibit imagery. Native editable PPT supports marked image objects; a Markdown source or editability requirement does not justify skipping a required media query. Follow shared model-selection and authorization rules rather than adding another approval flow here.

## 1. Comparison

- **Source:** `comparison.html`, `.ipw-layout-comparison`; adapted from Brand Narrative's `.tension` relationship.
- **Use for:** two alternatives evaluated on the same dimensions, with a conditional recommendation.
- **Slots:** `title`, `option-a`, `option-b`, `criterion-1…3`, paired `a-1…3`/`b-1…3`, `takeaway`.
- **Capacity:** trial 2–3 short criteria, concise paired evidence and one takeaway. Keep units and uncertainty comparable across both sides.
- **Variants:** remove an unused row, widen the criterion column, adjust the evidence-column ratio or split dense dimensions across pages. Keep corresponding rows aligned.
- **Avoid:** unrelated items presented as a comparison, invented metrics or long narratives crammed into cells. More than two alternatives may need a table or a new structure.

## 2. Statement and visual

- **Source:** `statement-visual.html`, `.ipw-layout-statement-visual`; adapted from Brand Narrative's `.manifesto`.
- **Use for:** an opening, chapter or conclusion centered on one statement.
- **Slots:** `eyebrow`, `title`, `body`, `visual`.
- **Capacity:** start with a 2–3-line title and a 3–5-line supporting paragraph, then measure with the target font and width.
- **Variants:** adjust the column ratio, widen or vertically reorganize the title region, and replace the sample circle with a meaningful image, editable chart or graphic. Keep one dominant focus.
- **Assets:** the circle only demonstrates space. If replacing it with an image, remove `data-pptx-shape`, add `data-pptx-image`, provide actual `src`/`alt`, and revise shape-specific sizing/crop rules.
- **Avoid:** preserving the circle merely because it is in the sample, or letting a long title cover the supporting text.

## 3. Parallel principles

- **Source:** `parallel-principles.html`, `.ipw-layout-parallel-principles`; adapted from Brand Narrative's `.voice-spectrum`.
- **Use for:** genuinely peer principles, capabilities or summary points.
- **Slots:** `title`, `label-1…3`, `heading-1…3`, `body-1…3`.
- **Capacity:** 2–3 items, each with a short heading and brief explanation. The source uses three columns; a two-item variant must use two columns rather than leave an empty third.
- **Variants:** reduce columns, balance width against actual copy, remove unnecessary labels or split longer explanations.
- **Avoid:** flattening a hierarchy or sequence into peer cards, or reducing all typography to preserve three columns.

## 4. Lead and support

- **Source:** `lead-support.html`, `.ipw-layout-lead-support`; adapted from Brand Narrative's `.expression`.
- **Use for:** one main case/outcome explained by evidence and conditions.
- **Slots:** `title`, `case-label`, `case-heading`, `case-body`, `support-heading-1…2`, `support-body-1…2`.
- **Capacity:** one focused case and 1–2 supporting observations. Keep background, action and result concise and sourced.
- **Variants:** change primary/secondary proportions, remove an unused support block or move excess evidence to another page. The lead region may be adapted to actual imagery plus a readable caption.
- **Avoid:** presenting a single case as universal proof or leaving unused blocks filled with generic text.

## 5. Step sequence

- **Source:** `step-sequence.html`, `.ipw-layout-step-sequence`; adapted from `ipollowork.pptx-learning-journey/entry.html`, slide 5, `.chapters`.
- **Use for:** ordered actions, a learning path or a repeatable process.
- **Slots:** `title`, `number-1…5`, `heading-1…5`, `body-1…5`.
- **Capacity:** 3–5 steps, each with a short heading and one explanatory sentence. The five-column example requires especially concise copy.
- **Variants:** reduce the grid to the actual step count, group related steps into phases or move detailed instructions to subsequent pages. Preserve an unambiguous reading order.
- **Avoid:** unordered peer principles, branching workflows disguised as a single line, or long procedural text in narrow columns.

## 6. Milestone staircase

- **Source:** `milestone-staircase.html`, `.ipw-layout-milestone-staircase`; adapted from `ipollowork.pptx-venture-blueprint/entry.html`, slide 6, `.staircase`.
- **Use for:** stages where an achieved outcome enables the next stage.
- **Slots:** `title`, `date-1…4`, `heading-1…4`, `evidence-1…4`, `note`.
- **Capacity:** 3–4 stages with a date/phase label, short outcome and evidence line. The first step has the least vertical capacity; check it first.
- **Variants:** adjust actual column count and step heights, shorten nonessential wording or split the roadmap. Heights indicate sequence only, never quantitative magnitude; use a chart for measured values.
- **Avoid:** invented deadlines or progress metrics, lengthy evidence inside the shortest step, and treating decorative height as data.

## 7. Editorial visual

- **Source:** `editorial-visual.html`, `.ipw-layout-editorial-visual`; adapted from `ipollowork.pptx-film-treatment/entry.html`, slide 1, `.cover` and `.hero-art`.
- **Use for:** image-led narrative, a setting, an observed subject or a cover where visual context matters.
- **Slots:** `eyebrow`, `title`, `body`, `visual`, `caption`; `visual-placeholder` exists only inside the replaceable demo slot.
- **Capacity:** one main visual, a short title/paragraph and a caption/source. Trial a two-line title; rebalance text width or height for longer titles rather than forcing that count.
- **Variants:** adjust image/text proportions, crop to retain the subject, use contain-fit when cropping would discard evidence, or split the explanation from the image.
- **Assets:** replace the entire placeholder with `<img class="visual-slot" data-slot="visual" data-pptx-image src="assets/actual-file.ext" alt="Meaningful description">`, using a real saved file. Remove the placeholder text and shape marker; supply an accurate caption/source. Editable diagrams may use a purpose-built structure instead.
- **Avoid:** shipping the placeholder, using decorative geometry to bypass required asset discovery, or presenting generated illustration as documentary evidence.

## 8. Quote wall

- **Source:** `quote-wall.html`, `.ipw-layout-quote-wall`; adapted from `ipollowork.pptx-research-signals/entry.html`, slide 4, `.quote-wall`.
- **Use for:** related but distinct voices that support or qualify a main observation.
- **Slots:** `title`, `segment`, `quote`, `attribution`, `quote-1…2`, `attribution-1…2`.
- **Capacity:** one main quote of roughly 2–4 rendered lines and 1–2 brief supporting quotes, each with an attribution. Sample quote text is illustrative and must be replaced or removed.
- **Variants:** remove an unused side quote and update grid rows, widen the main quote area, or dedicate a page to a long essential quotation.
- **Avoid:** invented testimonials, unattributed quotes, editing a quotation in ways that change its meaning, or presenting one participant as an entire group's view.

## 9. Evidence matrix

- **Source:** `evidence-matrix.html`, `.ipw-layout-evidence-matrix`; adapted from `ipollowork.pptx-research-signals/entry.html`, slide 5, `.matrix`.
- **Use for:** comparable findings across groups, options or contexts with explicit uncertainty.
- **Slots:** `title`, `column-0…3` (including the row-label header), `row-1…3`, `finding-r-c`, `detail-r-c`, `source`.
- **Capacity:** up to three observation rows and three comparison columns plus the row-label column. Each cell holds a short finding and qualifier, not a paragraph.
- **Variants:** reduce actual rows/columns and update the grid, widen row labels, or split by evidence dimension. Keep source, sample definition and limitations visible.
- **Avoid:** invented confidence scores, incomparable data definitions, unsupported rankings, or compressing a large research table into unreadable cells.

## 10. Metric scorecard

- **Source:** `metric-scorecard.html`, `.ipw-layout-metric-scorecard`; adapted from `ipollowork.pptx-annual-review/entry.html`, slide 2, `.scorecard`.
- **Use for:** a primary outcome interpreted through a small set of supporting measures.
- **Slots:** `title`, `metric-label`, `metric-value`, `metric-context`, `label-1…4`, `value-1…4`, `source`.
- **Capacity:** one primary metric and 2–4 supporting metrics. The source uses a 2×2 secondary grid; adjust rows/columns when using fewer values.
- **Variants:** reallocate the primary/secondary ratio, use consistent number formatting or split distinct metric families. Include actual units, period, definitions and sources; sample numbers are not user data.
- **Avoid:** incompatible time ranges, unsupported growth claims, value labels separated from units, or oversized numbers that collide after a font change.

## Verification scope

The current ten source previews have browser-rendering coverage at 1280×720. The six added patterns also have a longer Chinese title/theme-change check, with image-node replacement exercised for `editorial-visual`. These checks do not establish all-language capacity, real-model selection behavior, complete client editing or native PPTX export fidelity. Verify those separately for the actual task.

Review all selected pages with real content and final assets, and distinguish source, visual, client and export checks in the task record. Missing global entries remain valid local reuse candidates. New structures are permitted; only promote them into this library after separate validation and an intentional library update.
