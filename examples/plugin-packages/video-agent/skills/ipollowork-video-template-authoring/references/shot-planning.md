# Shot planning for reusable HyperFrames templates

Use this reference to translate the user's content into a compact shot system. Choose patterns by narrative purpose, not because they appeared in the source template.

| Narrative purpose | Shot pattern | HyperFrames implementation |
| --- | --- | --- |
| Establish product or subject | Hero reveal | One clear focal layer, restrained camera drift, staged title reveal |
| Explain a workflow | Step sequence | Reusable step block with variable labels and deterministic stagger |
| Show an interface | Screen focus | Screen frame plus crop, pan, or scale keyed to the relevant region |
| Connect features | Spatial deck | Registry cards or panels arranged in depth with a seek-safe camera move |
| Compare choices | Split comparison | Stable two-column structure with synchronized evidence and labels |
| Prove a result | Metric hit | Large variable-driven number, contextual label, one emphasis beat |
| Demonstrate transformation | Before and after | Shared geometry, explicit transition point, no uncontrolled morph loop |
| Introduce a person or role | Profile moment | Replaceable portrait slot, name and role variables, quiet supporting motion |
| Build anticipation | Progressive reveal | Mask, crop, or layer sequence that preserves direct-seek correctness |
| Summarize a system | Connected map | Reusable nodes and edges with dependency order encoded in the timeline |
| Close with action | End card | Brand tokens, concise variable-driven CTA, stable final frame |

## Selection rules

- Start from the story beats and required duration; do not force every pattern into one template.
- Prefer existing registry blocks when they fit. Query first, then add only the minimum files.
- Make repeated content data-driven through declared template variables rather than duplicated markup.
- Use transforms, opacity, masks, and camera framing before introducing custom animation machinery.
- Give every scene a readable still frame so direct seeking and thumbnails remain useful.

## Layout families

Choose the layout family independently from the shot pattern. Do not use one family for the whole video.

| Layout family | Best use | Avoid |
| --- | --- | --- |
| Asymmetric editorial | Brand premise, quote, point of view | Centering every element on one axis |
| Media-led split | Product footage, before/after, interface proof | Two equal boxes with no focal priority |
| Full-bleed crop | Emotional or cinematic beat | Unframed stock imagery with text on top |
| Spatial deck | Connected capabilities or modular systems | Repeating equal cards as decoration |
| Typographic close | Chapter shift, decisive claim, CTA | Long paragraphs and multiple badges |
| Connected map | Workflow, collaboration, dependency | Unlabeled lines or arbitrary node clouds |
| Data-led field | Evidence, progress, comparison | Invented statistics or dashboard chrome |

Adjacent scenes should change at least two of: focal position, scale hierarchy, dominant geometry, media treatment, or reading direction.

## Motion grammar

Pick a small motion vocabulary for the template, then vary its intensity by scene:

- Editorial: masked line reveals, restrained vertical travel, deliberate cuts.
- Product: camera push, crop focus, shared-geometry handoff, precise cursor or region emphasis.
- Spatial: depth staging, parallax, orbit or rail movement with a stable focal layer.
- Data: count or line draw only when the underlying value is real and variable-driven.
- Human: slower image movement, quiet type reveal, longer holds, softer exits.

Every transition must communicate continuity, contrast, transformation, or closure. If it communicates none of these, use a clean cut.

## Rejection checklist

Revise before validation when any answer is yes:

- Do two adjacent scenes look like the same slide with different text?
- Is the primary visual a giant circle, generic gradient blob, or equal card grid with no story function?
- Are there fake numbers, placeholder claims, broken assets, or visible authoring instructions?
- Does the scene have only one flat plane with no depth or media treatment?
- Is all motion just fade-and-rise, or is the strongest effect repeated everywhere?
- Does direct seeking show a different state from linear playback?
- Does any scene require the viewer to read a web page rather than watch a video frame?

The planning method is informed by the Apache-2.0 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) recipe-card approach. This plugin uses the methodology only; it does not copy its Remotion runtime, code, previews, or assets.
