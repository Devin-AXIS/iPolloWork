# State Transformation

Use when an object, system, workflow, or situation changes because of a visible operation. Do not substitute two unrelated card pages for a real transformation.

## Semantic roles

- `[data-motion-role="source"]` — complete initial state.
- `[data-motion-role="operation"]` — cause, intervention, or transformation cue.
- `[data-motion-role="target"]` — complete resulting state.
- `[data-motion-role="persistent"]` — stable identity shared by both states.
- `[data-motion-role="conclusion"]` — meaning of the change.

## Registry candidates

Prefer `media-before-after`, `ui-3d-reveal`, or `code-particle-assemble` according to whether the change is comparative, interface-led, or constructive. Keep a stable subject anchor and reuse the component timeline before adding the fallback transformation below.

## Temporal states

- **Establish:** make the source state legible.
- **Develop:** expose the operation and transform shared or changed properties with continuity.
- **Land:** stabilize the target state and state the consequence.

## Timeline recipe

```js
const sceneStart = 30;
const source = "#scene-transform [data-motion-role='source']";
const operation = "#scene-transform [data-motion-role='operation']";
const target = "#scene-transform [data-motion-role='target']";

tl.fromTo(source,
  { opacity: 0, x: -34 },
  { opacity: 1, x: 0, duration: 0.65, ease: "power3.out" },
  sceneStart + 0.2);
tl.fromTo(operation,
  { opacity: 0, scale: 0.75 },
  { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.5)" },
  sceneStart + 1.4);
tl.to(source,
  { opacity: 0.28, x: -22, scale: 0.96, duration: 0.65, ease: "power2.inOut" },
  sceneStart + 2.0);
tl.fromTo(target,
  { opacity: 0, x: 38, clipPath: "inset(0 100% 0 0)" },
  { opacity: 1, x: 0, clipPath: "inset(0 0% 0 0)", duration: 0.85, ease: "power3.inOut" },
  sceneStart + 2.05);
tl.fromTo("#scene-transform [data-motion-role='conclusion']",
  { opacity: 0, y: 16 },
  { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
  sceneStart + 3.05);
```

## Adaptation

- Prefer morphing shared geometry, position, color, crop, or content state over replacing the whole screen.
- Keep a stable anchor so the viewer understands that the same subject changed.
- Use a split or wipe when both states must remain directly comparable.

## Acceptance

- Source and target states are independently readable at their sampled frames.
- The operation is visible and explains why the change occurred.
- The result is not merely a second slide with no continuity to the source.
