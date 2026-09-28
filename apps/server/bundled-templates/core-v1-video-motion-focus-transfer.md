# Focus Transfer

Use when several subjects must be examined in turn while their shared context remains visible. Do not use when the items form a required sequence; use Progressive Build or Path Journey instead.

## Semantic roles

- `[data-motion-role="context"]` — stable shared frame, title, or comparison criterion.
- `[data-motion-role="subject"]` — repeated subjects with `data-motion-index`.
- `[data-motion-role="focus"]` — optional outline, spotlight, crop frame, or pointer.
- `[data-motion-role="conclusion"]` — synthesis after all subjects are examined.

## Registry candidates

Prefer `product-comparison-stage` or `split-screen` when two subjects remain spatially related. Keep both subjects editable and visible enough for context; add a moving focus treatment only when the component's own timeline does not express narration order.

## Temporal states

- **Establish:** orient the viewer and make all subject locations understandable.
- **Develop:** move emphasis, framing, scale, or crop to each subject as it is discussed.
- **Land:** restore the relationship between subjects and reveal the synthesis.

## Timeline recipe

```js
const sceneStart = 20;
const subjects = gsap.utils.toArray("#scene-compare [data-motion-role='subject']");
const focus = "#scene-compare [data-motion-role='focus']";

tl.fromTo("#scene-compare [data-motion-role='context']",
  { opacity: 0 },
  { opacity: 1, duration: 0.45, ease: "sine.out" },
  sceneStart + 0.2);
tl.fromTo(subjects,
  { opacity: 0, y: 22 },
  { opacity: 0.58, y: 0, duration: 0.5, stagger: 0.08, ease: "power2.out" },
  sceneStart + 0.35);

subjects.forEach((subject, index) => {
  const at = sceneStart + 1.1 + index * 1.65;
  tl.to(subjects, { opacity: 0.45, scale: 1, duration: 0.3, ease: "power1.inOut" }, at);
  tl.to(subject, { opacity: 1, scale: 1.035, duration: 0.4, ease: "power3.out" }, at);
  tl.set(focus, { x: subject.offsetLeft, y: subject.offsetTop, width: subject.offsetWidth, height: subject.offsetHeight }, at);
  tl.to(focus, { opacity: 1, duration: 0.25, ease: "sine.out" }, at);
});

tl.to(subjects, { opacity: 1, scale: 1, duration: 0.45, ease: "power2.inOut" }, sceneStart + 1.2 + subjects.length * 1.65);
tl.fromTo("#scene-compare [data-motion-role='conclusion']",
  { opacity: 0, y: 14 },
  { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
  sceneStart + 1.45 + subjects.length * 1.65);
```

## Adaptation

- Prefer moving an existing framing element over repeatedly moving every subject.
- For real media, animate a wrapper or crop window instead of the media element's intrinsic dimensions.
- Use narration-aligned focus windows; equal spacing is only a fallback for silent content.

## Acceptance

- The active subject is unambiguous at each Develop sample.
- Non-active subjects retain enough context to preserve the comparison.
- The Land frame restores the full relationship instead of ending on an arbitrary isolated item.
