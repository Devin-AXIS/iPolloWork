# Prototype Web — visual rules and reusable layouts

## Visual rules
Read `design-tokens.css` and the entry's styling before composing. Its current semantic tokens own palette, display/body type, content width, page padding, section spacing and card/button treatment. Reuse the section containers, type hierarchy, rounded surfaces and restrained emphasis. Example utility colors, brand names, numbers and section order are not requirements; apply the user's current theme through tokens.

## Layout catalog
Each source selector refers to an existing section in `entry.html`. Reuse its complete HTML and dependent styles, replacing content and local media. Give repeated sections unique IDs and update navigation/CTA targets.

| Pattern | Source selector | Fits | Adaptation |
|---|---|---|---|
| Opening with product visual | `#top` | Core proposition with visual evidence | Adjust text/visual balance, CTA count and emphasis |
| Parallel features | `#features` | Peer capabilities | Change column count for real content; collapse at narrow widths |
| Sequence | `#how` | Steps or onboarding | Vary step count and direction while preserving reading order |
| Testimonial pair | `#voices` | Attributed customer evidence | Use only real quotes; omit when no evidence exists |
| Plan comparison | `#pricing` | Plans with comparable attributes | Normalize criteria; do not invent prices or pad missing plans |
| Focused action | `#cta` | One closing next step | Keep action and explanation concise |

## Extend when none fits
A detailed two-option comparison can combine the headings and surfaces of `#pricing` with a semantic table; enable narrow-screen scrolling without clipping the page. A case study can combine the visual/text treatment of `#top` with a compact evidence row derived from `#features`. These are new compositions to build from existing primitives, not existing sections. Preserve typography and spacing rhythm without importing an unrelated theme. Avoid a page made entirely of identical cards; do not add irrelevant testimonials or pricing merely because the seed contains them.

## Verify
Check meaningful heading order, actual links, unique IDs, keyboard focus, image proportions, contrast, and no horizontal page overflow on narrow and wide screens. Recompose dense content instead of shrinking body text. Strict-layout requests, fixed-brand regions and scoped edits take priority.

## Shared structural library
`core-v1-site/` is materialized from the app-owned global library alongside this guide. Read `catalog.md`, `layout.md` and `shared-contract.md`, then open only fitting layout files. Copy only the selected template fragment and scoped layout styles, and bind them to this template’s existing semantic tokens. The preview palette and preview host are not part of the layout. Prefer the best-fitting local or shared layout; do not use a library layout just to demonstrate variety.

Check headings at both desktop and narrow widths: use balanced wrapping on the heading itself, remove desktop-only forced breaks on mobile, and avoid a final line of one Chinese character plus punctuation. Text fitting inside its box is necessary but not sufficient for readable composition.
