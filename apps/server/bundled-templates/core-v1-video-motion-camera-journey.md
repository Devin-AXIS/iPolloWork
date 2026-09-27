# Camera Journey

Use when the viewer must travel through a place, route, interface, image, or layered object while retaining orientation. Do not use for disconnected zoom effects.

## Semantic roles

- `[data-motion-role="world"]` — the stable coordinate space or media surface.
- `[data-motion-role="waypoint"]` — a meaningful destination along the route.
- `[data-motion-role="camera"]` — the single transform wrapper that owns pan, zoom, or orbit.
- `[data-motion-role="annotation"]` — context revealed only when its waypoint becomes active.
- `[data-motion-role="destination"]` — the final framed subject.

## Registry candidates

Prefer `screenshot-zoom` for a screenshot overview → focal detail → overview (imageUrl, focusX/focusY), `device-carousel` for a three-screen depth/focus journey (screenUrls and labels separated by `|`), or `spatial-camera-suite` for a configurable, layered interface stage with one of five complete camera recipes. Empty image URLs in these compositions display explicitly illustrative content, not product evidence. Extend a component's existing timeline rather than nesting an independently playing camera animation.

## Spatial camera recipes

`spatial-camera-suite` is one editable stage, not five duplicate components. Set its `shotStyle` variable to the closest named movement below; `title`, optional project-local `imageUrl`, and up to three pipe-separated `label::detail` cards supply the scene content. Prefix one card label with `*` to focus it. The selected value creates one paused, deterministic 9-second timeline that owns the camera and depth planes. Do not apply another camera preset to this component's camera or cards.

| `shotStyle` | Observable choreography | Use when |
| --- | --- | --- |
| `graze-face-tour` | Begin close to the interface plane, skim laterally at a low angle, pass floating waypoints, then settle toward a readable front view. | The viewer should travel across a surface and discover details in sequence. |
| `depth-layer-moves` | Expand the background at a different rate, shift independent cards by depth, pin the featured card during a controlled push, then land in a balanced overview. | The relationship among foreground, subject, and environment matters. |
| `spotlight-hero-card` | Diagonally push toward the marked hero card, lift it into focus, make two restrained outline passes, and return to context. | One item should win attention without losing the surrounding interface. |
| `runway-ground-skim` | Start near the ground, bring cards down in an overlapping sequence with no bounce, then raise the stage into its final view. | A set of items should arrive with physical weight and resolve as one system. |
| `steep-tilt-glide` | Glide a strongly tilted page across a fixed view, settle readable labels during travel, use subtle speed ghosting, then ease into the final angle. | A broad interface should feel like a continuous spatial traverse. |

Keep travel short enough to understand, make each waypoint reveal new information, and reserve a stable end hold. These names describe temporal shot recipes; the component supplies the layered structure, and the existing project timeline remains authoritative for scene timing, captions, audio, and export.

## Shared animation presets

Query `list_motion_presets` for the active runtime and use `mutate_motion` to write a real semantic animation, with an explicit start/duration and selector. The names below are registry IDs, not a substitute for applying the animation:

| Shot purpose | Preset | Parameters / placement |
| --- | --- | --- |
| Overview → detail | `camera.push-in` | focusX/focusY in percent, zoom 1–3 |
| Detail → context | `camera.pull-back` | same focal point and zoom; lands at neutral framing |
| Related detail → detail | `camera.focus-travel` | fromX/fromY → focusX/focusY at a fixed zoom |
| Product plane → readable front view | `camera.oblique-glide` | direction, angle 0–35°, travel 0–20%; use a stage with margins |

For the first three, the transformed world must equal the fixed `overflow:hidden` viewport in width/height. The compiler clamps focal framing to keep its edges covered; captions and headers stay outside. Use non-overshooting easing. A target ID alone does not establish this geometry: inspect bounds before applying. For a longer journey, use adjacent explicit waypoint segments with matching boundary poses, not simultaneous transforms. A pull-back begins at its stated close-up pose; do not drop it onto an unrelated wide shot and create a jump. For spatial parallax use independent depth planes (for example the native device-carousel), not one flattened image with a 3D label.

Scene-boundary reveals reuse `transition.depth-push`, `transition.diagonal-slice`, `transition.lens-focus`, and `transition.split-wipe` from the same animation library. These are incoming-scene effects, not automatic overlapping two-scene crossfades; the host owns visibility, order and timings. Do not reinstall removed opening/ending/transition components.

## Beat grammar

- **Establish:** show enough of the world to establish direction, scale, and starting point.
- **Develop:** move through ordered waypoints; settle briefly at each one while its relevant detail changes.
- **Land:** decelerate into the destination and keep the final relationship legible.

## Execution contract

Animate one camera wrapper or one coherent viewBox at a time. Record each waypoint as a separate beat with the same world target plus its active annotation. Prefer position and scale changes that keep the next waypoint inside the viewer's inferred direction. Reset orientation explicitly before a large directional reversal.

Choose framing from the shot's job before choosing an effect: overview to detail for evidence, detail to overview for context, a pan between related points for continuity, or a locked frame when the subject already moves. Reuse the mapped component's camera path and existing animation presets; do not add a second camera runtime. Scene structure remains a component, reusable movement remains an animation, and the storyboard selects and times them.

Use a fixed clipped viewport with one inner camera/world wrapper. Keep captions and persistent chrome outside that transform; keep subject-attached annotations inside. Frame the actual target bounds, cap zoom at readable source resolution, and check all waypoints for exposed canvas edges. Do not fake depth by moving foreground and background together or add orbit merely for novelty. Land before a critical caption or effect needs attention. Sound cues reinforce a meaningful arrival or reveal, not every interpolation frame.

Every move must reveal information unavailable at the previous framing. A camera move may bridge a short spoken pause, but no uninterrupted travel lasts more than three seconds without a waypoint or information change. Respect reduced-motion output by replacing deep travel with deterministic focus transfers.

## Acceptance

- Direct seeks show a stable start, at least one meaningful waypoint, and the intended destination.
- The viewer can infer where the camera came from and why it stopped.
- Labels remain attached to their subjects and do not drift during transforms.
- The Land frame is sharp, readable, and not mid-pan or mid-zoom.
