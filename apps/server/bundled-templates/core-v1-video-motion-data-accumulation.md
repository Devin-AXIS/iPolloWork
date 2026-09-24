# Data Accumulation

Use when values, measures, or evidence build toward a conclusion. Do not reproduce a dashboard or animate unsupported numbers.

## Semantic roles

- `[data-motion-role="baseline"]` — starting measure or reference.
- `[data-motion-role="measure"]` — repeated values with `data-motion-index` and final `data-value`.
- `[data-motion-role="bar"]` — visual magnitude associated with a measure.
- `[data-motion-role="annotation"]` — explanation tied to a meaningful change.
- `[data-motion-role="conclusion"]` — supported takeaway.

## Registry candidates

Prefer `bar-chart-race`, `waterfall-impact`, or `chart-story` according to whether the evidence is ranked, additive, or a short series. Preserve structured data, units, and sources; retime the component's existing value changes rather than layering a second chart animation.

## Temporal states

- **Establish:** show the baseline, unit, and comparison frame.
- **Develop:** add or update measures in the order needed to understand the evidence.
- **Land:** hold the final comparison and reveal the supported takeaway.

## Timeline recipe

```js
const sceneStart = 42;
const measures = gsap.utils.toArray("#scene-data [data-motion-role='measure']");

tl.fromTo("#scene-data [data-motion-role='baseline']",
  { opacity: 0, scaleX: 0, transformOrigin: "left center" },
  { opacity: 1, scaleX: 1, duration: 0.55, ease: "power2.out" },
  sceneStart + 0.2);

measures.forEach((measure, index) => {
  const at = sceneStart + 0.8 + index * 1.05;
  const value = Number(measure.dataset.value);
  const counter = { value: 0 };
  tl.fromTo(measure.querySelector("[data-motion-role='bar']"),
    { scaleX: 0, transformOrigin: "left center" },
    { scaleX: 1, duration: 0.7, ease: "power3.out" },
    at);
  tl.to(counter, {
    value,
    duration: 0.7,
    ease: "power2.out",
    onUpdate: () => { measure.querySelector("[data-motion-value]").textContent = Math.round(counter.value).toString(); },
  }, at);
  tl.fromTo(measure.querySelector("[data-motion-role='annotation']"),
    { opacity: 0, x: 12 },
    { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
    at + 0.45);
});

tl.fromTo("#scene-data [data-motion-role='conclusion']",
  { opacity: 0, y: 14 },
  { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
  sceneStart + 1.05 + measures.length * 1.05);
```

## Adaptation

- Use the project timeline's deterministic update model for counters. If callback state is not seek-safe in the active runtime, animate a CSS custom property or pre-render discrete labels instead.
- Keep units and baselines consistent. Use shape or position rather than color alone for comparison.
- Attach source attribution to evidence that requires it.

## Acceptance

- Values at direct seek positions match the intended timeline state.
- The final visual comparison is truthful and readable without replaying the animation.
- The conclusion follows from the displayed measures and does not overstate evidence.
