---
name: ipollowork-video-template-authoring
description: Create, repair, validate, or package a reusable iPollo Video template in an active HyperFrames template-authoring session. Use for video template structure, editable variables, reusable scenes, GSAP motion, component reuse, cover metadata, and save-ready validation; do not use for ordinary one-off video edits.
---

# iPolloWork Video Template Authoring

Build a brand-ready motion system, not a decorated slideshow and not a copy of the source template. Work only in the active iPolloWork Video template-authoring session.

## Required entry

- Read and follow the installed `hyperframes-core`, `hyperframes-creative`, and `hyperframes-animation` Skills before editing. Use `hyperframes-keyframes`, `hyperframes-registry`, `media-use`, and `hyperframes-cli` when their scope applies.
- Do not continue with a generic HTML fallback if these Video plugin capabilities are unavailable. Tell the user that iPollo Video must be installed or enabled.
- Set a concrete direction before implementation: audience, story promise, palette, type system, signature motif, layout families, and motion grammar.

## Boundaries

- Treat the injected session contract, exact `video/<session-id>/` project, manifest, entry path, and validation report as authoritative.
- Keep every change inside that session project. Do not create a second project, start another server, install a global Skill, or modify another session.
- Use HyperFrames as the runtime. Do not import Remotion or another video runtime into the project.
- Preserve the installed template's useful visual language, components, tokens, and motion grammar, but replace its sample story, copy, media, scene count, and timing whenever the user's content requires it.
- Never retain instructions, placeholders, fake testimonials, invented metrics, broken media, or unrelated sample claims in a saved template. Defaults must be credible demonstration content or neutral editable values.

## Visual quality contract

Every substantial scene must work as a strong still frame before animation is added:

- Use an intentional foreground, content plane, and background treatment. Give the eye one primary focal point and at most one supporting focal point.
- Fill the 16:9 or 9:16 frame at video scale. Avoid small web-card UI floating in empty space.
- Give adjacent scenes different layout families: for example asymmetric editorial, media-led split, full-bleed crop, spatial deck, connected map, or typographic close. Never repeat the same centered title, giant circle, or equal three-card grid in consecutive scenes.
- Use typography as composition. Prefer clear scale contrast, controlled line length, and optical alignment over many labels or pills.
- Avoid generic AI styling: default purple-cyan gradients, gratuitous glow, glass cards everywhere, oversized circles behind centered text, and decorative grids with no narrative purpose.
- Treat all media deliberately with crop, depth, mask, framing, pan, or zoom. Do not drop a raw image into a flat rectangle. Use a local replaceable media slot whenever the story needs real imagery.
- Keep color roles sparse: one dominant field, one text system, one accent, and optional semantic colors. Decorative effects may support hierarchy but must not become the hierarchy.

## Motion quality contract

- Build exactly one `gsap.timeline({ paused: true })` for the composition and register it in `window.__timelines[compositionId]`.
- Choreograph each scene in three phases: establish during roughly the first 30%, breathe or demonstrate during the middle 40%, and resolve or hand off during the final 30%.
- Use two to four motivated motion patterns per scene. Vary direction, distance, duration, and easing according to meaning; entrances are normally longer than exits.
- Prefer semantic transitions: cut for contrast, crossfade for continuity, dissolve for mood, and masks or shared geometry for transformation. Do not apply the same transition to every scene.
- Use `fromTo` for clip-local state so direct seeking is stable. Put every ambient drift, counter, line draw, and emphasis beat on the paused timeline. Never use infinite CSS animation, clocks, timers, random values, or unregistered `gsap.to` calls.
- Do not run competing transform tweens on one element. Split camera, entrance, and emphasis motion across parent and child layers.
- Reserve the strongest motion for the story's strongest beat. Constant movement is visual noise, not polish.

## Reusable template contract

- Expose variables for content that the next user is expected to replace: headlines, labels, media paths, brand colors, numbers, calls to action, and repeated items.
- Keep structure, timing, transitions, and visual grammar reusable. Do not turn the sample template's exact scene order or copy into the contract.
- Design variable defaults as a coherent preview. Avoid strings such as “replace this text”, “your logo”, or arbitrary fake performance numbers.
- Keep local assets and resilient fallbacks. A missing optional image must not reveal broken-image UI or alt text in the frame.

## Workflow

1. Read the current manifest, entry file, `design-tokens.css`, declared variables, existing scenes, and validation report.
2. Resolve one unanswered decision at a time: purpose and audience, reusable content structure, editable variables, visual direction, then type-specific constraints. Skip decisions already supplied.
3. Define a content-led shot plan. For a new or substantially restructured template, read [shot-planning.md](references/shot-planning.md). Assign a different layout family and motion purpose to every adjacent story beat.
4. Design the template contract before polishing:
   - stable scene and editor hooks;
   - deterministic duration, tracks, clips, and transitions;
   - useful content variables with defaults;
   - local, replaceable media slots;
   - a coherent token-driven visual system.
5. Reuse the Video plugin's existing capabilities instead of duplicating them:
   - `hyperframes-creative` for narrative, pacing, typography, and composition;
   - `hyperframes-registry` to query and add approved blocks or components;
   - `hyperframes-animation` for motion rules and transition choreography;
   - `hyperframes-keyframes` for seek-safe GSAP timelines;
   - `media-use` for media resolution or generation;
   - `hyperframes-cli` for inspection, validation, preview, and snapshots.
6. Implement the visual quality contract first, then the motion quality contract. A weak still frame cannot be rescued with effects.
7. Keep `manifest.json`, cover metadata, design tokens, variables, defaults, and the apply checklist synchronized with structural edits.
8. Inspect at least three frames per scene: after establishment, during the main demonstration, and at resolution. Check for collisions, empty framing, repeated composition, broken media, unreadable type, and discontinuities.
9. Run the active session's HyperFrames check and server template validation against the exact project. Re-instantiate the saved package before claiming it is reusable.

## Completion gate

Reject the result and revise it if any adjacent scenes share the same composition, any frame looks like a generic slide deck, any effect lacks narrative purpose, or any placeholder/fake/broken content is visible.

Report completion only when the composition seeks correctly, all media resolves, every declared variable is wired, the package validates, inspected frames are visually distinct and polished, and a fresh instance preserves the template contract without retaining the authoring sample content.
