# Progressive Build

Use when ordered parts create a process, model, argument, or final structure. Do not use for independent items that can be understood in any order.

## Semantic roles

- `[data-motion-role="context"]` — optional orientation that remains available.
- `[data-motion-role="part"]` — repeated units in narration order.
- `[data-motion-role="connector"]` — lines or relationships revealed with their dependent part.
- `[data-motion-role="conclusion"]` — the resolved model or takeaway.

## Registry candidates

Prefer `checklist-reveal`, `sequence-diagram`, or `process-cycle` when its structure fits. Preserve its editable variables and inherited theme, retime its existing sequence to narration beats, and use the recipe below only for missing accumulation or resolution behavior.

## Temporal states

- **Establish:** show context and the first meaningful part.
- **Develop:** add parts and their connectors in narration order while preserving useful prior context.
- **Land:** show the complete structure, reduce incidental emphasis, and reveal the conclusion.

## Timeline recipe

Append to the existing paused project timeline. Replace selectors and timing with the real scene instance and narration beats.

```js
const sceneStart = 12;
const buildStart = sceneStart + 0.25;
const parts = gsap.utils.toArray("#scene-model [data-motion-role='part']");

tl.fromTo("#scene-model [data-motion-role='context']",
  { opacity: 0, y: 24 },
  { opacity: 1, y: 0, duration: 0.55, ease: "power3.out" },
  buildStart);

parts.forEach((part, index) => {
  const at = buildStart + 0.55 + index * 0.9;
  tl.fromTo(part,
    { opacity: 0, scale: 0.92 },
    { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.3)" },
    at);
  tl.fromTo(`#scene-model [data-motion-role='connector'][data-motion-index='${index}']`,
    { opacity: 0, scaleX: 0, transformOrigin: "left center" },
    { opacity: 1, scaleX: 1, duration: 0.45, ease: "power2.inOut" },
    at + 0.25);
});

tl.fromTo("#scene-model [data-motion-role='conclusion']",
  { opacity: 0, y: 18 },
  { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" },
  buildStart + 0.7 + parts.length * 0.9);
```

## Adaptation

- Tie each part to a narration beat instead of using equal spacing when audio exists.
- Keep earlier parts visible when they are needed to understand the whole. Dim them only when the current step requires stronger focus.
- For dense material, split the build across scenes rather than shrinking the complete model.

## Acceptance

- Direct seeks before and after every part boundary show a stable accumulated state.
- The Land frame contains the intended complete structure and conclusion.
- The scene does not reveal every part during the opening second and then remain unchanged.
