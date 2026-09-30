<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

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

- Every scene after the first records an incoming transition, its duration, and its narrative intent. The transition is an actual applied preset with matching `data-ipw-animation-reference`, a declared zero-duration cut, or a seek-safe authored `custom:<id>` with a matching animation reference, incoming beat, and `data-ipw-transition-handoff` evidence. These source markers are not proof that the authored animation executed.
- Transitions communicate continuation, topic change, time/location change, comparison, reveal, or closure and do not expose empty frames.
- The outgoing scene remains meaningful through its final frame; the incoming focal subject becomes clear as its transition completes.
- Sample the frame immediately before, during, and after every changed or flagged boundary, including every authored transition. Confirm the shared subject or intentional reset is recognizable and the incoming state does not restart a continuing process. A scene-level fade that finishes before the transition begins is an empty-frame failure.
- Fixed chrome, captions, audio, and persistent identity elements do not jump, duplicate, or disappear unintentionally.

## 5. Media and audio

- Every planned media need has a final outcome: reused, generated, declined, unavailable, failed, or intentionally replaced by an editable visual.
- The saved storyboard matches the delivered scene order, narration, asset decisions and timing; generation is not a substitute for a missing script or shot purpose.
- Visible media uses the intended file, crop, timing, and resolution. Video clips decode and play inside their declared windows.
- Enabled narration is audible, mapped to the correct scene, and measured from the actual returned audio. Captions and dependent timing follow it.
- Explicitly disabled or unavailable narration is reported honestly and does not block visual delivery. Timeline clips or waveforms alone do not prove sound.
- Music and effects do not mask speech or start outside project bounds.
- A finished video's saved script contains an explicit music direction or deliberate `music_prompt: none`. Selected music is recorded in `music_asset` and matches the real mounted track; absent, stale or conflicting script/audio choices fail delivery. A missing source remains partial delivery, not a reason to silently mark music unnecessary.
- Track choice has a source/license and a content-fit rationale, not just a successful download. A corrected subject is reflected in the actual narration and rendered content, not only in replacement imagery.
- Requested BGM and SFX have separate real local timeline clips (`data-timeline-role="music"` / `"sfx"`), valid source/trim windows and audible levels. Muted, missing, wrong-path or out-of-bounds clips do not satisfy delivery. Effects coincide with their planned visual events; music does not acquire invented beat cues.
- Source validation checks references and declared timing, not waveform content, licensing, perceived mix quality or device output. Audition narration, music and effects together and verify the rendered mix separately when export is requested.

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

## 9. Shotcraft provenance and production evidence

- A Shotcraft selection records card, variant, pinned rule/source reference and actual installed componentId. Reference-only entries, placeholder conversions and a card-name label do not satisfy executable reuse. Inspect the real mounted source and final content/capacity; under recipes-only policy, custom graphics fail instead of filling a library gap silently.
- Check the final frames against the approved storyboard, selected variant and representative styleframes (or the recorded skip), without assuming the implementation is correct. A preview HTTP success is not proof of having watched it. Preserve critical motion grammar and timing; do not claim pixel parity without a comparison.
- For real-page spatial shots, verify full texture/cutout/backplate dimensions, capture coordinate metadata and the actual landing slot. Reject floating endpoints, detached annotations and blurry closeups; do not substitute hand-drawn interfaces for supplied evidence.
- Validate the action/landing states and boundary samples with scene-relative times or frame numbers. Reconcile audible cues after visual retiming, not just metadata. Missing frame, audition or export evidence remains unverified; guidance completion alone cannot mark the film Passed.

Apply one consolidated repair pass, then one targeted follow-up only for remaining must-fix defects. Stop optional polishing once the approved brief and acceptance contract hold.

## 10. Recipe fit review

Use this review for all selected native and imported recipes, not only Shotcraft ports. Review from the approved source/storyboard, selection notes, final mounted implementation and actual frame/audio evidence; construction success is not a visual verdict. If an independent-review capability is available and authorized, provide these raw artifacts and the selected card/source/preview, without the maker's preferred verdict or debugging justification. Otherwise make an artifact-first review pass and disclose that no independent reviewer was used; do not invent a subagent or start another preview service.

- Content: does the shot visibly explain its recorded takeaway with the correct facts, units and qualifiers? A compatible title or three decorative cards does not prove a causal mechanism or direct comparison.
- Selection: are useWhen/avoidWhen, inputs, capacity, reading order and explicit usage limits respected in the delivered shot? Reconcile card, variant, source and mounted component; surface conflicting references rather than choosing silently. Under recipes-only policy, report gaps instead of substituting custom graphics.
- Motion: compare the actual action and landing states with the declared visual change and accessible reference. Preserve key easing, timing ratios, sharp focal content and useful final hold; a metadata label or moving wrapper is insufficient.
- Sequence: check the chosen sequence against the audience task and approved source, not a universal trailer rhythm. Each required slot adds information or a purposeful reading rest, uses a fitting executable recipe and lands a clear result. Optional slots may merge or disappear; missing required coverage may not. A sequence name does not validate its contents.
- Handoff: inspect each changed or flagged outgoing Land, boundary and incoming Establish as one pair. Check that the intended continuation, comparison or topic change is understandable and shared labels, scale or direction stay consistent where supported. Reject unsupported morph/camera claims, repeated unnecessary entrances, duplicate title cards and transitions covering unread facts. A clean direct cut can pass.
- Budget: reconcile actual speech/reading time, recipe motion and minimum holds with the integer-frame shot windows. Incoming transitions consume the incoming Establish window, not added or overlapping scene time. Check the full sequence at ordinary speed for evidence that can actually be read, purposeful rests and selective emphasis; do not claim audible pauses from visual holds or inspect only isolated stills.
- Timing: verify that the corresponding visual event appears while its meaning is spoken, and that captions and sound remain readable/audible after retiming. Missing alignment or audition evidence is unverified, not exact synchronization.

For each failed or unverified claim, record scene ID, scene-relative time/frame, observed issue or missing evidence, and remedy in existing acceptance outputs/frame notes. A poor narrative fit requires reselection or a semantic split; a correct recipe with faulty implementation requires repairing that implementation. Missing reference playback cannot substantiate motion fidelity. Return must-fix, optional and unverified items separately within the existing bounded review, without claiming an automatic semantic validator.

## 11. Artifact-first final review

Use the current host render receipt, not a second render service. Reviewed receipts retain `pixelReview.evidence.videoPath` and frame paths with scene IDs and absolute frame numbers. Samples include declared event anchors, a representative action state, final landing and transition boundaries. `resolution: draft` means reduced-size evidence: it cannot certify export text sharpness. For requested exports, inspect native-size frames; enlarge text/texture regions for dense or spatial shots. Missing intermediate peak/hold evidence needs a targeted sample, not a claim that a few stills prove smooth motion.

Review at ordinary speed as well as by frame. Check each required takeaway against the approved script, actual recipe/variant and mounted content. A visible wrapper movement is not explanation. Compare supported motion grammar, timing ratios, masking and landing states to accessible reference footage; unavailable reference playback remains unverified. Inspect adjacent outgoing/entry states together after edits, not only the changed shot.

For audio-bearing films, the host decodes the output mix and reports missing/silent audio and sample peak warnings under `audioReview`. This is neither speech recognition nor proof of audible synchronization: BGM can mask missing narration or SFX while the mix remains non-silent. Listen to the final artifact, verify spoken phrase/visual-event pairs and SFX onset/trailing sound, and check speech intelligibility and music masking. Near-full-scale sample peaks require inspection, not an automatic clipping verdict. If BGM obscures the diagnosis, compare a same-timeline music-disabled render retaining narration/SFX only when the current workflow supports it; do not create a parallel project or require two exports for intentionally music-free explainers.

An independent reviewer, when available and authorized, receives only the approved brief/script, selected card/variant/source/reference, current rendered artifact and timed frame evidence. Do not supply maker explanations, expected verdicts or debugging history. Otherwise explicitly record that review was not independent. Do not spawn unavailable or unauthorized agents.

Report three scopes separately in the existing acceptance output: **technical health**, **expression/recipe fit**, and **ordinary-speed audiovisual/export review**. The automatic receipt leaves `expression` and `audibleSync` unverified; no automatic technical pass can upgrade these. Each failed or unverified claim needs scene ID, absolute frame/time, observed issue or missing evidence, and next action. Never mark an unperformed review Passed. Required unresolved defects remain a draft; optional omissions and unavailable review are disclosed separately.

Repair content/selection errors in the script/recipe choice, implementation errors in the mounted composition, and sound errors in the mix. Retain prior evidence, produce current-version evidence, then replay the whole sequence to catch shifted cues and seams. The host fingerprints the project (including scripts, components, styles and assets, excluding generated renders); changes invalidate the prior receipt. External dependencies not included in that fingerprint must be disclosed, not certified by the local snapshot. Keep one consolidated repair and one targeted follow-up; remaining must-fix issues stop delivery rather than trigger indefinite polishing.
