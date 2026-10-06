# iPolloWork Local HyperFrames

This directory vendors the HyperFrames source used by iPolloWork's embedded
Video Studio iframe.

- Upstream: https://github.com/heygen-com/hyperframes
- Vendored from upstream HEAD: f3d21006633014fcb29b7a51571cd50ce832fed3
- License: Apache-2.0, retained in `LICENSE`

The iPolloWork desktop bridge starts `packages/cli/bin/hyperframes.mjs` from
this local checkout instead of downloading `hyperframes` with `npx`. The iframe
URL contract stays the same: `http://localhost:<session-port>/#project/<id>`.

To rebuild after changing Studio styles or UI:

```bash
cd vendor/hyperframes
bun install --frozen-lockfile
bun run build:local-studio
```

The local build intentionally targets the Studio/CLI path used by iPolloWork.
Repository docs, release plans, examples, and other upstream-only materials are
not vendored here.

## Motion capabilities and ownership

The public OneTake motion taxonomy was reviewed at
[`cf09bde`](https://github.com/feitangyuan/onetake/tree/cf09bde3e392c9aa32c4157f80cdbe1fa556685e).
Its source, instructions and assets are not vendored. The implementations below
reuse HyperFrames and iPolloWork contracts; equivalent intent does not mean
identical trajectories, timings or a copied renderer.

| Reference capability | Existing owner and integration | Current coverage |
| --- | --- | --- |
| word rise, letter drop, pop, masked lines, typing, ticks, lift exit | `core/src/motionPresetKeyframes.ts`, `structuredTextMotion.ts`, recipe-specific text timelines | Existing editable text/unit motion and stable GSAP seeks; bounce-card now samples the shared real damped oscillator rather than fixed bounce poses. |
| flying screens, cursor, press, squash/contact, impact split | Native `device-carousel`, `browser-walkthrough`, `flowchart-vertical`, text kinetic/particle tracks; GSAP Physics2D and MotionPath blocks | Reuse measured DOM paths, contact timing, deformation and ballistic motion. |
| container morph, gather and turning lockup | Existing `spatial-camera-suite` optional `container-morph` / `gather-lockup` | New: the same DOM card becomes its measured page rectangle; existing cards travel on staggered arcs into one shared cluster and growing ring. No scene swap masquerades as a morph. |
| iris, zoom-through, hop, ribbon and hard-cut words | Existing lens-focus/SDF iris transitions, camera push/focus presets, MotionPath, kinetic text/word-relay recipes | Reuse the appropriate distinct primitive. A wipe is not a container morph; a decorative shake is not a carried handoff. Keep a persistent subject where the story requires continuity. |
| operated camera, depth view/focus, whip, shake, deliberate drift, lattice | Camera presets, `spatial-camera-suite`, shader transitions, existing grid/depth planes | New optional `subject-follow-track` computes one camera from the moving featured card's actual layout. Original five shots and default remain unchanged. Existing per-plane depth/blur and deterministic shake remain available. |
| world/screen projection, tracked travel | Runtime DOM rectangles and camera transforms, runtime review carrier observations | Observe actual projected geometry. Do not infer a carried boundary or visual meaning merely from changing pixels. |
| native spring, magnetic return, precomputed mechanisms | `parsers/src/springEase.ts`, existing GSAP physics/path infrastructure | New shared `sampleSpringEase` reuses the existing oscillator; CustomEase, bounce-card and magnetic-snap share it. Critical damping and adjustable overshoot are supported. Sampled segments use linear timing, avoiding a second default easing over the physical curve. |
| light field, ripples and living material | Existing `shader-transitions` domain-warp/ripple/light-leak and `vfx-liquid-background` | Reuse real WebGL distortion and material waves. These are alternative light/material primitives, not an assertion that a wave shader reproduces the reference's silk noise. CSS depth blur is not temporal shutter blur. |
| continuous belt with a slowing internal clock | Existing `device-carousel`, optional `carouselMode=flow-belt` | New: a bounded analytic velocity integral drives the belt and its interior motion, so both accelerate/decelerate and stop together. Offscreen wrap is discrete; it never interpolates through the visible frame. Default `depth-tour` stays unchanged. |
| soft-body jelly / Verlet ropes | Existing extensible GSAP/timeline authoring path | Not made a mandatory runtime or a universal effect: these are material-specific simulations requiring actual attachment/shape input. Existing ballistic/path and spring motion cover current reusable UI/card needs. Do not claim a jelly or rope simulation from those substitutes. |

`data-ipw-carrier` identifies actual persistent subjects. Only an explicitly
required continuity boundary is evaluated as carried; cuts and readable holds
remain valid. The owning registry manifest supplies camera choices to Work's
component checker, so the host no longer duplicates its enum.

The executable `video-camera-direction` flow checks actual installed components,
all eight spatial variants in both themes, card/page geometry, gathered original
objects, shared belt clock, real serialized spring samples, reverse seeks,
local-image parameters and the existing nested export clock. Catalog/source
availability by itself is not end-to-end generation quality proof.

## Production integration and verification

| Capability | Existing owner and contract | Verification / boundary |
| --- | --- | --- |
| Measured reference rhythm | Work `video_reference_analyze` reads local video with ffprobe and bounded low-resolution decoded frames/audio. | Reports real cadence, still intervals, activity and audio peaks; it does not label pixel changes as optical flow, semantic quality or shutter smear. Full-frame sampling is bounded to 30 seconds / 1,024 frames. |
| Persistent subjects and deterministic seeking | `video-render.ts` and Studio runtime screenshot review observe actual DOM identity, rectangles, transforms and visibility. | Only `data-ipw-continuity="required"` demands a carried subject. Ordinary cuts and reading holds remain valid. Direct/reverse state comparison covers DOM state, not Canvas/WebGL pixels. |
| Temporal motion blur | Existing core subframe seek, engine capture and producer render paths; optional `motionBlur: true`. | Four samples across a 180-degree exposure are averaged in linear light with premultiplied alpha. Holds and cut boundaries stay crisp. Normal editing seeks are unchanged. HDR and transparent shader combinations are explicitly rejected; SDR shader composition is supported. |
| Exact export settings | Existing Work render input and Studio/CLI adapters pass fps, aspect-preserving resolution and motion blur to the producer. | Actual Studio API export is decoded at 3840×2160 / 60 fps. Authored CSS size and output pixel ratio are applied once. A receipt distinguishes requested settings from measured output. |
| Event sound and shared acoustic space | Work `video_soundtrack_prepare` generates separate editable WAV clips or processes local licensed assets, with event strength, position and a common room tail. | Speech and event windows drive one bounded music-volume envelope through the existing GSAP timeline and native mixer. No new player, transport or audio service. Source provenance remains in the storyboard. |
| Language variants of one composition | Work `video_language_timing_prepare` validates exact narration files, ordered measured word sidecars and explicit phrase pairs. A composition-local film wrapper maps its paused visual author timeline and native children; narration stays at normal speed. | Source-language identity, direct/reverse pixels, suppressed/parent seeks, camera callbacks and zero-duration event counts are checked. Caption and sound windows use the same anchors. Native proof uses measured local TTS chunk fixtures, not a new live provider alignment call or a listening review. |
| Product UI and creative selection | Video plugin compose/storyboard references reuse actual supplied captures, real browser views and editable native components. | Concepts follow content and design variables; templates are optional. A fake button animation is not evidence that the real product works. Read only the references needed for the current stage. |

OneTake is a reference for capabilities, not a runtime dependency. Its upstream
license is PolyForm Noncommercial 1.0.0; no upstream implementation, instruction
text or assets are included. Owning plugin references and checked distribution
copies use the same content. The host exposes validated tools; creative rules
stay inside the video plugin.

Nine native relationship/data recipes had two competing opacity writes at
time zero. Their generic transform reset now leaves opacity to each target's
own tween. Cold seeks, reverse-to-zero and event callbacks are tested; their
established middle/end frames remain pixel-identical. Both PNG and JPEG
screenshots use CSS clip dimensions and viewport DPR once, including a reused
probe session. Rebuild the bundled CLI after engine/producer changes: its
embedded capture code is the actual desktop renderer.

Local proof artifacts are under `evals/results/onetake-capabilities-2026-10-03/`,
`onetake-motion-capabilities-2026-10-03/`, `onetake-reference-quality-20261003/`
and `video-onetake-absorption-2026-10-03/`. They cover render, runtime and helper
behavior; they do not establish a fresh GPT-generated film's artistic quality.
