# Path Journey

Use when meaning follows a route, timeline, dependency chain, spatial journey, or progress track. Do not use a path merely as decoration around unrelated points.

## Semantic roles

- `[data-motion-role="path"]` — SVG path, line, or track.
- `[data-motion-role="marker"]` — object that advances along the route.
- `[data-motion-role="stop"]` — milestones with ordered `data-motion-index`.
- `[data-motion-role="detail"]` — stop-specific explanation.
- `[data-motion-role="conclusion"]` — destination or implication.

## Registry candidates

Prefer `milestone-timeline`, `us-map-flow`, or `process-handoff-map` according to whether the path is temporal, geographic, or procedural. Preserve structured data bindings and extend the component timeline only when the route does not already reveal stops in the required order.

## Temporal states

- **Establish:** reveal the origin and enough of the route to explain direction.
- **Develop:** advance the marker and reveal each stop with its consequence.
- **Land:** arrive at the destination and show the route's overall meaning.

## Timeline recipe

```js
const sceneStart = 8;
const path = document.querySelector("#scene-journey [data-motion-role='path']");
const marker = "#scene-journey [data-motion-role='marker']";
const stops = gsap.utils.toArray("#scene-journey [data-motion-role='stop']");
const pathLength = path.getTotalLength();

gsap.set(path, { strokeDasharray: pathLength, strokeDashoffset: pathLength });
tl.to(path, { strokeDashoffset: 0, duration: 4.8, ease: "none" }, sceneStart + 0.35);

stops.forEach((stop, index) => {
  const progress = stops.length === 1 ? 1 : index / (stops.length - 1);
  const point = path.getPointAtLength(pathLength * progress);
  const at = sceneStart + 0.45 + progress * 4.5;
  tl.to(marker, { x: point.x, y: point.y, duration: 0.65, ease: "power2.inOut" }, at);
  tl.fromTo(stop,
    { opacity: 0, scale: 0.82 },
    { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.4)" },
    at + 0.35);
  tl.fromTo(`#scene-journey [data-motion-role='detail'][data-motion-index='${index}']`,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
    at + 0.5);
});

tl.fromTo("#scene-journey [data-motion-role='conclusion']",
  { opacity: 0 },
  { opacity: 1, duration: 0.55, ease: "sine.out" },
  sceneStart + 5.25);
```

## Adaptation

- Use a visible path only when order or dependency matters.
- Replace SVG coordinates with a precomputed position list when the route is CSS-based.
- If the scene uses a camera pan, move a stage wrapper deterministically and keep captions or fixed chrome outside it.

## Acceptance

- Direct seeking shows the correct revealed path, marker position, visited stops, and current detail.
- The route direction matches the logical or geographic meaning.
- The destination and conclusion are both visible in the Land frame.
