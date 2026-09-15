---
name: ipollowork-video-voiceover
description: Add or revise scene-bound narration in an active iPolloWork Video Studio project using its selected voice, media actions, timing contract, and final validation.
---

# iPolloWork Video Voiceover

Use this Skill only when narration helps the confirmed brief or the user explicitly requests it. The Video Studio and its media services remain core iPolloWork capabilities and do not depend on this Skill being installed.

## Workflow

1. Read the active session's exact video project, `voiceover.json`, and injected voiceover contract before synthesizing anything.
2. Build narration per visual scene from that scene's visible text in reading order. Do not paraphrase or narrate another scene.
3. Use only the media action and selected voice supplied by iPolloWork. Do not substitute a generic speech tool or another provider.
4. Treat returned duration and timing data as authoritative. Extend the current scene and shift every later scene, transition, caption, audio start, and animation timestamp when narration runs longer.
5. Keep one immutable narration asset and one timeline audio node per narrated scene; remove only obsolete narration references, never music or sound effects.
6. Run both the HyperFrames project check and the active session's voiceover timeline validation before finishing.

If no valid voice selection exists, continue without narration instead of inventing a voice or blocking visual video work.
