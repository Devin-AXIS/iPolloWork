# iPolloWork Video Motion Principles

Use these principles for initial video generation, template application, and substantial scene redesign. They define how meaning develops over time. Spatial layout references define where content can sit; they do not supply temporal storytelling.

## 1. Motion carries meaning

- Give every scene one narrative job and one primary visual change that expresses it.
- Choose motion from the content verb: reveal, compare, connect, accumulate, transform, navigate, focus, or conclude.
- Do not treat motion as decoration applied after a static page is complete.
- A scene may become still for reading or emphasis, but the stillness must follow a meaningful development and have an intentional duration.

## 2. Plan three observable states

For each scene, define three seek-safe states before implementation:

1. **Establish** — orient the viewer with the subject, context, or first evidence.
2. **Develop** — change focus, state, scale, relationship, path, or accumulated information in narration order.
3. **Land** — leave the viewer with the resolved claim, comparison, decision, or next action.

These are semantic states, not fixed percentages. Derive their timing from the narration, media, and explicit duration constraints. A short title or outro may use a simpler arc; a substantive scene must not finish all meaningful motion in its opening moment and remain unchanged for most of its duration.

## 3. Map narration into visual beats

For each substantive narrated scene, divide the narration at semantic changes rather than sentence punctuation. A beat is the smallest spoken unit that needs a new visual focus, action, or resolved state. Record a compact beat map before composition:

| Beat | Spoken intent | Time range | Visual focus | Visual action | Result or hold |
| --- | --- | --- | --- | --- | --- |
| 1 | What the viewer should understand first | Approximate range, then measured audio frames | Subject, context, or first evidence | Establish the scene | Readable starting state |
| 2…n-1 | Each distinct explanation, comparison, cause, or change | Measured audio frames | The item currently being discussed | Transfer focus, advance a path, accumulate evidence, explore media, or transform state | Preserve the context needed by the next beat |
| n | The conclusion or handoff | Measured audio frames plus intentional hold | Resolved claim, decision, or next action | Complete the selected pattern | Stable Land state |

- Keep one visual event per meaning change; do not create a new animation for every clause or breath.
- Merge adjacent spoken phrases when they share one visual subject and action. Split a beat when the viewer must look somewhere else or understand a changed relationship, value, place, or state.
- Use approximate timing only while planning. Once narration exists, replace it with boundaries derived from the returned audio, quantized to the project FPS, and retime dependent visuals, captions, and transitions together.
- Let the first beat establish, the middle beats develop, and the final beat land. This mapping may contain more than three beats; Establish, Develop, and Land remain the enclosing scene arc.
- A purposeful pause may hold the current state. It must not trigger an unrelated animation merely to fill time.
- For scenes without narration, derive the same map from on-screen reading order, music cues, media events, or the intended silent story. A simple title or outro may use one beat.

### Make the beat map executable

Store the final plan on every full `.scene.clip`, not only in prose. Mark it with `data-ipw-scene`, a stable `id`, `data-start`, `data-duration`, `data-track-index`, `data-motion-pattern`, `data-ipw-timing-source`, and literal JSON in `data-ipw-beats`. Beat times are seconds relative to the scene and must begin at zero, meet without unexplained gaps or overlaps, and end at the scene duration. Each beat records `start`, `end`, `intent`, `focus`, `action`, `result`, non-empty CSS `targets`, one executable `animation` reference, and a truthful scene-relative `motion: { start, end }` window for the period where the rendered state actually changes.

Use `component:<registry-id>` only for the interval covered by the installed component's native timeline. The install action's `motionContract` reports declared duration and authored targets; it does not invent establish, develop, or land timestamps. Measure those boundaries from the saved render. Use `preset:<preset-id>` only after calling `list_motion_presets` for the correct text or element target and `mutate_motion` with explicit `start` and `end`; preserve the returned `data-ipw-animation-reference` on the animated element. Use `custom:<specific timeline label>` only when no preset expresses the required motion. Use `hold:<reading|emphasis|handoff|outro|media>` for deliberate stillness of at most four seconds. Split a longer static interval at the nearest real narration or content boundary, never at a mathematical midpoint merely to satisfy validation. A long scene cannot claim that a shorter native component animation covers the remaining time: add a later meaningful preset/custom beat, split the scene, or shorten it. The client owns the aggregate component and delivery check after the turn and may request one bounded repair continuation.

Use `voiceover` when actual narration controls timing. Use `estimated-reading` when a narration script exists but voice synthesis is disabled, unauthorized, unavailable, or failed. Use `visual-cue`, `music`, or `media` when those events are the real timing source. Missing narration authorization never blocks video generation: disclose that the result is silent, keep composing, and do not leave a pending-model placeholder. If narration is added later, preserve scene meaning and component choices while retiming the beat map from measured audio.

## 4. Select a temporal story pattern

Choose one primary pattern per scene. Combine patterns only when the combination remains easy to follow.

The materialized `core-v1-video/motion/catalog.md` provides the current reusable recipes. Read its metadata once and open only the selected pattern file.

| Pattern | Use when | Required progression |
| --- | --- | --- |
| Progressive build | Parts form a process, model, or explanation | Add parts in meaning order, preserve useful context, then show the complete structure |
| Focus transfer | Several subjects need attention in turn | Move framing, emphasis, crop, or scale from one subject to the next |
| Path journey | Meaning follows a route, timeline, or dependency | Advance a visible marker or camera along the path and reveal consequences at each stop |
| State transformation | One object or system changes | Show a legible starting state, the cause or operation, and the resulting state |
| Data accumulation | Values support a conclusion | Build measures in comparison order and resolve with the takeaway, not a dashboard dump |
| Asset exploration | An image, interface, document, or clip carries the story | Let the asset lead; use crop, pan, zoom, annotation, or detail transitions to direct attention |
| Montage | Distinct shots or assets accumulate into one idea | Establish a motif, vary shots at meaningful boundaries, then slow down and resolve the shared meaning |
| Camera journey | The viewer must travel through a space, route, interface, or image | Establish orientation, visit meaningful waypoints, and decelerate into a motivated destination |
| Dialogue | Meaning develops through speakers, questions, responses, or perspectives | Identify participants, alternate timed turns, and land on the decision, contrast, or remaining tension |
| Kinetic type | Language itself carries the temporal story | Reveal readable phrases, transform emphasis at semantic stresses, and assemble the final statement |
| Audio reactive | Measured speech, music, or media events cause visual changes | Bind bounded visual accents to saved audio cues and resolve at the final phrase or cadence |

The table matches the eleven current reusable recipes and is a routing aid, not a whitelist. Treat before/after as a state-transformation variant. A registry component may support several narrative patterns; choose the pattern from the scene's verb, then use the component map's many-to-many capability overlays. Write a local treatment when no recipe preserves the intended meaning.

## 5. Choreograph attention

- Establish a clear focal subject, then move attention only when the narration or story advances.
- Use one dominant movement and at most a small number of supporting movements at a time.
- Reveal related elements as a coordinated unit; do not animate every label independently merely because it exists.
- Vary rhythm across scenes. Repeating the same fade-and-rise entrance for every title and card is not a motion system.
- Keep text readable while it is being discussed. Movement must not compete with comprehension.
- Prefer transforms, masks, crops, camera framing, path progress, and state changes that preserve spatial continuity.

## 6. Use media as a subject

- When imagery or footage materially improves understanding, emotion, realism, or identity, make it a focal narrative element rather than a small decorative slot.
- Reuse suitable project assets before generating more. Follow the shared media capability and authorization flow for missing assets.
- If media is unavailable or declined, continue with editable graphics, type, diagrams, and shapes, but give them meaningful temporal development.
- Never imply that a generated or decorative image is factual evidence.

## 7. Relate scenes through transitions

- Use continuity-preserving transitions when a thought continues.
- Use a distinct change when the topic, location, time, or argument changes.
- Reserve the strongest transition for a genuine reveal or climax.
- Let the final transition settle the composition; do not introduce a new visual idea during the outro.
- A transition connects two developed scenes. It cannot compensate for static scene interiors.

Full scene windows meet at one boundary without a gap or overlap. Run the transition at the start of the incoming scene so Video Studio, voiceover validation, direct seeking, and export share one timing model. Every scene after the first declares `data-ipw-transition-in`, `data-ipw-transition-duration`, and `data-ipw-transition-intent`. Use `cut` with duration `0`, or apply one supported incoming preset through `mutate_motion` and preserve its `data-ipw-animation-reference`. The incoming scene must already have a non-empty base state at its start; a transition never begins from an empty canvas.

## 8. Keep component timing parent-owned

- A registry component mounted as a scene uses the parent host's actual `data-start`, `data-duration`, and `data-track-index`.
- The installed component root must use `data-ipw-timing-owner="host"` and must not retain its own clip window. Its animation may complete earlier, but its Land state remains visible until the parent scene ends.
- Give every mounted host a unique `data-composition-id` and valid literal `data-variable-values`. Reinstall an older copied component whose inner root still carries `data-start`, `data-end`, `data-duration`, or `data-track-index`.
- Do not stretch entrance animation across a long narration. Map the component's native duration to its own beat, then add a later meaningful visual change or a short explicit hold. If more than two seconds remain after the native component finishes, a later preset/custom beat is required.

## 9. Preserve deterministic playback

- Drive all motion from the authoritative project timeline and declared scene windows.
- Define stable values before, during, and after each interval so direct seek, reverse seek, replay, and export show the same frame.
- Quantize authored boundaries to the session FPS and synchronize scene, media, narration, caption, and transition timing.
- Avoid wall-clock timers, uncontrolled CSS loops, random values, and animation state that depends on previously rendered frames.

## 10. Preserve structured editability

For diagrams, routes, processes, comparisons, and data explanations, keep meaningful nodes, labels, connectors, measures, and groups as stable editable elements. Reveal them in semantic order. Before delivery, repair overflow, duplicate labels, unreadable scale, and accidental overlap deterministically; do not flatten an editable explanation into one decorative image when native elements can express it.

## 11. Avoid animated-slide defaults

Treat these as repair signals unless the brief explicitly calls for a presentation-like video:

- A static title-and-card page where all movement is completed near the scene start.
- Long narration over an unchanged composition without a deliberate hold or media performance.
- Every scene using the same opacity, vertical offset, scale, and stagger recipe.
- Dense grids, dashboards, or bullet collections shown all at once.
- Decorative motion that does not change hierarchy, state, evidence, or viewer focus.
- Images confined to thumbnail slots while text and cards carry the whole scene.

## 12. Validate temporal storytelling

Record the narration beat map, selected pattern, and Establish, Develop, and Land states in the storyboard. Use `video-acceptance.md` for batch sampling, failure conditions and the bounded repair loop; this principles file does not define a second validation pass. Preserve purposeful pauses, calm pacing and final holds—motion quantity is not a quality score.

The goal is not constant movement. The goal is a visible sequence of meaning that can be understood at any seek position and still feels authored as video.
