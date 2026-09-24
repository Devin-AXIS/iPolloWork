# Audio Reactive

Use when measured speech, music, or media events are the authoritative cause of visual changes. A waveform graphic or a scene that merely contains audio is not audio-reactive.

## Semantic roles

- `[data-motion-role="audio-bed"]` — the referenced narration, music, or media source.
- `[data-motion-role="pulse"]` — an element responding to beat, onset, or amplitude.
- `[data-motion-role="accent"]` — a visual event tied to a meaningful audio cue.
- `[data-motion-role="phrase"]` — text or subject synchronized to a spoken segment.
- `[data-motion-role="resolve"]` — the visual state reached after the final cue.

## Registry candidates

`oscilloscope-trace`, `x-space`, `douyin-video`, and `instagram-reel` can provide a visual base. They do not prove audio reactivity by themselves. Use this pattern only when the project has measured cue times from actual narration, music, or media. Otherwise select `kinetic-type`, `dialogue`, or another visual pattern with `estimated-reading` or `visual-cue` timing.

## Beat grammar

- **Establish:** reveal the audio source or visual subject on the first measured cue.
- **Develop:** respond to a bounded set of meaningful onsets, phrases, amplitude changes, or musical sections.
- **Land:** resolve on the final phrase or cadence and stop reactive motion.

## Execution contract

Store the actual cue source in `data-ipw-timing-source` as `voiceover`, `music`, or `media`. For music, mount the real local file and call `media/video_audio_analyze` once for the project entry. Select a bounded set of meaningful returned cues, convert them to scene-relative time, and store them as literal JSON in `data-ipw-audio-cues` before authoring the reactive beats. Each saved cue must land inside a concrete active beat motion window. Quantize cue boundaries to project frames. Prefer semantic phrase boundaries for speech and section or accented-beat boundaries for music; do not map every waveform sample to DOM animation or invent timestamps from the track duration.

Use deterministic keyframes or timeline tweens derived from saved cue times. Do not read live microphone input, use wall-clock listeners, or let Web Audio drive a second playback clock. If audio generation or authorization is unavailable, continue with a silent visual pattern and disclose the limitation instead of fabricating cue data.

## Acceptance

- Visual accents occur at saved, reproducible audio cue times during direct seeking and playback.
- The project has audible source media when audio is expected; a timeline waveform alone is insufficient.
- Reactive motion stops at the scene boundary and does not mask speech or required text.
- Removing or retiming the audio would require retiming the visual beat map; otherwise the pattern is not genuinely audio-reactive.
