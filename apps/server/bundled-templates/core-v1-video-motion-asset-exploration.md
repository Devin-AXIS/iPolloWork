# Asset Exploration

Use when an image, interface, document, map, or video clip contains the evidence or experience being explained. The asset should lead the scene rather than decorate a text-heavy layout.

## Semantic roles

- `[data-motion-role="asset-frame"]` — fixed viewport or wrapper controlling crop and transform.
- `[data-motion-role="asset"]` — saved project-relative image or playable media.
- `[data-motion-role="annotation"]` — repeated callouts with `data-motion-index`.
- `[data-motion-role="focus"]` — highlight, mask, outline, or pointer.
- `[data-motion-role="conclusion"]` — interpretation after exploration.

## Registry candidates

Prefer `mobile-walkthrough`, `picture-in-picture`, or `device-mockup` according to whether the subject is an interface flow, supporting view, or framed product surface. Keep real project-relative media and component variables; extend framing only when its existing timeline does not visit the required details.

## Temporal states

- **Establish:** show enough of the complete asset to orient the viewer.
- **Develop:** move crop, scale, playback, or annotations through meaningful details in narration order.
- **Land:** return to a useful overview or hold the decisive detail with its interpretation.

## Timeline recipe

```js
const sceneStart = 54;
const frame = "#scene-asset [data-motion-role='asset-frame']";
const asset = "#scene-asset [data-motion-role='asset']";
const annotations = gsap.utils.toArray("#scene-asset [data-motion-role='annotation']");

tl.fromTo(frame,
  { opacity: 0, scale: 0.94 },
  { opacity: 1, scale: 1, duration: 0.65, ease: "power3.out" },
  sceneStart + 0.2);

annotations.forEach((annotation, index) => {
  const at = sceneStart + 1.15 + index * 1.65;
  const x = Number(annotation.dataset.focusX || 0);
  const y = Number(annotation.dataset.focusY || 0);
  const scale = Number(annotation.dataset.focusScale || 1.18);
  tl.to(asset, { x, y, scale, duration: 0.75, ease: "power2.inOut" }, at);
  tl.fromTo(annotation,
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
    at + 0.45);
});

tl.fromTo("#scene-asset [data-motion-role='conclusion']",
  { opacity: 0 },
  { opacity: 1, duration: 0.5, ease: "sine.out" },
  sceneStart + 1.45 + annotations.length * 1.65);
```

## Adaptation

- Animate a wrapper or crop frame, not an image's intrinsic width and height.
- Use real saved assets with project-relative paths. Validate decode and visible placement before final checks.
- For video media, keep playback framework-owned and synchronize clip windows with the scene instead of controlling playback through wall-clock callbacks.
- Keep fixed captions and chrome outside the transformed asset frame.

## Acceptance

- The Establish frame provides orientation before the first detail view.
- Every camera or crop move lands on a meaningful visible detail and matches its annotation.
- The asset remains sharp enough at the largest crop and the final frame communicates the intended interpretation.
