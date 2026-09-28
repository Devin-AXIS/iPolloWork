# iPolloWork Temporal Story Catalog · core-v1

Read the video type rules and `../motion-principles.md` first. This catalog routes a scene's narrative job to one temporal pattern. Use [component-map.md](component-map.md) to find registry implementations after choosing the narrative job, then open only the selected recipe and component source. Spatial layout and temporal storytelling are separate choices: pair a fitting scene body with one primary temporal pattern, or write a local treatment when none fits.

| File | Pattern | Narrative job | Preferred registry implementations | Verification |
| --- | --- | --- | --- | --- |
| `progressive-build.md` | progressive-build | Explain how parts form a process, model, or conclusion | `checklist-reveal`, `sequence-diagram`, `process-cycle` | Source recipe checked; project playback required |
| `focus-transfer.md` | focus-transfer | Discuss several subjects while preserving their relationship | `product-comparison-stage`, `split-screen` | Source recipe checked; project playback required |
| `path-journey.md` | path-journey | Follow a route, timeline, dependency, or journey | `milestone-timeline`, `us-map-flow`, `process-handoff-map` | Source recipe checked; project playback required |
| `state-transformation.md` | state-transformation | Show an object, system, or situation changing | `media-before-after`, `ui-3d-reveal`, `code-particle-assemble` | Source recipe checked; project playback required |
| `data-accumulation.md` | data-accumulation | Build evidence from values or measures | `bar-chart-race`, `waterfall-impact`, `chart-story` | Source recipe checked; project playback required |
| `asset-exploration.md` | asset-exploration | Explain an image, interface, document, or clip | `mobile-walkthrough`, `picture-in-picture`, `device-mockup` | Source recipe checked; project playback required |
| `montage.md` | montage | Compress several distinct moments, assets, or viewpoints into one cumulative idea | `device-carousel`, `picture-in-picture`, `instagram-carousel` | Source recipe checked; project playback required |
| `camera-journey.md` | camera-journey | Move through a space, route, interface, or image while preserving orientation | `mobile-walkthrough`, `screenshot-zoom`, `route-map` | Source recipe checked; project playback required |
| `dialogue.md` | dialogue | Alternate speakers, questions, responses, or perspectives over time | `speaker-intro`, `split-screen`, `comment-thread` | Source recipe checked; project playback required |
| `kinetic-type.md` | kinetic-type | Make spoken or written language itself carry the temporal story | `kinetic-keyword`, `narrative-hook`, `quote-pullout` | Source recipe checked; project playback required |
| `audio-reactive.md` | audio-reactive | Bind visual changes to measured speech, music, or media events | `oscilloscope-trace`, `x-space`, `instagram-reel` | Real audio-event binding and project playback required |

## Selection contract

1. Start from the scene's narrative verb, not from the most decorative effect.
2. Select one primary pattern. A supporting treatment may be added only when it does not create a second competing focal path.
3. Consult `component-map.md` and prefer a mapped Video Studio registry component when its structure and editability fit. Install selected IDs with `media/video_component_install`; reference the returned composition and adapt its variables, theme, and timing inside the active project. Never recreate a selected component from memory.
4. If the component fits spatially but lacks the required temporal development, extend its existing timeline with the selected recipe. Use the recipe alone only when no component fits.
5. Add the recipe's semantic `data-motion-role` attributes to actual scene elements; rename or reduce roles when the content is simpler.
6. Append motion to the project's existing paused authoritative timeline. Never create a second timeline, root composition, duration, or playback loop.
7. Convert all relative timing to the scene's real window, narration beats, and FPS-quantized boundaries.
8. Preserve the active template's visual language. The recipes specify temporal behavior, not colors, fonts, card styles, or fixed geometry.
9. Run `media/video_component_check`, then inspect Establish, Develop, and Land frames. A component is reused only when its installed source is referenced by the real project; a catalog mention or visual imitation does not count.

These eleven recipes are the reusable starting set, not a whitelist. A fitting registry component may appear in more than one narrative capability overlay; choose the scene's primary pattern from its actual narrative verb, then use the component map for spatial structure. Other patterns may be written locally and promoted only after repeated use and real playback validation.
