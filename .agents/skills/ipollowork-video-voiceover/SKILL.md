---
name: ipollowork-video-voiceover
description: Add or revise scene-bound narration in an active iPolloWork Video Studio project using its selected voice, media actions, timing contract, and final validation.
---

# iPolloWork Video Voiceover

Use this Skill for scene-bound narration in an active Video Studio project when the voice service is available and automatic voiceover is enabled, or when the user explicitly requests narration. The Video Studio and its media services remain core iPolloWork capabilities and do not depend on this Skill being installed.

## Workflow

1. Read the active session's exact video project, `voiceover.json`, and injected voiceover contract before synthesizing anything.
2. Build narration per visual scene from that scene's visible text in reading order. Do not paraphrase or narrate another scene.
3. Use only the media action and selected voice supplied by iPolloWork. Do not substitute a generic speech tool or another provider.
4. Treat returned duration and timing data as authoritative. Extend the current scene and shift every later scene, transition, caption, audio start, and animation timestamp when narration runs longer.
5. Keep one immutable narration asset and one timeline audio node per narrated scene; remove only obsolete narration references, never music or sound effects.
6. Run both the HyperFrames project check and the active session's voiceover timeline validation before finishing.

With an authorized voice service, use the saved voice selection; if it is missing or invalid, use iPolloWork's default `cosyvoice-v3-flash` / `longanyang` profile rather than omitting narration. Respect an explicitly saved `enabled: false` choice unless the user requests narration. Without an authorized voice service, continue visual video work without new narration, preserve existing audio, and direct the user to the Video Studio voice panel to connect the service in Authorization Center. Never request an API key in chat or fabricate narration assets.

## Content scope

Let content determine page count, scene count, and duration. Template sample quantities and timings are not limits, even when an inherited checklist calls them fixed. Apply counts or duration constraints only when explicitly requested by the user. Approximate targets allow reasonable variation; explicit maximums remain strict. Do not omit important content or add filler to fit a template. For narration, pass `targetDurationSeconds` only for a user duration request and synchronize scenes to actual audio duration.
