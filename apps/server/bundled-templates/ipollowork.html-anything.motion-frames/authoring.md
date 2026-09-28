# Motion Frames — visual rules and reusable compositions

## Visual rules
Read `design-tokens.css` and `index.html`. Use the current display/body tokens and aliases, fine linework, grid texture, restrained accent, editorial labels and orbital graphic vocabulary. Reuse the `.chrome`, `.ring`, `.globe`, `.headline` and `.baseline` treatments. Sample wording, orbit count, positioning and eight-second duration are examples. Preserve the composition root, stage dimensions, editable variables and local assets.

## Existing composition and reusable primitives
This seed has ONE poster-like composition, not a prebuilt multi-scene layout library. The following selectors are real source blocks in `index.html`; reuse them together with their styles.

| Primitive | Source selector | Fits | Adaptation |
|---|---|---|---|
| Orbital hero | `.stage .composition` | One focal subject or concept | Vary focal position/scale and ring count; leave text clear space |
| Editorial headline | `.headline` | One conclusion or chapter title | Move/re-align within the stage; keep type hierarchy and legibility |
| Context labels | `.meta-tl`, `.issue` | Short context and sequence metadata | Replace or omit based on content; avoid dense paragraphs |
| Frame and baseline | `.chrome`, `.baseline` | Consistent scene framing | Reuse at stable safe margins; do not duplicate overlapping chrome |

## Derived layout recipes
These are recipes to IMPLEMENT, not claims that extra scenes already exist:
- Explanation: place the orbital hero in one column and a headline with short body copy in the other, using the existing type and line treatments.
- Comparison: create two labeled content zones with the fine-line vocabulary; reserve orbital decoration for one small accent so it does not compete with the comparison.
- Sequence: reuse label styling on stages arranged along a line, revealing stages in narration order; reduce decorative motion while information is being read.
- Chapter break: use one large headline and a restrained fragment of the orbit; omit unnecessary labels.

Create only compositions required by the story. Reuse stable scene framing but vary hierarchy with content. Build actual `.scene.clip` elements with unique IDs and synchronized start/duration values when expanding to multiple scenes. Follow the active HyperFrames contract for deterministic GSAP animation; source CSS loops are visual references, not permission to carry infinite wall-clock animation into export. Synchronize scene, narration, captions, transitions and root duration; never clone the root composition for each scene.

## Verify
Inspect representative frames and transitions for clipping, competing motion, readable narration-bound content and style continuity. Check the actual timeline bounds and editor variables. Strict-layout requests and scoped edits take priority; never accelerate narration or omit facts to match sample timing.

## Shared structural library
Read `core-v1-index.md`, then `core-v1-video/catalog.md`, `core-v1-video/motion/catalog.md`, `core-v1-video/layout.md`, `core-v1-video/motion-principles.md` and `core-v1-video/shared-contract.md` beside the brief. Read `core-v1-video/acceptance.md` once before final validation. The app-owned library supplies independent scene bodies, temporal story recipes, capacity guidance and static previews. Copy only the fitting spatial fragment and adapt one primary temporal recipe, then bind both to this template's existing semantic tokens and authoritative timeline. The preview palette and preview host are not part of the layout. Prefer the best-fitting local or shared references; do not use a library entry just to demonstrate variety.

Before delivery, confirm every referenced local script exists and loads in the actual preview. A moving player clock or visible clips alone does not prove animation: check `window.gsap`, the registered `window.__timelines.main`, and seek into an animated interval. Preserve the exact font tokens too; a new topic is not permission to substitute a display font.

Balance short description lines as well as headings: a short final line containing only one Chinese character plus punctuation is a fit failure. Prefer meaningful phrase boundaries; do not alter factual content to fit a scene.

Keep `data-composition-variables` parseable by the static validator as well as the browser: use a single-quoted attribute containing ordinary double-quoted JSON, not `&quot;`-encoded JSON. Validate the editable variable contract, not playback alone.
