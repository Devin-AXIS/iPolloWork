---
name: ipollowork-video-studio
description: Route the active iPolloWork video request to its current storyboard, compose, voiceover or soundtrack work, using the engine's native workflow and existing media tools.
---

# iPolloWork Video Studio

Read the active task contract and identify this turn's requested scope. Use [shared session boundaries](references/video.md) when not already known. Load only the matching professional Skill; their metadata is a menu, not a preload checklist.

Live production overrides the saved-storyboard-first stage order below. Follow the task's fast-opening contract before loading specialist guides when eligible; otherwise publish one complete 3–6 second scene with its required assets/audio first. That scene is the motion audition. Build and save the remaining storyboard, media and soundtrack incrementally while appending complete scenes; preserve the published prefix. Script-review/script-only requests retain their normal stop point.

| Actual work now | Skill |
| --- | --- |
| Script, source coverage or narrative plan | `ipollowork-video-storyboard` |
| Visual assets, recipes, composition, motion or targeted text/theme changes | `ipollowork-video-compose` |
| New/revised narration or speech-linked captions | `ipollowork-video-voiceover` |
| Music, effects or mix | `ipollowork-video-soundtrack` |

Uploaded-video enhancement uses this same workflow and specialists. Read [its input contract](references/video.md#uploaded-video-input); local analysis supplies source material and measured placement. Complete the ordinary storyboard/compose/acceptance path beyond the base preview. Generation/editing defaults to `acceptance=studio-preview`: use component/preview checks and Studio playback; export only for explicit file delivery or authorized publication.

Video work progresses from saved storyboard to actual production, loading the next guide only when its work begins. Prepare scene anchors before synthesis and use returned measured audio before final event binding; silent/media/music work skips TTS. Existing audio only needs preservation. Script-only/review work stops at the saved storyboard; discussions stay in chat. The native main Agent owns completion, checks, repairs and requested delivery; use the existing media tools and applicable [acceptance](references/video-acceptance.md). Return the actual source and completed output paths. Do not expand a targeted task into a complete-film workflow.
