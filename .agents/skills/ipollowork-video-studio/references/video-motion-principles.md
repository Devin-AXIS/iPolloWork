<!-- Distribution reference: maintained in examples/plugin-packages/video-agent/skills/ipollowork-video-studio/references/; checked against the source by plugin-package-manifest.test.ts. -->

# iPolloWork Video Motion Principles

Read before initial generation or substantial motion redesign; small edits read only affected rules/schema. Storyboard owns source coverage, Compose owns implementation, and the active acceptance guide owns verdicts.

## Meaning, rhythm and attention

Choose energy from genre, audience and the content driver: a promo can build momentum; teaching needs dependency order and reading; dialogue follows responses; factual footage preserves context. Define observable Establish, Develop, and Land states: orient → visible cause/change → useful result. Plan 2–4 compatible actions for a substantial scene, with fewer for a simple title or deliberate hold; use one primary action with support, not a quota or fixed percentages.

Match actions to the subject: reveal/mask a fact, trace its connection, transform a state, accumulate comparable data, transfer focus or follow an actual journey. Read selected recipe implementation; metadata/effect names are not choreography. Make actions resolve promptly, then advance on the next content event. Tracking/opacity/tiny-scale easing is an accent, not a 6–8s substitute for development. Avoid repeated fade-rise-stagger, moving every label, decorative loops and stretched entrances. Important media leads the frame; labelled editable illustration remains valid when evidence is unavailable.

Use anticipation, acceleration/deceleration, contact and settling when the action needs them. A supported spring/overshoot expresses weight or response, not compulsory bounce. Focus transfers to the next relevant subject; sound accents use actual saved cues/tracks through Soundtrack rather than invented timings.

Fast moves may use a selected seek-safe blur/trail or defocus treatment when it clarifies motion. Clear it at landing and retain sharp reading states; global blur cannot replace motivated action. Reuse the current renderer and selected implementation.

Keep context readable while development proceeds; teaching, subtitles and a final result may hold still for a reason. Do not append the same three-second tail to every scene. Camera follows a meaningful subject/action to a visible destination, preserving screen direction, scale and shared anchors; it settles for reading. Use mapped camera recipes or supported 2D framing, never compulsory 3D or perpetual travel.

## Semantic beat map

Split when meaning/focus/action changes, not at every sentence/breath. Bind subject → action/cause → result → next focus to exact speech, reading, media or measured music events. Adjacent phrases may share an action; one sentence may span events. Purposeful pauses preserve the result.

| Beat | Spoken intent | Time range | Visual focus | Visual action | Result or hold |
| --- | --- | --- | --- | --- | --- |
| Establish | Orient | Draft, then measured frames | Subject/context | Reveal state | Readable start |
| Develop | Explain change | Measured event boundary | Subject/relationship | Advance/transform/focus | Next context |
| Land | Resolve/handoff | Measured boundary | Result/decision | Finish action | Useful result |

Estimate once; with speech replace it with boundaries derived from the returned audio, quantized to project FPS. Retime dependent visuals/captions/transitions together; never invent proportional word alignment. Silent work uses its genuine driver and preserves meaning/component choices if narration is later added.

## Executable beats

Every full `.scene.clip` keeps stable `id`, `data-ipw-scene`, frame-aligned `data-start`/`data-duration`/`data-track-index`, `data-motion-pattern`, `data-ipw-timing-source`, and literal JSON `data-ipw-beats`. Relative second ranges cover zero to scene end without gaps/overlaps. Beats contain `start`, `end`, `intent`, `focus`, `action`, `result`, non-empty CSS `targets`, executable `animation`, and truthful `motion: {start,end}`. Use Establish/Develop/Land for their corresponding states; free-form intent text still needs the same real development, hold and continuity review. Wording does not exempt an action from quality checks.

- `component:<registry-id>` covers installed native motion only. `motionContract` supplies declared duration/targets, not measured beat states. Host `data-ipw-timing-owner="host"` owns the window; inner roots have no competing clip timing. Keep unique composition IDs/literal variables and repair stale copies. Land remains visible to host end.
- `preset:<preset-id>` requires actual `list_motion_presets` for the text/element target and `mutate_motion` with explicit start/end; preserve returned `data-ipw-animation-reference` on the real element.
- `custom:<action-id>` is seek-safe motion unavailable through the selected component/preset, with a real matching DOM reference and executing GSAP tween `data`. For `animation: "custom:organize"`, DOM uses plain `data-ipw-animation-reference="organize"` and the actual tween vars use full `data: "custom:organize"`; targets and motion bounds describe that tween. Follow [Compose's executable example](video-compose.md#composition-and-timing) and custom recipe evidence/policy; a label alone does not execute the action.
- `hold:<reading|emphasis|handoff|outro|media>` declares purposeful stillness within the host's four-second bound, not a default tail target. Split longer stillness at genuine semantic boundaries. Native motion ends at its resolved event; a verified readable final result may hold within the same bound. Keep that hold explicit, never extend the motion declaration, stretch an entrance or add decorative filler to pass.

Timing source is `voiceover` for real speech, `estimated-reading` for unsynthesized narration, or genuine `visual-cue`/`music`/`media`. Missing speech allows disclosed silent/partial work. Use the existing media checks for source beats.

## Pattern selection

Choose the content verb's primary pattern. Read `core-v1-video/motion/catalog.md` once and selected recipe only; mapped overlays allow legible combinations, not a whitelist. Before/after is state transformation.

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

Carry outgoing result → next subject/action through a shared anchor, direction or truthful reset. Continuing action should not settle, disappear and repeat its entrance at each seam; a cut is valid and a continuous handoff need not make the whole film one take. Every later scene retains `data-ipw-transition-in`/duration/intent using cut/0, supported preset/reference or Compose's custom handoff. Full windows meet; incoming Establish starts non-empty. Preserve fixed captions/chrome; transitions cannot repair static interiors.

One paused timeline owns explicit integer-frame intervals and stable states for direct/reverse seek, replay/export; no timers, uncontrolled loops, randomness or history dependence. Scope selectors to scene instances; preserve tokens, host timing, editable nodes/labels/connectors/data/groups. Repair readability rather than flattening explanations.

Record choreography in the existing storyboard. Judge actual ordinary-speed action, Land and seams using existing media tools; pixel change or a moving playhead cannot certify rhythm or meaning.
