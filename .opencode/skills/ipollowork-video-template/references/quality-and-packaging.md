# Quality and packaging

- [Reusable package contract](#reusable-package-contract)
- [Asset rules](#asset-rules)
- [Audio and captions](#audio-and-captions)
- [Deterministic checks](#deterministic-checks)
- [Visual inspection](#visual-inspection)
- [Completion report](#completion-report)

## Reusable package contract

Create:

```text
<template-id>/
├─ manifest.json
├─ index.html
├─ cover.png
└─ assets/
   ├─ scripts and runtime files
   ├─ images and video
   ├─ fonts
   ├─ models
   └─ audio
```

Manifest V1 requirements include:

- `schemaVersion: 1`;
- stable reverse-domain-style `id`;
- semantic `version`;
- `kind: "design"`;
- `category: "video"` and `surface: "video"`;
- `entry: "index.html"`;
- title, description, cover, subcategory, style, and tags;
- source name, license, and attribution where needed;
- design-system token version, editable groups, and variables;
- actionable apply checklist;
- minimum app version.

Do not invent manifest fields. The product schema is strict.

## Asset rules

- Keep runtime scripts, fonts, images, video, models, and audio local.
- Use relative paths that remain inside the template directory.
- Do not use `file:` paths, parent-directory traversal, localhost URLs, expiring links, private URLs, CDN scripts, or remote font imports.
- Record third-party source, license, revision, and attribution in the manifest.
- Optimize media for the target canvas and duration.
- Give images meaningful `alt` text when they convey content.
- Provide a CSS/HTML fallback for optional WebGL or advanced media.
- Do not redraw the iPolloWork logo. Use the current project asset when the iPolloWork brand is requested.

## Audio and captions

Use separate track roles for voiceover, background music, and effects. Let HyperFrames own playback.

For scene narration:

- synthesize one immutable audio file per narrated scene;
- keep narration text identical to visible scene text and in the same reading order;
- attach the exact scene ID, text snapshot, narration text, start, duration, track, and volume metadata required by the host;
- use returned speech duration as authoritative;
- extend the scene and shift everything later when narration does not fit;
- leave a short reading buffer after speech;
- remove obsolete voiceover nodes only after new references are valid;
- never remove music or sound effects while replacing narration.

For captions:

- keep them inside a safe band and away from the main subject;
- limit line length and number of lines;
- maintain strong contrast over every background;
- synchronize caption windows with the words they represent;
- expose user-facing caption style and highlight color only when the product can safely edit them.

## Deterministic checks

Run the bundled validator:

```text
node .opencode/skills/ipollowork-video-template/scripts/validate-video-template.mjs <template-directory>
```

Then run the host-provided HyperFrames check from the exact session directory when working in a live video session.

The validator must pass:

- manifest structure and video surface;
- package entry and cover existence;
- unique, supported variables;
- matching HTML composition metadata;
- real variable bindings;
- root composition attributes;
- timed clip attributes;
- unique, ordered, non-overlapping scene windows;
- root duration covering all timed nodes;
- paused timeline registration;
- local asset paths and no remote runtime dependency.

## Visual inspection

Inspect at minimum:

1. first settled frame;
2. a representative middle scene;
3. every transition boundary;
4. caption and narration moments;
5. final settled frame.

Verify:

- no blank frame at the start or end;
- no clipped or overflowing text;
- sufficient reading time;
- no important content under captions or branding;
- no scene overlap or stale previous scene;
- consistent palette, typography, and spacing;
- media fallback remains understandable;
- verified data and visible sources;
- outro and root duration include final narration.

## Completion report

Report:

- template ID, version, duration, and aspect ratio;
- narrative sequence and selected style;
- public variables and component families;
- changed and preserved contracts;
- local asset and license status;
- exact validation commands and results;
- any unverified browser, WebGL, audio, or rendering path.
