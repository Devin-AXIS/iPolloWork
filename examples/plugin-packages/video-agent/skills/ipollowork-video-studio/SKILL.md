---
name: ipollowork-video-studio
description: Route the active iPolloWork video request to its current storyboard, compose, voiceover or soundtrack work, preserving the client-owned delivery flow.
---

# iPolloWork Video Studio

Read the active task contract and identify this turn's requested scope. Use [shared session boundaries](references/video.md) when not already known. Load only the matching professional Skill; their metadata is a menu, not a preload checklist.

| Actual work now | Skill |
| --- | --- |
| Script, source coverage or narrative plan | `ipollowork-video-storyboard` |
| Visual assets, recipes, composition, motion or targeted text/theme changes | `ipollowork-video-compose` |
| New/revised narration or speech-linked captions | `ipollowork-video-voiceover` |
| Music, effects or mix | `ipollowork-video-soundtrack` |

Finished-video work progresses from saved storyboard to actual production, loading the next guide only when its work begins. Prepare scene anchors before synthesis and use returned measured audio before final event binding; silent/media/music work skips TTS. Existing audio only needs preservation. Script-only/review work stops at the saved storyboard; discussions stay in chat. Save completed source for the app's delivery continuation; delegated review/export/publication reads only applicable [acceptance](references/video-acceptance.md). Do not expand a targeted task into a complete-film workflow.
