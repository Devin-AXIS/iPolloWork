# Current video architecture

- [Runtime ownership](#runtime-ownership)
- [Composition hierarchy](#composition-hierarchy)
- [Timeline contract](#timeline-contract)
- [Track model](#track-model)
- [Two kinds of video architecture](#two-kinds-of-video-architecture)
- [Protected architecture](#protected-architecture)

## Runtime ownership

iPolloWork gives each video conversation one session-owned HyperFrames project:

```text
video/<session-id>/
├─ index.html       playable composition and source of truth
├─ brief.json       confirmed topic, audience, and objective
├─ voiceover.json   optional selected voice and model
└─ assets/          local images, video, fonts, models, audio, and runtime files
```

The right-side Video Studio is an embedded local HyperFrames Studio. It displays the exact session `index.html` and hot-reloads saved changes. The agent edits the project; it does not own or restart the Studio.

A reusable catalog template adds a package manifest and cover:

```text
<template-id>/
├─ manifest.json
├─ index.html
├─ cover.png
└─ assets/
```

## Composition hierarchy

Use this conceptual model:

```text
Video Project
└─ Composition
   ├─ Global settings
   ├─ Visual system
   ├─ Assets
   ├─ Audio
   └─ Scenes
      └─ Tracks
         └─ Clips
            └─ Components
               └─ Elements
```

The HTML representation is:

```html
<html data-composition-variables="[...]">
  <main
    id="root"
    data-composition-id="main"
    data-start="0"
    data-width="1920"
    data-height="1080"
    data-duration="15"
  >
    <div class="clip" data-start="0" data-duration="15" data-track-index="0"></div>
    <section
      id="scene-hook"
      class="scene clip"
      data-start="0"
      data-duration="3.2"
      data-track-index="2"
    ></section>
  </main>
</html>
```

Every timed node is a clip. Every full visual scene is also a scene. Persistent backgrounds, captions, canvas layers, and overlays remain clips and may span several scenes.

## Timeline contract

Create one paused timeline per composition:

```js
const timeline = gsap.timeline({ paused: true });
window.__timelines = window.__timelines || {};
window.__timelines.main = timeline;
```

The HyperFrames runtime owns seeking and playback. Never call media `play()`, `pause()`, or seek methods directly.

Use absolute GSAP positions based on scene starts. A scene-duration change is an architecture change: recompute later scene starts, clip windows, transitions, captions, narration, and animation timestamps. Root duration must cover the last timed item.

## Track model

Use stable track roles instead of arbitrary numbers:

| Suggested range | Role |
| --- | --- |
| 0 | persistent background |
| 1 | persistent media, canvas, or WebGL |
| 2–19 | ordered visual scenes |
| 20–29 | overlays and transitions |
| 30 | captions |
| 40 | voiceover |
| 41 | background music |
| 42 | sound effects |

Existing templates may use different indices. Preserve their semantics rather than renumbering them without a reason.

## Two kinds of video architecture

Treat both as required:

1. **Narrative architecture** decides why each scene exists and what order tells the story.
2. **Production architecture** decides how backgrounds, media, scenes, overlays, captions, voiceover, music, and effects occupy tracks and time.

Changing colors is not changing narrative architecture. Adding animation is not fixing a missing story beat.

## Protected architecture

Preserve these in an existing published template unless replacement is explicit:

- entry path and composition ID;
- stable scene IDs and scene roles;
- public variable IDs and types;
- track roles and media ownership;
- component interface and stable DOM hooks;
- GSAP selector relationships and timeline registry;
- voiceover scene IDs and timing metadata;
- required local runtime assets.

Internal layout values such as `--dx`, `--dy`, selector-only classes, temporary animation state, and derived scene offsets are implementation details, not public variables.
