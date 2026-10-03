---
name: ipollowork-video-voiceover
description: Add or revise scene-bound narration using the active Video Studio voice contract, measured audio and one client-owned delivery gate.
---

# iPolloWork Video Voiceover

Use only for authorized enabled speech or an explicit narration request. Read the exact session `voiceover.json`, saved `STORYBOARD.md`, current entry and injected contract. Respect saved disabled state and pinned/per-frame voices; use actual project/service defaults rather than guessing a provider, model, voice or instruction. Never request chat keys or substitute another TTS/CLI.

Read only [Narration, captions and soundtrack](../ipollowork-video-studio/references/video.md#narration-captions-and-soundtrack) for synthesis/caption interfaces. Match marked visible transcript to each scene, keep immutable per-scene outputs, use sequential batches of at most three, and apply returned duration/timing/nodes/cumulative shifts once. Preserve prior speech until batch success and preserve music/SFX throughout. A synthesis receipt is unfinished until the exact entry has its actual returned audio/captions and retimed dependencies.

Let source content and measured audio determine shots/duration; examples are not quotas. Pass target duration only for a user request, keep explicit caps and required facts, and use real provider alignment or honest sentence-level captions. Save the composition and let the client's combined project/voice gate run; do not create a second check loop. Without usable speech continue visual work, preserve existing audio and disclose unfinished required narration; never fabricate spoken assets.
