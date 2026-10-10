---
name: ipollowork-video-studio
description: Route the active iPolloWork video request to its current storyboard, compose, voiceover or soundtrack work, using the engine's native workflow and existing media tools.
---

# iPolloWork Video Studio

Read the active task contract and identify this turn's requested scope. Use [shared session boundaries](references/video.md) when not already known. Load only the matching professional Skill; their metadata is a menu, not a preload checklist.

| Actual work now | Skill |
| --- | --- |
| Script, source coverage or narrative plan | `ipollowork-video-storyboard` |
| Visual assets, recipes, composition, motion or targeted text/theme changes | `ipollowork-video-compose` |
| New/revised narration or speech-linked captions | `ipollowork-video-voiceover` |
| Music, effects or mix | `ipollowork-video-soundtrack` |

Uploaded-video enhancement uses this same workflow and the same specialists. When the task supplies a `video-enhancement` request, read [its input contract](references/video.md#uploaded-video-input) and treat local analysis as source material and protected layout constraints. Produce the requested video through the ordinary storyboard/compose/acceptance path; a basic keyword/layout preview is not the finished generation workflow.

Finished-video work progresses from saved storyboard to actual production, loading the next guide only when its work begins. Prepare scene anchors before synthesis and use returned measured audio before final event binding; silent/media/music work skips TTS. Existing audio only needs preservation. Script-only/review work stops at the saved storyboard; discussions stay in chat. The native main Agent owns completion, checks, repairs and requested delivery; use the existing media tools and applicable [acceptance](references/video-acceptance.md). Return the actual source and completed output paths. Do not expand a targeted task into a complete-film workflow.
