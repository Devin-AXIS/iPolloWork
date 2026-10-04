---
name: short-video-studio
description: Plan and create short videos using the installed short-video-studio workspace app. Manage its creative canvas, scripts, storyboards, characters and local assets, generate images or video through connected Work channels, and hand off editable tracks to Work Video Studio.
---

# Short-video workspace

This skill belongs to the independently installed `short-video-studio` plugin. Do not install a global copy or modify the iPolloWork source repository.

## Conversation and workspace

The user talks in the existing left conversation. The right workspace is a creative canvas, not a second chat. Open the plugin's `studio` workspace app through Work's existing plugin entry. If already open, discover its tools using `ipollowork_workspace_app_list_tools` and call them with `ipollowork_workspace_app_call_tool`. Do not guess a browser URL or start another editor server.

1. Call `project_read`. The project has `nodes`, `edges`, `script`, `shots`, `roles`, `assets`, `tracks`, `jobs`, `exports`, and a current `revision`.
2. Propose a coherent story and update the same document with `project_update`. Preserve unrelated work and the current revision. If a revision conflict is returned, re-read and reconcile; do not blindly overwrite.
3. Nodes have `id`, `kind` (`text`, `image`, `video`, `audio`, `script`, `storyboard`), `title`, `prompt`, `x`, `y`, optional `assetId` and `settings`. IDs start with a letter and contain only ASCII letters, numbers, `_` or `-`. Edges are `{id, from, to}`; they organize the canvas, but are not themselves model references.
4. Shots are `{id, title, prompt, narration, duration, assetId?}` in playback order. Duration is seconds. Roles are `{id, name, description, assetId?}`. Character consistency is a prompt/reference workflow, not a guarantee.

## Real generation

Call `capabilities` before choosing a model. Use only models available/configured in Work and only the returned parameter choices. The plugin neither connects to LibTV nor stores another API key.

Image node `settings`: model, size, quality; optional `referenceId` for an image edit, `maskDataUrl` for an explicitly supplied transparent PNG mask. Video node `settings`: model, operation, resolution, duration (string), ratio; `referenceId` for first frame, `lastFrameId` for last frame, or `referenceIds` for multimodal references. First-frame, edit and extend modes use `adaptive` ratio; edit uses duration `-1`. `style` and `camera` are prompt intent, not native deterministic controls.

Audio nodes synthesize speech through Work's configured CosyVoice channel, using their `prompt` as narration text and optional `settings.voice`. The service measures the saved MP3 duration; place it on a separate audio track without truncating speech. This is not a music-generation model.

Call `generate` only when the user asks to generate. It can charge the configured provider. Pass a fresh UUID `requestId` for a new intended generation; reuse the same request ID after an uncertain transport result. Query `generation_status`; never automatically resubmit an uncertain task. Unsupported models, music generation, proprietary LibTV services and unavailable authorizations must be explained, not simulated.

Import user-selected local media via `import_asset` with a workspace-relative `path`. Assets become project-owned copies. Supply `metadata.durationSeconds` for media whose duration isn't available from Work inspection. Don't invent a duration or use remote expiring URLs in final tracks. Generated/imported `assets`, `jobs`, and `exports` are maintained by the service; project_update cannot manufacture them.

## Editable multitrack handoff

Assign image/video assets to shots, then `arrange_shots`. This replaces rough-cut tracks, so ask before discarding existing manual track edits. Original sound becomes a separate audio track, not mixed into the video. Add music/voice/SFX as separate audio tracks; captions remain editable text.

Tracks contain `{id, label, kind, clips}`. Clip start/duration use integer `startFrame`/`durationFrames` at the project's rational `fps`. Media clips use `source: assets/<registered filename>`, `sourceDurationSeconds`, `sourceStartSeconds`, `playbackRate`, `volume`. Same-track overlap and source overruns are rejected. Never hand off a flattened MP4 as the editable project.

Call `handoff`. Return the resulting `absolutePath` or workspace-relative `path` as a clickable local file link in the left conversation and tell the user to open it in Work's Video Studio. The current host has no generic plugin API that switches directly into the native editor; do not claim it switched automatically. Once handed off, the native HTML and assets are the editing source of truth. Never overwrite them from an older canvas document. Changed handoffs create a new engineering file; repeated unchanged handoffs reuse the existing one.

Projects live under the chosen workspace's `short-video/<project-id>/`; native handoffs under `video/<id>/`. These user-created files survive plugin uninstall. The package, skill and temporary upload data are removed by the host's plugin lifecycle.
