# Brand Narrative — visual rules and reusable layouts

## Visual rules
Read `design-tokens.css` and the style block in `entry.html` first. Use the current semantic tokens for display/body type, light/dark surfaces, muted labels, accent and borders; do not restore sample colors after a user theme change. Retain editorial type contrast, generous margins, small metadata and restrained large geometric accents. The `brand-spread` stage and editable PPT markers are runtime constraints; the sample six-slide story is not.

## Asset decisions before layout
Follow the PPT Skill’s shared media workflow before committing to layouts: assess content and existing assets, query capabilities when required, then select or extend the structure and generate/place suitable supporting media within the established authorization and model policy. The template’s geometric accents are style references, not a ban on imagery. A text-only source does not justify skipping the required query. Visual and case areas may contain images, editable charts or shapes; use the matching PPT markers and verify actual placement.

## Layout catalog
These are existing source blocks, not extra output pages. Copy the full matching section and its dependent CSS from `entry.html`; replace example facts and branding. Reassign slide numbers and unique IDs when repeating. Keep visible text/shapes/images editable with supported `data-pptx-*` markers.

| Pattern | Source selector in entry.html | Fits | Adaptation |
|---|---|---|---|
| Statement with graphic | `[data-ipw-slide="1"]` / `.manifesto` | One thesis, opening, chapter break | Change text/graphic ratio and alignment; one clear message |
| Two-way comparison | `[data-ipw-slide="2"]` / `.tension` | Before/after, alternatives, tension | Preserve shared comparison criteria; vary column ratio for unequal detail |
| Editorial portrait | `[data-ipw-slide="3"]` / `.audience-collage` | Audience attributes or a case with a short takeaway | Adjust word count and hierarchy; do not use for dense numeric comparisons |
| Position map | `[data-ipw-slide="4"]` / `.positioning` | A proposition plus two-axis qualitative positioning | Use meaningful axes and supported evidence; do not invent measured coordinates |
| Parallel principles | `[data-ipw-slide="5"]` / `.voice-spectrum` | A small set of peer principles or capabilities | Vary columns to fit content; do not repeat this on every slide |
| Lead example with support | `[data-ipw-slide="6"]` / `.expression` | Case study, main outcome with supporting examples | Change primary/supporting area ratio and number of supporting blocks |

## Extend when none fits
For a process, derive a sequential composition from `.editorial-title`, `.book-meta` and the numbered text treatment of `.voice`: align stages on one path and connect them with editable shapes. For evidence, derive a large-number composition from `.manifesto` typography plus a restrained source line; use only supplied data. These are extension recipes, not prebuilt source selectors. Keep the same token vocabulary and stage; write new layout-specific CSS rather than overwriting all slides. Choose repetition when it aids comparison, not to fill a page quota.

## Verify
Inspect every used layout at full stage size and the deck overview: readable hierarchy, no overlap/clipping, valid editable markers, consistent margins, truthful data and intentional rhythm. Split or recompose long content within the user's page constraint; do not shrink all body text or drop facts. Strict-layout requests and scoped edits take priority.

## Shared structural library
`core-v1-slides/` is materialized from the app-owned global library alongside this guide. It supplies a catalog, shared contract and independent layout previews, separate from this template. Read `catalog.md` first, consult `layout.md` for the selected patterns, then open only their HTML and dependencies. Copy only the selected section and scoped layout styles, and bind them to this template’s existing semantic tokens. The preview palette and preview host are not part of the layout. Prefer the best-fitting local or shared layout; do not use a library layout just to demonstrate variety.

For Chinese headings, use `text-wrap: balance` on the actual heading element and inspect the resulting lines at the fixed stage size. A final line containing only one character plus punctuation is a fit failure even when the bounding box is inside the stage. Recompose heading width or shorten nonessential wording without dropping facts. Keep a visible gap between the heading and the first content block; compare all pages at the same stage size.

### Extracted shared patterns

The local source remains intact. Four structures are now available in `core-v1-slides/`:

| Local source | Shared layout | Choice |
| --- | --- | --- |
| `.manifesto` | `statement-visual.html` | One statement with a meaningful visual; fit long titles before placing body text |
| `.tension` | `comparison.html` | Reuse the existing equal-criteria comparison; do not create another global two-column variant |
| `.voice-spectrum` | `parallel-principles.html` | Two or three peer ideas, with columns chosen for actual text capacity |
| `.expression` | `lead-support.html` | A main case plus one or two supporting observations |

Read the selected fragment's capacity metadata before copying. Local layouts remain valid when they fit better. Keep current template tokens, replace all example content, and repair overflowing Chinese text by reallocating space or recomposing. Portraits and position maps remain local patterns, not new global entries. Browser verification and native export verification are separate; these entries do not assert native export fidelity.
