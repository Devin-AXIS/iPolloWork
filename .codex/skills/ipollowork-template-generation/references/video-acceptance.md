# iPolloWork Video Acceptance

Use this acceptance contract for initial generation, template application, structural scene changes, and final delivery. Targeted text, theme, or timing edits run only the affected checks plus a core playback check. Validation is bounded: one aggregate source check, one batch temporal sample, one consolidated repair pass, and at most one targeted follow-up for remaining must-fix defects.

## 1. Source and timeline integrity

- One valid root composition owns stage dimensions, FPS, duration, tracks, and the registered paused timeline.
- Scene, clip, transition, caption, narration, media, and animation windows stay within root bounds and agree after retiming.
- Authored boundaries resolve to integer frames. Direct seek, reverse seek, replay, and export do not depend on prior playback.
- Editable variables, stable IDs, theme tokens, component bindings, and project-relative asset paths remain valid.
- Every full `.scene.clip` is marked `data-ipw-scene` and has a stable ID, frame-aligned timing, track, motion pattern, accepted timing source, and literal executable beat map. Beat ranges cover the scene continuously.
- Registry component hosts own timing through `data-ipw-timing-owner="host"`; installed component roots do not carry a competing clip window and remain visible in their Land state until the host ends.
- Required scripts and media load without console, decode, or missing-file errors.

Any invalid root, missing timeline, zero or inconsistent duration, out-of-bounds clip, broken variable declaration, or missing required asset fails delivery.

## 2. Content and visual integrity

- Every declared scene has purposeful visible content at its required reading state. Blank or placeholder scenes fail unless the approved storyboard explicitly calls for a blank beat. Brand marks, captions, narration transcripts, editor outlines, and persistent chrome do not count as the scene's primary visible content.
- Titles, body text, captions, data labels, and annotations fit with the actual fonts and final copy.
- Contrast, safe margins, crop, hierarchy, and focal subject remain clear at the declared stage and output aspect ratio.
- Generated imagery is never presented as factual evidence. Required attribution stays attached to evidence.
- A reused registry component preserves its supported editable variables, structured data, theme inheritance, and selection hooks.
- Every substantive scene is traceable: a reused component has an installed `data-composition-src`, unique `data-composition-id`, `data-ipw-registry-component`, real `data-variable-values`, and `data-motion-pattern`; a custom scene has `data-ipw-component-decision="custom:<specific structural reason>"` and a motion pattern.

## 3. Temporal storytelling

- Each substantive scene records one primary temporal pattern and observable Establish, Develop, and Land states.
- Each substantive narrated scene has a beat map whose spoken intents remain in source order and whose time ranges, visual focus, visual action, and result or hold, plus targets and an executable animation reference cover the narration without overlaps or unexplained gaps. Silent scenes use the same mapping against their reading order, music cues, or media events; simple titles and outros may use one beat.
- Once narration exists, beat boundaries use the measured audio and project FPS rather than sample reading estimates. The visual change for each beat occurs while its meaning is spoken, while intentional pauses hold the current state. When narration is unavailable, `estimated-reading`, `visual-cue`, `music`, or `media` timing remains valid and must still produce a complete visual sequence.
- Sample those three states in one batch. The samples must show the intended progression of meaning, focus, state, path, evidence, or media framing.
- Narration and visual development follow the same semantic order. Required information remains readable while discussed.
- A scene whose only change is a generic entrance, or whose meaningful motion finishes near the start and leaves most of the scene unintentionally unchanged, fails temporal acceptance.
- Repeating the same fade, rise, scale, and stagger recipe across scenes is a repair signal unless the brief explicitly requests a presentation-like treatment.
- Purposeful pauses, calm pacing, title cards, and final holds are valid. Constant motion is not required.
- Pattern-specific evidence must match the selected recipe: montage has multiple intentional shot states and a resolving motif; camera journeys preserve orientation through meaningful waypoints; dialogue exposes identifiable timed turns and responses; kinetic type remains readable at every semantic change; audio-reactive scenes bind reproducible visual events to measured audio cues. A compatible component name alone is not evidence.

## 4. Transitions and continuity

- Every scene after the first records a supported incoming transition, its duration, and its narrative intent. The transition is an actual applied preset with matching `data-ipw-animation-reference`, or a declared zero-duration cut.
- Transitions communicate continuation, topic change, time/location change, comparison, reveal, or closure and do not expose empty frames.
- The outgoing scene remains meaningful through its final frame; the incoming focal subject becomes clear as its transition completes.
- Sample the frame immediately before, during, and after every changed or flagged boundary. A scene-level fade that finishes before the transition begins is an empty-frame failure.
- Fixed chrome, captions, audio, and persistent identity elements do not jump, duplicate, or disappear unintentionally.

## 5. Media and audio

- Every planned media need has a final outcome: reused, generated, declined, unavailable, failed, or intentionally replaced by an editable visual.
- Visible media uses the intended file, crop, timing, and resolution. Video clips decode and play inside their declared windows.
- Enabled narration is audible, mapped to the correct scene, and measured from the actual returned audio. Captions and dependent timing follow it.
- Explicitly disabled or unavailable narration is reported honestly and does not block visual delivery. Timeline clips or waveforms alone do not prove sound.
- Music and effects do not mask speech or start outside project bounds.

## 6. Editor and playback experience

- Open the exact project in the built-in Video Studio. Scrub forward and backward through scene starts, Develop states, Land states, and incoming transition intervals.
- Play across at least one ordinary transition and every changed or flagged scene. A moving playhead alone does not prove a correct picture or audible output.
- Confirm component variables and supported edits still update the selected visual without replacing unrelated scenes or starting another preview server.
- Confirm stop, replay, reopen, and theme changes preserve the saved composition.

## 7. Export and delivery

- When export is requested, inspect the exported file separately for dimensions, duration, representative frames, media, and audible audio.
- Show result files only after the complete requested artifact passes its applicable checks. Intermediate generated assets remain process evidence rather than separate final results.
- Report source validation, temporal samples, client playback, real-model media generation, and export as separate scopes. Do not claim an unperformed scope.

## 8. Bounded evidence and verdict

The client runs `video_component_check` together with source, project, and voiceover checks as one aggregate batch after the model turn. For an explicit acceptance run, Render Establish, Develop, and Land samples for every substantive scene in one batch or contact sheet. Inspect full-size frames and transition boundaries only for changed or programmatically flagged scenes; do not launch per-scene servers or repeat the source checks.

- **Passed:** all applicable must-fix checks hold with observable evidence.
- **Partial:** the artifact is usable but an explicitly declined, unavailable, or failed optional capability is disclosed.
- **Failed:** any required scene is blank, selected registry component is not actually installed and referenced, a custom scene lacks a specific exception reason, timeline or media is invalid, temporal storytelling does not develop, required audio is inaudible, or requested export is unverified.

Apply one consolidated repair pass, then one targeted follow-up only for remaining must-fix defects. Stop optional polishing once the approved brief and acceptance contract hold.
