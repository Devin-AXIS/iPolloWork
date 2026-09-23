<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# HyperFrames Video Rules

Use for `video`, including template application, custom generation and targeted edits. The active session's exact project, runtime, media actions and editor contract are authoritative. In the [shared guidelines](shared-guidelines.md), consult only sections 2–3 for scope/content, section 5 for layout selection, section 7 for media, and sections 9–10 for repair/acceptance. Read each relevant section once and do not load unrelated category guidance.

## Plan content and reuse

Read the brief, current `index.html`, template guide, tokens and existing assets. For initial/full generation, create a compact storyboard that gives every scene a purpose, visible content, narration intent, media need and approximate duration. If it is not already confirmed and the user did not explicitly request direct generation, present it once before submitting media or composing the full timeline; do not request the same confirmation again. Content determines scene count and timing; sample counts and durations are not quotas. An explicit user maximum remains strict. For targeted edits, preserve unrelated scenes, media and user changes.

Read `core-v1-index.md` and `core-v1-video/catalog.md` metadata once. Shortlist at most three scene bodies for the storyboard's relationships; open only their source and relevant layout guidance. Read `shared-contract.md` once before implementation, not once per scene. Reuse a fitting scene body or write a new composition in the active visual language when none fits. If references are absent in an older session, inspect actual local files instead of inventing paths or overwriting the user's project.

Video layouts describe spatial content slots, not complete compositions, timelines, narration or required scene duration. Never import PPT page roots or website responsive behavior into a video scene.

## Composition and timing

- Keep one authoritative root composition, its identity, declared stage dimensions and registered timeline. Use unique scene/clip IDs and supported editor hooks.
- Never delete or truncate the active `index.html` or `design-tokens.css` before its replacement is complete. Update in one operation, or prepare a sibling file and atomically rename it over the destination. A failed or interrupted edit must leave the last valid entry in place.
- When adding, removing, reordering or retiming scenes, synchronize the root duration, scene windows, clips, transitions, captions, audio and animation timestamps. Preserve these values for theme-only or unrelated edits.
- Use the session's FPS and quantize authored boundaries to integer frames. Serialize seconds with only the precision needed to represent `frame / fps`; do not accumulate independently rounded decimal durations. Sample reading time is planning input, never a replacement for measured audio.
- Drive movement through the existing paused, registered GSAP/HyperFrames timeline. Ensure direct seeking and replay are deterministic; no ambient CSS loops, wall-clock timers, random values or independently running timelines.
- Scope animation selectors to the actual scene instance. Fit entrance, readable hold and exit inside the scene window; transition overlaps must not obscure required information.
- Keep playback and audio sequencing framework-owned. Do not mute tracks or replace narration/music merely to avoid a preview problem.

## Visuals, assets and narration

The template owns typography, palette, graphic language and motion style. Apply theme tokens to scene styling; keep timing/tracks outside `design-tokens.css`. Compose for the declared stage and aspect ratio; change geometry intentionally for a different target, never through viewport-dependent reflow.

Follow shared asset/model rules and the active image/video generation Skills. Call `artifact_media_review phase=plan` once with the complete storyboard needs, reuse its capability result, and resolve one compatible model choice for each media operation. Reuse available files first. Submit independent assets as one bounded batch or in parallel when supported rather than serially blocking scene authoring. Save completed files under the current project's `assets/` and use project-relative paths. For asynchronous generation, query status/recovery before retrying; never duplicate a submission whose state is merely uncertain. Call `phase=check` once after placement outcomes settle.

Follow `ipollowork-video-voiceover` and the injected voiceover contract for enablement, authorized/default voices and validation. Preserve an explicit disabled choice. Without authorized narration, continue visual work and report its absence. Never treat a missing voice selection as no authorization or invent audio files. When narration exists, use actual returned duration and shift dependent timestamps; do not accelerate speech or omit facts to force sample timing.

## Editability and acceptance

- Keep `data-composition-variables` valid and statically parseable, with supported types and unique stable IDs matching the manifest. Serialize the JSON as literal JSON in a single-quoted HTML attribute; do not replace its quotes with HTML entities because static validation and Studio variable hydration must read the same declaration. Preserve fixed-brand assets and editor hooks.
- Check short/long titles, dense content, contrast, image crops and safe margins with actual fonts/assets. Recompose or split within user constraints instead of shrinking all text or clipping required content.
- Inspect scene starts, readable middle frames, ends and transition overlaps, including direct backward and forward seeks and replay. A moving clock alone does not prove animation.
- Verify referenced local scripts load, the expected GSAP timeline is registered, media decodes and intended audio is audible in the real player. Timeline clips or waveforms alone do not prove sound.
- Run the session's HyperFrames/project and voiceover validation once and inspect its structured result. Any validation error, `ok: false`, zero/incorrect duration, empty samples, invalid variable declaration or undecodable media is a failed delivery and must be repaired before reporting completion. Generate scene-midpoint coverage in one batch/contact sheet so every declared scene, including the final scene, has visible content and lies within total bounds. An empty midpoint is a must-fix defect unless the storyboard explicitly marks a purposeful blank. Inspect transition boundaries and full-size frames only for changed or programmatically flagged scenes. Apply one consolidated repair pass and one additional targeted pass only for remaining must-fix defects; never loop on optional polish.
- Verify theme changes preserve geometry/timing and editable controls still work. If export is requested, inspect the exported file's image, duration and audio separately.
- Report source checks, rendered frames, client playback, real-model generation and export as separate verification scopes. A static layout preview does not verify video playback or delivery.
