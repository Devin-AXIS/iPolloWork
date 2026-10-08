# iPolloWork Video Soundtrack

Read for music/SFX planning, sourcing, generation, replacement or mix edits. Inputs are affected storyboard sound directions, exact current entry, actual track files/receipts and locked visual/audio event windows. Existing speech is a mix constraint; do not load TTS interfaces or regenerate it. Preserve source content, scenes, captions, pinned voices and unrelated audio. Share the [session boundaries](video.md).

## Music decision, sourcing and editable tracks

A finished video needs an explicit full-video music decision before assembly. Product intros/explainers/promotions default to a suitable instrumental bed; speech is not a reason to omit it. Save `music_prompt` (mood, energy/pacing, instrumentation, vocals/no vocals, coverage, speech relationship). Exactly `music_prompt: none` is valid only for user-requested silence or approved original-sound-only intent, with reason in notes; never overwrite required music/failed sourcing with AI silence. Script-only assets may remain pending; finished sound may not.

Reuse supplied/local tracks first, otherwise discover actual authorized music/SFX sourcing or generation. TTS authorization/timeline support is not a music generator. Compare a bounded suitable shortlist, record title/source/license and concrete fit, save actual `music_asset` and mount that same file. Listen/inspect when supported, without inventing an audition. Missing suitable licensed/authorized decodable audio is partial delivery. Preserve pinned music/effects during speech edits. Bed uses `data-timeline-role="music"` and `data-ipw-bgm="true"`; effects use `data-timeline-role="sfx"`. Use separate framework-owned editable clips with explicit source/start/duration/track/volume, matching trim/source length and real coverage. No assumed looping or stretching a short effect across the film.

Choose scene timing from measured speech, measured music cues, source footage or silent reading. Set restrained supported levels/fades/ducking, audition intelligibility and verify trim/loop coverage. Plan sound early; place final effects against locked visual events and retime them after edits, not every word/cut. Music-led cues use actual analysis; a quiet narration bed needs no beat detector. Missing/muted/wrong-path requested BGM/SFX fails its audio requirement; explicit disabled/unavailable sound is disclosed.

## Locked event score

After visual events are locked, `media/video_soundtrack_prepare` accepts the exact `sourcePath`, `durationSeconds`, `events:[{eventId,time,kind:"air"|"contact"|"resolve",strength:0..1,pan:-1..1,assetPath?}]`, actual `speechWindows:[{start,end}]` and optional `musicVolume`. Events express a real carry/contact/landing; no effect per word or decorative cut. Supplied licensed local `assetPath` stays within this project assets; otherwise the host independently synthesizes bounded air/contact/resolve sounds. It returns separate editable WAV clips, shared modest room tails and a single `musicTimelineScript` for the paused root GSAP timeline (`tl`). Mount the clips and retain provenance; existing runtime probing drives the same envelope in preview/export. This prepares effects/ducking, not a music bed or speech. Rebind after timing changes and verify the actual mix; a non-silent bed cannot certify event audio.

## Measured cues

Music-led audio-reactive work mounts real local audio then calls `media/video_audio_analyze` once for the exact entry. Select meaningful measured onsets/sections, save literal scene-relative `data-ipw-audio-cues` and bind every cue to an active beat motion window. No inferred filename/duration/waveform timestamps.

For music-led visual changes hand the exact audio/cue path, scene IDs, cue times and intended event to Compose; read only its affected motion schema if applying the change directly. A soundtrack-only edit preserves visual timing unless that change is requested. Keep local music/SFX clips separate from narration and leave playback sequencing to the framework. Update actual `music_asset`/effect references and preserve generation receipts/provenance, rather than recording an unmounted URL or filename.

Save the source for the client's combined gate. Actual file/decode success cannot certify mix quality or event synchronization: use only the current host evidence under applicable [media, narration and soundtrack acceptance](video-acceptance.md#media-narration-and-soundtrack), and disclose unheard/unverified output. Export/publishing additionally require their authorized host continuation.
