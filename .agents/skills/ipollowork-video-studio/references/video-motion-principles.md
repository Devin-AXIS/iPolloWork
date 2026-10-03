<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# iPolloWork Video Motion Principles

Read for initial generation or substantial scene redesign; targeted work reads only its affected pattern/schema. Spatial layouts place content; motion gives it a sequence of meaning. Production order, source coverage and assets live in the active Video Studio Skill's `video.md`; verdicts use its `video-acceptance.md` or the actual materialized library's acceptance guide.

## Meaning, rhythm and attention

Give each substantive scene one narrative job and a primary change from its content verb: reveal, compare, connect, accumulate, transform, navigate, focus or conclude. Define observable Establish, Develop, and Land states: orient → change understanding/focus/state/evidence → resolve the takeaway. They are semantic states, not fixed percentages. A title/outro may be simpler; calm pacing and deliberate reading holds remain valid.

Use one dominant motion with few supporting changes. Reveal related elements together, preserve readable context, and transfer attention only when the story advances. Transform/mask/crop/camera/path/state changes preserve spatial continuity. Avoid every label moving independently, identical fade-rise-stagger across scenes, dense dashboards revealed at once, decorative loops and entrances that leave a long explanation unchanged. Media should lead when it carries identity, evidence or emotion rather than remain a thumbnail; unavailable media can use meaningful editable graphics without pretending illustration is factual evidence.

## Semantic beat map

Split at changes in meaning/focus/action, not sentence punctuation or every breath. Adjacent phrases sharing one visual action may merge; one sentence may span several events. Narrated beats bind exact spoken intent; silent beats bind reading order, media events or measured music cues. First Establish, middle Develop, final Land enclose any number of necessary beats; purposeful pauses hold the state without unrelated animation.

| Beat | Spoken intent | Time range | Visual focus | Visual action | Result or hold |
| --- | --- | --- | --- | --- | --- |
| Establish | Orient the audience | Rough draft, then measured audio frames | Subject/context/evidence | Establish state | Readable starting point |
| Develop | Explain a distinct change | Actual measured boundary | Current subject/relationship | Transfer focus, advance, accumulate or transform | Context needed next |
| Land | Resolve/handoff | Measured boundary + deliberate hold | Conclusion/decision | Finish pattern | Stable useful final state |

Plan timing approximately; once audio exists replace it with boundaries derived from the returned audio, quantized to project FPS, and retime visuals/captions/transitions together. No fabricated proportional word alignment. Without narration use the genuine silent driver rather than leaving a pending model; later narration preserves meaning/component choices while retiming.

## Executable beats

Every full `.scene.clip` has `data-ipw-scene`, stable `id`, frame-aligned `data-start`, `data-duration`, `data-track-index`, `data-motion-pattern`, `data-ipw-timing-source`, and literal JSON `data-ipw-beats`. Scene-relative second ranges begin at zero, meet without gaps/overlaps and end at scene duration. Each beat contains `start`, `end`, `intent`, `focus`, `action`, `result`, non-empty CSS `targets`, one executable `animation`, and truthful `motion: {start,end}` for actual rendered change.

- `component:<registry-id>` covers only its installed native animation interval. `motionContract` supplies declared duration/targets, not invented Establish/Develop/Land timestamps; inspect those in the saved render. Parent host owns the actual clip window through `data-ipw-timing-owner="host"`; inner root carries no competing start/end/duration/track. Give hosts unique composition IDs/literal variables; reinstall stale copied roots with their own clip windows. Native motion may finish earlier while its Land remains visible until host end.
- `preset:<preset-id>` requires actual `list_motion_presets` for the text/element target and `mutate_motion` with explicit start/end; preserve returned `data-ipw-animation-reference` on the real element.
- `custom:<specific timeline label>` is a narrowly authored seek-safe treatment when no preset expresses the required motion, with an actual matching reference. Custom scene recipe exceptions still follow video.md; labels alone are not reuse.
- `hold:<reading|emphasis|handoff|outro|media>` declares purposeful stillness of at most four seconds. Split longer static intervals at genuine semantic boundaries, never arbitrary midpoints to satisfy validation. A short native animation cannot claim the remainder of a long scene: add a later meaningful preset/custom beat, split or shorten. If more than two seconds remain after native completion, a later active beat is required rather than stretching entrance motion.

Timing source is `voiceover` for actual speech, `estimated-reading` when a narration script has no usable synthesis, or `visual-cue`, `music`, `media` for genuine drivers. Missing speech does not stop visual work; disclose silent/partial scope. Source beat checks run in the client's aggregate delivery gate, never another model-owned validation loop.

## Pattern selection

Choose one primary pattern from the narrative verb; combine only when legible. Read current `core-v1-video/motion/catalog.md` metadata once and only the selected recipe. The component map's many-to-many overlays allow compatible secondary patterns; the routing table is not a whitelist and before/after is a state-transformation variant.

| Pattern | Required progression |
| --- | --- |
| Progressive build | Parts develop in meaning order into a process/model/complete structure. |
| Focus transfer | Framing/emphasis/crop/scale transfers among subjects in explanation order. |
| Path journey | A marker/camera advances through a route/dependency, showing consequences at stops. |
| State transformation | Starting state → cause/operation → legible resulting state. |
| Data accumulation | Comparable measures build toward a supported takeaway. |
| Asset exploration | Image/interface/document/clip leads through crop, pan, zoom, annotation or detail. |
| Montage | Intentional shots accumulate a motif and resolve its shared meaning. |
| Camera journey | Orientation → meaningful spatial waypoints → motivated decelerating destination. |
| Dialogue | Identifiable participants, timed question/response turns and decision/contrast/tension. |
| Kinetic type | Readable phrases transform semantic emphasis into a final statement. |
| Audio reactive | Measured saved audio cues cause bounded reproducible accents and final cadence. |

## Continuity, determinism and editing

Connect developed scenes with continuation or a clear topic/time/location change; strongest transitions serve a real reveal, and the outro settles rather than adds new ideas. Every later scene declares `data-ipw-transition-in`, `data-ipw-transition-duration`, `data-ipw-transition-intent`. Use cut/0, actual supported incoming preset/reference, or the custom handoff schema in video.md. Full windows meet without overlap; transition runs inside incoming Establish from a non-empty base state. Preserve outgoing final meaning, fixed captions/chrome and shared anchors; a transition cannot repair static interiors.

One registered paused project timeline owns motion, explicit intervals and integer-frame boundaries. Define stable before/during/after values for direct/reverse seek, replay and export; no timers, uncontrolled CSS loops, randomness or prior-frame state. Scope selectors to each actual scene. Preserve theme tokens, host timing and stable editable nodes/labels/connectors/measures/groups; repair overflow, duplicate labels and unreadable scale instead of flattening a native explanation into an image.

Record beat map/pattern/states in the existing storyboard and inspect action/Land/seams under the single acceptance batch. Motion quantity is not quality: every seek position should be understandable and ordinary-speed playback should develop meaning.
