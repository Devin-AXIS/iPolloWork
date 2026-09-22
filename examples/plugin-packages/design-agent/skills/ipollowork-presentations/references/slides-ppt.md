<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# Slides and Native PPT Rules

Applies to iPolloWork presentations and native editable PPT. Read the [shared guidelines](shared-guidelines.md) first. This reference adds PPT authoring and acceptance requirements; the selected mode, injected session contract and actual export capabilities remain implementation boundaries. For the ten reusable core-v1 structures, read the [layout guide](layout.md), then open only relevant source layouts.

Status: authoring guidance, not proof of automatic injection into every engine or automated enforcement of every check. Do not claim experience or export verification without performing the relevant rendering and export checks.

## 1. Determine task scope

| Task | Allowed changes | Preserve |
| --- | --- | --- |
| Initial generation | Determine count/order from content; reuse, repeat, combine, remove or extend template patterns | Explicit constraints, visual identity, fixed canvas, runtime and editable contracts |
| Narrative rewrite or full redesign | Reorder, add/remove or rebuild pages within the request | Valid facts, assets, user edits and style not authorized to change |
| Targeted edit | Edit specified pages/objects and adjust layout within those pages when necessary | Unrelated pages, content, order and objects; shared CSS must not affect them |
| Theme-only change | Update semantic tokens and check real rendering | Page count/order, content, assets, canvas, object positions and editable markers |

Initial generation does not inherit the template's sample count, narrative or brand data. If a theme change causes font overflow, first check font mappings and typography parameters. Explain any remaining conflict requiring object rearrangement rather than silently moving objects. Resolve exact-layout versus complete-content conflicts under the shared guidelines.

## 2. Read the brief and plan the narrative

- Read the current entry, confirmed requirements, existing pages, tokens, template guide and applicable layout index. Load only relevant candidates.
- Identify audience, purpose, language, setting, main conclusion, evidence and delivery format from existing materials. Proceed when sufficient; ask only about consequential gaps.
- Content and explicit user constraints determine page count. Speaking time can inform pacing, not a fixed minutes-per-slide quota. Examples and capacity hints are not hard page-count requirements.
- Plan each page's message, content relationship, evidence and asset purpose. Check reusable assets and gaps, query capabilities under the shared rules, then select or create a layout. This plan guides execution; do not require approval of internal IDs or an outline unless the user requests it.
- Give each slide one main reading task. Prefer headings that state a conclusion or question, supported by evidence. Use section pages when useful, not mandatory agenda, transition or thank-you pages merely to fill a formula.
- Separate facts, assumptions and missing information. Replace/remove example figures, logos and testimonials rather than presenting them as real user outcomes.

## 3. Select and extend layouts

Select structure by content relationship, then map it to the active visual language. The following are selection criteria, not a claim that every pattern is installed.

| Relationship | Consider | Check |
| --- | --- | --- |
| Statement, opening or chapter | A strong heading with one meaningful visual | Clear emphasis without decorative filler |
| Comparing options | Aligned columns or a comparison table | Common dimensions; adjust proportions for uneven content |
| Steps, development or stages | Process, timeline or phase structure | Clear order and connections, not unordered cards |
| Data or evidence | Key metrics, charts, tables and sources | Units, definitions, period, axes and conclusion agree |
| Case study or audience | Lead case with evidence, or suitable profile structure | A concrete subject, not generic copy with renamed people |
| Principles, capabilities or summary | Peer items or a hierarchy | Genuine peer relationships; do not flatten a hierarchy |

- Prefer suitable local or shared patterns. Read their real source and CSS dependencies rather than guessing from filenames.
- Copy only selected structural fragments and local styles, bound to current theme tokens. Omit preview hosts, scripts, default palettes and fonts.
- Replace content before adjusting columns, proportions, image/text areas and optional slots. If none fits, extend with the active typography, graphic and spacing language; do not replace the theme.
- Repeating a pattern is useful for comparable cases or data. Avoid mechanical repetition without a content reason, but do not force adjacent pages to differ.
- Maintain valid unique page/object identifiers and order, retaining recognized `data-ipw-slide` roots.
- Shared catalog, local source and new layouts are all valid sources. A local pattern absent from the global catalog is not a violation. Give new structures meaningful `data-layout` IDs and describe their relationship, slots and capacity in the page plan. Global registration or `data-layout-origin="extension"` is not a prerequisite. Do not automatically add a one-off layout to the global library or call it verified.
- Fixed-canvas extensions must not use viewport reflow or off-canvas clipping to conceal overflow. Adjust structure, remove empty slots or split pages. A negative local offset alone is not failure; inspect actual text/shape bounds and editable export behavior.

## 4. Capacity and Chinese typography

- Retain the supported fixed 16:9 canvas; do not add mobile stacking or breakpoint reflow. Check product support before adopting another requested ratio.
- Use coherent roles for headings, body, notes and sources. Choose sizes, leading and whitespace for the template and viewing scale, not chat typography or a generic website scale.
- For dense content, tighten nonessential wording, adjust space or choose another structure; split if page constraints permit. Do not shrink all text, compress leading, clip content or omit essential facts to force a fit.
- Inspect long Chinese titles for semantic breaks, glyph collisions, orphans and distance from body text. `text-wrap: balance` is only an aid. Check font fallback, values/units and long Latin words in mixed text.
- Charts must be readable at presentation scale, with visible sources and necessary notes. Do not encode important distinctions with color alone.
- Review reading order among title, body, image and source, and consistency of margins/density across pages. No overflow does not imply good layout.

### Capacity planning and overflow handling

For each selected pattern, identify the content relationship, real source, title/body areas, available line capacity with the current font, image ratio, allowed variants and overflow response. Use an existing catalog entry when available; otherwise measure the source and record findings in the current page plan. Do not invent verified limits or create a separate library for one generation task.

Capacity depends on actual font, size, leading and space, not a universal Chinese-character count. Trial the longest title and densest page first. If a narrow-column title exceeds its planned lines, reallocate space or change structure; do not leave body text at a fixed start that collides with it. With no existing typography specification, a 1280×720 trial baseline is 40–56px headings, 24–30px body and supporting text at least 18px; scale proportionally for other canvases. These are starting points requiring visual review, not overrides of user/template standards or permission to shrink long copy.

Existing Brand Narrative patterns provide these planning starting points, not multilingual hard limits:

| Source | Suitable content and slots | Capacity response |
| --- | --- | --- |
| `.manifesto` | One statement, support paragraph and visual | Trial 2–3 title lines; widen or stack regions before support text collides |
| `.tension` | Two sides compared on common dimensions | Short heading/evidence per side; adjust proportions, use a table or split for multiple dimensions |
| `.audience-collage` | A few audience/person keywords and explanations | Scattered keywords cannot hold long narratives; use ordered image/text regions for longer descriptions |
| `.positioning` | Two justified dimensions and positions | Short readable axis labels with separate explanation; do not force literary narrative into a positioning map |
| `.voice-spectrum` | Peer principles and brief explanations | Check each real column width; reduce columns or split rather than shrinking all text |
| `.expression` | Lead case and supporting content | Clear primary/secondary slots; review real image crops; move excess evidence to another page |

Custom work uses the same capacity rules. Establish a coherent visual language before selecting structures; extend when none fits. Custom does not mean designing every page arbitrarily from scratch, and shared preview colors/fonts do not replace the chosen theme.

### Contrast and line-break review

- Check actual backgrounds behind text, including photos, gradients, color edges and overlays. Target at least 4.5:1 for normal text and 3:1 for large text. Large means at least 24px regular or about 19px bold at actual display scale, not a magnified screenshot. Check the least favorable image region; move text or add a theme-consistent stable backing when needed. Comparing token values alone is insufficient.
- Break Chinese headings semantically and avoid body endings with only 1–2 characters or punctuation. Adjust text width, remove unsuitable hard breaks or change layout before tightening wording without losing meaning/facts. Preserve verbatim copy when requested. Do not shrink the whole slide to eliminate orphans.
- Title, body and notes need distinct regions that fit their real content. Inspect rendered line boxes and following regions; overflowing fixed-height titles must not cover body text. Deliberate layering is acceptable, unreadable text is not.

## 5. Theme and assets

Native editable PPT can contain `data-pptx-image` objects. Editability covers supported properties such as position and size; every image pixel need not become a vector object. Do not omit appropriate imagery to guarantee editability. If multiple suitable models require a choice, ask once before committing any image-dependent page; continue independent layout work only with the asset marked pending, and never silently use `defaultModel` or downgrade to shapes merely to avoid the question.

- Retain a selected template's visual identity unless restyling is explicitly requested; a changed audience alone is not authorization.
- Use current semantic tokens and preserve the `design-tokens.css` contract. Do not restore sample colors, add inline theme overrides or import another global theme.
- Follow the shared asset-selection, authorization, model-choice, cost and failure rules. Do not require a model selection for every routine generation call.
- Apply the shared visual-purpose decisions during page planning; no separate per-slide assessment report is required. Proactively supplement imagery that improves understanding or atmosphere, reuse adequate assets, and keep data/process/architecture diagrams editable. Pure decoration does not require generation. No fixed image quota applies; generated illustrations cannot replace real evidence.
- Visual slots can contain images, editable charts or shapes. Sample geometry is not a fixed asset requirement. Use `data-pptx-image` when replacing a slot with an image and adjust its container/crop. Missing image slots or editable-output goals do not cancel a legitimate asset need.
- Check resolution, crop, proportion and image/text relationships. HTML playback does not establish media support in the requested PPT format; verify actual export support before embedding.
- Save files/assets in the current `design/<session-id>/` and reuse existing asset directories; do not create a parallel project.

## 6. Editing, playback, notes and motion by mode

### Native Editable PPT

- Preserve supported `data-pptx-text`, `data-pptx-shape` and `data-pptx-image` markers on objects that need editable export, following the injected visible-object coverage contract.
- Give each element one PPTX object type. A text card uses a shape container and separate marked text children, not shape/text markers on the same node. Check exported text per page; object counts alone do not prove completeness.
- Use explicit supported shape nodes for meaningful decoration, not unmarked pseudo-elements. Browser visibility does not prove PPTX inclusion.
- Keep object geometry simple and measurable. Do not assume lossless export of complex DOM/CSS, or flatten editable text/shapes/pages into screenshots.
- The Design panel owns navigation. Do not add scripts, keyboard handlers, page controls, navigation buttons or speaker-note nodes, and do not transplant OpenDesign's runtime.
- Do not add animation frameworks or promise PPTX animation retention by default. Verify support for requested effects, explaining unsupported cases and feasible alternatives.
- Use actual supported notes functionality. If notes cannot be embedded, provide a separate script when requested and state that it is not inside the PPTX.

### HTML Presentation

- Retain the template's supported fixed canvas, keyboard navigation, controls and notes contract; do not add a second runtime.
- Add speaker notes only when supported and needed. Keep presenter guidance separate from audience-visible content.
- Use existing motion to explain sequence/emphasis, usually with one clear focus per page; do not animate everything mechanically. Verify navigation, replay and screenshots do not leave content invisible.
- Working HTML playback is not verified editable PPTX export. Identify the actual delivered format.

## 7. Generation and acceptance loop

Follow read → asset assessment and required capability queries → page planning and layout selection/extension → asset generation, saving and placement → inspect/repair → deliver.

1. **Content:** compare the page plan with user materials; verify narrative, facts, units, sources and essential conditions. Replace sample content and list required gaps.
2. **Structure:** use existing validators for fixed canvas, slide roots, identifiers, resource references and marker coverage. Template-package acceptance follows the shared contract separately and does not replace artifact-experience checks. Distinguish shared reuse, local reuse and extensions instead of enforcing a global ID whitelist. Positioning/overflow checks identify candidates; actual clipping, obstruction, canvas violations or lost editability justify repairs.
   **Assets:** verify decisions, actual required queries, generated/reused results and actual references. Replacing absent source photos with geometry without required queries leaves the media workflow incomplete. Prefer editable data/process diagrams; do not accept or reject by image count.
3. **Deck overview:** inspect all thumbnails for visual consistency, density and narrative rhythm. Repeated patterns need a content reason.
4. **Every-slide rendering:** wait for fonts/assets and inspect every page at target size, not just the cover or a sample. Focus on long Chinese titles, dense pages, charts and new layouts for overlap, overflow, orphans, crop and contrast. Preview-only page switching must not alter the output runtime contract. Standalone HTML captures do not replace client navigation checks.
5. **Client experience:** actually navigate the appropriate editor and exercise affected capabilities. For native PPT, verify representative text, shape and image edits; for HTML, verify navigation and affected notes/motion.
6. **Requested export:** use the supported product path and inspect actual PPTX/PDF/image files when requested. PPTX needs both visual and editability checks; markers, filenames or HTML captures alone prove neither. Export entry points must be discoverable and callable. If no model-callable client export exists, preserve editable source and direct the user accurately to client export. Do not blindly scan/install tools or reconstruct approximate layouts as a substitute for native export. Use standalone PPTX generation only when explicitly requested and verify it separately.
7. **Repair and recheck:** follow the shared executable repair loop. Locate issues per page, repair locally and capture again using the latest files. Fix obscured/unreadable content before orphans, spacing and rhythm. Recheck every page affected by shared-style changes; do not repeatedly regenerate the whole deck without cause.

If client, rendering or export access is missing, preserve artifacts and distinguish checked, unverified and unfinished work. Source checks are not real-experience verification. Essential missing content, broken resources, obstruction or lost required editability are must-fix issues under the shared rules.

Deliver the current entry, actual completed exports and a short explanation. Never list unperformed exports as results. Nontechnical users do not need internal layout IDs, object markers or complete validation logs.

## References and maintenance

OpenDesign's [PPT authoring workflow](https://github.com/nexu-io/open-design/blob/main/design-templates/html-ppt/references/authoring-guide.md) and [PPT Skill](https://github.com/nexu-io/open-design/blob/main/design-templates/html-ppt/SKILL.md) informed requirements gathering, theme/layout separation, page-level authoring and browser review. These rules are rewritten for iPolloWork's native editing, theme and export constraints; they do not copy template code or runtime.

Maintain cross-type principles in the shared contract and PPT-specific rules here. The [layout guide](layout.md) describes reusable core-v1 structures; template-local patterns belong in `authoring.md`. OpenDesign's mandatory adjacent-layout changes, fixed speaking/page-count suggestions, presentation runtime and decorative animation requirements are not iPolloWork defaults. Automatic injection and real-model execution require separate verification; updated documents alone do not prove every engine follows them.
