<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# HyperFrames Video Rules

Use for `video`, including template application, custom generation and targeted edits. Read the [shared guidelines](shared-guidelines.md) first. The active session's exact project, runtime, media actions and editor contract are authoritative.

## Plan content and reuse

Read the confirmed brief/storyboard, current `index.html`, template guide, tokens and existing assets. Respect already confirmed choices. Content determines scene count and timing; sample counts and durations are not quotas. An explicit user maximum remains strict. For targeted edits, preserve unrelated scenes, media and user changes.

Read `core-v1-index.md` beside `brief.json`, then `core-v1-video/catalog.md`, `layout.md` and `shared-contract.md`. Match content relationships and compare global with local compositions. Reuse fitting scene bodies or write a new composition in the active visual language. If references are absent in an older session, inspect actual local files instead of inventing paths or overwriting the user's project.

Video layouts describe spatial content slots, not complete compositions, timelines, narration or required scene duration. Never import PPT page roots or website responsive behavior into a video scene.

## Composition and timing

- Keep one authoritative root composition, its identity, declared stage dimensions and registered timeline. Use unique scene/clip IDs and supported editor hooks.
- When adding, removing, reordering or retiming scenes, synchronize the root duration, scene windows, clips, transitions, captions, audio and animation timestamps. Preserve these values for theme-only or unrelated edits.
- Use the session's FPS and frame-aligned timing rules; retain required numeric precision in serialized seconds. Sample reading time is planning input, never a replacement for measured audio.
- Drive movement through the existing paused, registered GSAP/HyperFrames timeline. Ensure direct seeking and replay are deterministic; no ambient CSS loops, wall-clock timers, random values or independently running timelines.
- Scope animation selectors to the actual scene instance. Fit entrance, readable hold and exit inside the scene window; transition overlaps must not obscure required information.
- Keep playback and audio sequencing framework-owned. Do not mute tracks or replace narration/music merely to avoid a preview problem.

## Visuals, assets and narration

The template owns typography, palette, graphic language and motion style. Apply theme tokens to scene styling; keep timing/tracks outside `design-tokens.css`. Compose for the declared stage and aspect ratio; change geometry intentionally for a different target, never through viewport-dependent reflow.

Follow shared asset/model rules and the active image/video generation Skills. Assess useful imagery with the storyboard; a catalog placeholder is not a reason to omit useful media. Reuse available files, query capabilities, resolve model choice within the authorized scope, and save new files under the current project's `assets/`. For asynchronous generation, resolve status/recovery before duplicate submission and use only saved valid media.

Follow `ipollowork-video-voiceover` and the injected voiceover contract for enablement, authorized/default voices and validation. Preserve an explicit disabled choice. Without authorized narration, continue visual work and report its absence. Never treat a missing voice selection as no authorization or invent audio files. When narration exists, use actual returned duration and shift dependent timestamps; do not accelerate speech or omit facts to force sample timing.

## Editability and acceptance

- Keep `data-composition-variables` valid and statically parseable, with supported types and unique stable IDs matching the manifest. Preserve fixed-brand assets and editor hooks.
- Check short/long titles, dense content, contrast, image crops and safe margins with actual fonts/assets. Recompose or split within user constraints instead of shrinking all text or clipping required content.
- Inspect scene starts, readable middle frames, ends and transition overlaps, including direct backward and forward seeks and replay. A moving clock alone does not prove animation.
- Verify referenced local scripts load, the expected GSAP timeline is registered, media decodes and intended audio is audible in the real player. Timeline clips or waveforms alone do not prove sound.
- Run the session's HyperFrames/project and voiceover validation. Check the final scene, total bounds and no unintended blank/silent intervals; intentional pauses must have a content purpose.
- Verify theme changes preserve geometry/timing and editable controls still work. If export is requested, inspect the exported file's image, duration and audio separately.
- Report source checks, rendered frames, client playback, real-model generation and export as separate verification scopes. A static layout preview does not verify video playback or delivery.
