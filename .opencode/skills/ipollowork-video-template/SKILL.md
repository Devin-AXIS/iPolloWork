---
name: ipollowork-video-template
description: Create, edit, import, or audit production-ready iPolloWork HTML video templates built with HyperFrames, HTML, CSS, and GSAP. Use for work inside a session-owned video project, for bundled video-template packages, or when turning a brief into reusable scenes, variables, components, assets, captions, audio, and a deterministic timeline. Do not use for changing the iPolloWork product code, auditing the template system itself, ordinary animated web pages, or non-video design templates.
---

# iPolloWork video templates

Build a video composition, not an animated webpage. Keep one HTML source of truth, a deterministic timeline, an explicit scene structure, reusable variables, local assets, and an importable template package.

## Start with the real project

1. Read the host task contract and use its exact session-owned project path.
2. Read `brief.json`, `index.html`, and `voiceover.json` when they exist.
3. When editing an imported template, read its manifest and checklist before changing it. Preserve the original composition instead of starting over.
4. Determine whether the request is:
   - a single motion frame;
   - a multi-scene video;
   - an edit to an existing session video;
   - a reusable template package for import.
5. Read [architecture.md](references/architecture.md) before creating or structurally changing a composition.

Never derive a second project path, create a parallel `videos/` directory, start another preview server, or replace the embedded Studio. Save the exact `index.html`; the Studio hot-reloads it.

## Plan before writing HTML

Write a compact plan containing:

- objective, audience, duration, aspect ratio, and narrative pattern;
- ordered scenes with `id`, purpose, start, duration, component, visible copy, and media;
- track allocation for background, media, scenes, overlays, captions, voiceover, music, and effects;
- global, scene, and component variables;
- selected visual style and motion intensity;
- locked fields that the edit must preserve.

For narrative and component selection, read [narrative-and-components.md](references/narrative-and-components.md). For a requested visual direction, read [style-recipes.md](references/style-recipes.md).

## Declare variables deliberately

Read [variables.md](references/variables.md) whenever variables are created, renamed, mapped, or audited.

- Treat the manifest V1 schema as authoritative. Do not add unsupported fields to its strict variable objects.
- Keep variable IDs stable after publication.
- Declare every public edit in both `manifest.json` and the root `data-composition-variables`.
- Bind public text with `data-var-text`, images with `data-var-src`, and visual tokens through CSS custom properties.
- Keep DOM IDs, GSAP selectors, track indices, layout offsets, and timeline bookkeeping internal.
- Do not declare a variable that has no real binding, and do not leave important user-facing copy hard-coded when it should be editable.

## Build the composition

- Use `index.html` as the playable source of truth.
- Give the root `data-composition-id`, `data-start`, `data-width`, `data-height`, and `data-duration`.
- Represent every timed layer as `.clip` with explicit `data-start`, `data-duration`, and `data-track-index`.
- Represent every full visual scene as `.scene.clip` with a unique stable `id`.
- Keep visual scene windows ordered and non-overlapping. Backgrounds, captions, and deliberate overlays may span scenes on their own tracks.
- Register a paused GSAP timeline at `window.__timelines[compositionId]`.
- Use absolute timeline positions tied to scene starts. After changing scene duration, shift later scenes, clips, narration, captions, transitions, and GSAP timestamps together.
- Keep all rendering deterministic. Avoid uncontrolled timers, random values without a seed, autoplay calls, and infinite CSS animation as the only source of required motion.
- Keep assets local to the template or session project. Do not depend on CDN scripts, remote fonts, expiring URLs, or private URLs.
- Provide a readable CSS/HTML fallback when optional WebGL or advanced media cannot load.

When narration is useful, follow the host voiceover contract exactly. Visible scene text, synthesized scene text, audio metadata, start time, and duration must remain synchronized.

## Protect published contracts

Unless the user explicitly requests a structural replacement, preserve:

- composition ID and root entry;
- scene IDs, scene order, and narrative role;
- variable IDs, types, groups, and bindings;
- required tracks and track semantics;
- component inputs and stable DOM hooks;
- GSAP selectors and timeline registration;
- media playback ownership and voiceover metadata;
- the template's visual identity and checklist.

Change values, media, brand tokens, verified data, optional scenes, transition choice, scene duration, and motion intensity when the request requires it.

## Validate and package

Read [quality-and-packaging.md](references/quality-and-packaging.md) before importing, exporting, or declaring completion.

For a reusable template package, run:

```text
node .opencode/skills/ipollowork-video-template/scripts/validate-video-template.mjs <template-directory>
```

For a session video, also run the exact HyperFrames check command provided by the host task contract from the exact session project directory. Do not run preview or launch another browser.

Do not report completion until:

- requested scenes and copy exist in the exact `index.html`;
- manifest variables match composition metadata and real bindings;
- scene windows do not overlap;
- root duration covers every scene, clip, caption, and narration;
- local assets resolve;
- the first, representative middle, and final frames are visually readable;
- the package validator and host HyperFrames check pass.

Report the chosen narrative pattern and style, changed variables and scenes, preserved contracts, validation commands, and any remaining limitation.
