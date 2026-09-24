# Camera Journey

Use when the viewer must travel through a place, route, interface, image, or layered object while retaining orientation. Do not use for disconnected zoom effects.

## Semantic roles

- `[data-motion-role="world"]` — the stable coordinate space or media surface.
- `[data-motion-role="waypoint"]` — a meaningful destination along the route.
- `[data-motion-role="camera"]` — the single transform wrapper that owns pan, zoom, or orbit.
- `[data-motion-role="annotation"]` — context revealed only when its waypoint becomes active.
- `[data-motion-role="destination"]` — the final framed subject.

## Registry candidates

Prefer `browser-walkthrough`, `mobile-walkthrough`, `screenshot-zoom`, `route-map`, `map-flow`, `metro-network-map`, `location-pulse-map`, or `device-mockup`. Extend the component's existing timeline rather than nesting an independently playing camera animation.

## Beat grammar

- **Establish:** show enough of the world to establish direction, scale, and starting point.
- **Develop:** move through ordered waypoints; settle briefly at each one while its relevant detail changes.
- **Land:** decelerate into the destination and keep the final relationship legible.

## Execution contract

Animate one camera wrapper or one coherent viewBox at a time. Record each waypoint as a separate beat with the same world target plus its active annotation. Prefer position and scale changes that keep the next waypoint inside the viewer's inferred direction. Reset orientation explicitly before a large directional reversal.

Every move must reveal information unavailable at the previous framing. A camera move may bridge a short spoken pause, but no uninterrupted travel lasts more than three seconds without a waypoint or information change. Respect reduced-motion output by replacing deep travel with deterministic focus transfers.

## Acceptance

- Direct seeks show a stable start, at least one meaningful waypoint, and the intended destination.
- The viewer can infer where the camera came from and why it stopped.
- Labels remain attached to their subjects and do not drift during transforms.
- The Land frame is sharp, readable, and not mid-pan or mid-zoom.
