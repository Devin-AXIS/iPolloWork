# Video Studio component-to-motion map · core-v1

Use this index after selecting the scene's narrative job. It maps every registry block currently exposed to Video Studio to one primary temporal pattern. The mapping is a routing default, not a mandatory visual treatment: change the pattern when the actual content has a different narrative verb, and write a local treatment when none fits. Open only the chosen recipe and component source.

## Reading contract

- **Primary pattern** chooses the authoritative attention path. A component may support secondary motion, but it must not create a competing story.
- **Narrative capability overlays** form a many-to-many index below the primary table. They identify components that can implement `montage`, `camera-journey`, `dialogue`, `kinetic-type`, or `audio-reactive` when that overlay is the scene's actual primary narrative pattern.
- Selecting a component is an implementation decision, not visual inspiration. Install selected IDs through `media/video_component_install`, reference the returned composition, and retain `data-ipw-registry-component` plus `data-motion-pattern` in the host scene.
- **Typical phase** is a common placement, not a fixed sequence position. Content intent remains authoritative.
- **Seekable** means the registry manifest declares deterministic timeline seeking. **Legacy metadata** components may still animate, but must pass real-project playback checks before reuse.
- Preserve component editability, the active theme, narration timing, FPS boundaries, and one paused project timeline.
- This file must cover the exact current set of registry blocks whose manifest exposes the `video` surface. Coverage tests fail when a component is added, removed, or left unmapped.

## Executable motion routing

### Authored semantic recipes

Retained registry components with executable `motionRecipe` provide authored choreography. Choose by `recipeSummary.useWhen` and `avoidWhen`; inspect the selected manifest before installation.

Choose by the catalog's compact `recipeSummary.useWhen` and `avoidWhen`, then read only the chosen manifest or installation result once. Its `motionRecipe.usage` defines input rules, reading order, narration-to-event bindings, four failure fallbacks, a Chinese example and render acceptance. Examples demonstrate structure, not verified claims or mandatory scripts. Do not inject every recipe's full rules into the prompt. If the structure is inapplicable, choose another recipe or a justified custom scene. Supply optional `instances` to `video_component_install`: stable sceneId, selected componentId, start, duration, timingSource, and every real content variable. The host returns placeholder-free `instances[].snippet`; mount it unchanged. It does not overwrite index.html or existing edited components. Event IDs bind through `cueTimes` to measured scene-relative narration cues; the host serializes them into the existing variable protocol as motionCueTimes. Without measured audio, retain authored defaults and an honest visual/estimated timing source, never fabricate word alignment.

Keep events ordered with their authored action durations and final readable hold. Split oversized content instead of relying on a component's slicing behavior. A longer host must have meaningful events throughout, not a frozen extension. Missing local media, excess capacity, unknown values/events and conflicting cue windows are rejected. Pixel quality, audio alignment and source accuracy still require the existing real-render acceptance checks.

The component table chooses the scene body. It does not prove that motion covers a longer host scene. Bind every beat to one of these executable references and preserve the matching metadata in the saved HTML.

| Beat job | Animation reference | Typical preset choices |
| --- | --- | --- |
| Run the installed component's native sequence | `component:<registry-id>` | Limited to the component's recorded native duration |
| Bring in a new focal group | `preset:<preset-id>` | `element.enter.fade`, `element.enter.slide`, `element.enter.scale`, `motion.enter.content-reveal`, `motion.enter.gradual-focus`, `motion.enter.scan-reveal` |
| Shift attention inside an established scene | `preset:<preset-id>` | `element.emphasis.lift`, `element.emphasis.pulse`, `element.emphasis.tilt`, `element.emphasis.spotlight-card`, `element.emphasis.glare-sweep`, `motion.emphasis.soft-float`, `motion.emphasis.focus-tilt`, `motion.emphasis.magnetic-snap` |
| Emphasize a key phrase | `preset:<preset-id>` | `text.emphasis.highlight-sweep`, `text.emphasis.weight-shift`, `text.emphasis.kinetic-slam`, `text.emphasis.shiny-sweep`, `text.emphasis.true-focus` |
| Deliberately preserve a readable state | `hold:<reason>` | `hold:reading`, `hold:emphasis`, `hold:handoff`, `hold:outro`, `hold:media` |
| Express motion unavailable in the preset catalog | `custom:<specific timeline label>` | A finite, seek-safe timeline segment scoped to the listed targets |

Call `list_motion_presets` before choosing a preset and `mutate_motion` to apply it. The animated target must retain `data-ipw-animation-reference="<preset-id>"`. Do not write a preset name into the beat map without applying it. When a host lasts more than two seconds beyond a component's native duration, add a later preset/custom beat or shorten the host; an implicit frozen remainder fails acceptance.

### Incoming scene transitions

Full scene windows meet at one boundary. Every scene after the first uses one transition below at the beginning of the incoming scene and records `data-ipw-transition-in`, `data-ipw-transition-duration`, and `data-ipw-transition-intent` (`continue`, `topic-change`, `time-change`, `location-change`, `compare`, `reveal`, or `closure`).

| Transition | Duration | Use |
| --- | ---: | --- |
| `cut` | `0` | A deliberate immediate change with a visible incoming base state |
| `preset:element.enter.fade` | 0.35–0.8s | Quiet continuation or closure |
| `preset:element.enter.slide` | 0.45–0.9s | Directional continuation, time, or location change |
| `preset:element.enter.scale` | 0.35–0.75s | Focus change or reveal |
| `preset:motion.enter.content-reveal` | 0.6–1.2s | Structured topic change |
| `preset:motion.enter.gradual-focus` | 0.7–1.4s | Reveal from context into detail |
| `preset:motion.enter.scan-reveal` | 0.6–1.2s | Technical or analytical reveal |
| `preset:transition.depth-push` | 0.7–1.3s | Move from context into a deeper focal plane |
| `preset:transition.diagonal-slice` | 0.6–1.1s | Energetic chapter, time, or topic change |
| `preset:transition.lens-focus` | 0.7–1.3s | Reveal a subject from surrounding context |
| `preset:transition.split-wipe` | 0.6–1.2s | Directional handoff or explicit comparison |

Use the same transition for repeated continuity when that supports the story. Variety is not a quality target. Strong transitions belong only to real changes or reveals.

## Pattern summary

| Primary pattern | Default attention path | Recipe | Native components |
| --- | --- | --- | ---: |
| `progressive-build` | Reveal ordered ideas, layers, or a statement in meaningful beats. | [progressive-build.md](progressive-build.md) | 0 |
| `focus-transfer` | Move attention among peers while their relationship remains visible. | [focus-transfer.md](focus-transfer.md) | 3 |
| `path-journey` | Advance a route, workflow, dependency, or chronology. | [path-journey.md](path-journey.md) | 5 |
| `state-transformation` | Make a before/after, correction, resolution, or completion legible. | [state-transformation.md](state-transformation.md) | 1 |
| `data-accumulation` | Build quantitative evidence, rank, distribution, or signal over time. | [data-accumulation.md](data-accumulation.md) | 7 |
| `asset-exploration` | Guide attention through media, an interface, or a device. | [asset-exploration.md](asset-exploration.md) | 7 |
| `montage` | — | [montage.md](montage.md) | overlay |
| `camera-journey` | — | [camera-journey.md](camera-journey.md) | overlay |
| `dialogue` | — | [dialogue.md](dialogue.md) | overlay |
| `kinetic-type` | — | [kinetic-type.md](kinetic-type.md) | overlay |
| `audio-reactive` | — | [audio-reactive.md](audio-reactive.md) | overlay |

## progressive-build

Reveal ordered ideas, layers, or a statement in meaningful beats.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |

## focus-transfer

Move attention among peers while their relationship remains visible.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `device-carousel` | body | seekable | Visit three screen images with independent depth planes, focus transfers and an overview landing. |
| `interface-state-board` | body | seekable | Compare important UI states before a walkthrough. |
| `split-screen` | body | seekable | A balanced two-panel media layout for parallel stories, perspectives or before-and-after framing. |

## path-journey

Advance a route, workflow, dependency, or chronology.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `location-pulse-map` | body | seekable | A local-area map that reveals multiple named locations with proportional values and sequential signal pulses. |
| `map-flow` | body | seekable | A theme-aware origin-to-destination map story with a clear route, signal, and annotation. |
| `metro-network-map` | body | seekable | A multi-stop network map that draws weighted routes, reveals stations and moves a signal along the leading connection. |
| `route-map` | body | seekable | Theme-aware animated map route with a focused location and annotation contract. |
| `us-map-flow` | body | legacy metadata | Animated connection arcs between US cities over a base map — composable origin-destination flow visualization |

## state-transformation

Make a before/after, correction, resolution, or completion legible.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `media-before-after` | body | seekable | Compare two visual states with clear labels and context. |

## data-accumulation

Build quantitative evidence, rank, distribution, or signal over time.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `china-map` | body | seekable | A theme-aware China map with accurate province-level boundaries, a South China Sea islands inset, editable values, proportional markers, and a regional ranking panel. |
| `spain-map` | body | legacy metadata | Animated Spain choropleth by autonomous community with staggered reveals and gradient legend — D3 conic conformal projection |
| `territory-heat-map` | body | seekable | An abstract regional heat map that reveals local territories by intensity and emphasizes one selected region. |
| `us-map` | body | legacy metadata | Animated US choropleth map with staggered state reveals, value labels, and gradient legend — pure inline SVG with GSAP |
| `us-map-bubble` | body | legacy metadata | Animated US bubble map with proportional city markers, value callouts, and connection lines — composable with us-map |
| `us-map-hex` | body | legacy metadata | Animated hexagonal tile grid map — each state as an equal-weight hex with data fill and abbreviation label |
| `world-map` | body | seekable | A theme-aware world map with Natural Earth country boundaries, adjustable values, proportional markers, a selected market callout, and a compact ranking panel. |

## asset-exploration

Guide attention through media, an interface, or a device.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `browser-walkthrough` | body | seekable | A browser UI walkthrough with editable steps, selected state and deterministic cursor click. |
| `device-mockup` | body | seekable | A lightweight themed phone or laptop mockup with optional screen media. |
| `media-hero` | body | seekable | A cinematic media-first hero with a readable headline and optional image source. |
| `mobile-walkthrough` | body | seekable | A phone-focused UI walkthrough with editable task steps and a selected interaction state. |
| `picture-in-picture` | overlay / any | seekable | Place a supporting view over a primary media surface. |
| `screenshot-zoom` | body | seekable | Establish a real screenshot, push into an adjustable focal detail, hold and pull back. |
| `spatial-camera-suite` | body | seekable | A theme-aware layered interface stage with five selectable camera shot recipes. |

## Imported executable shotcraft recipes

These additional recipes retain their manifest-owned primary pattern and capacity rules. The family summary above counts native components; this table covers the imported Shotcraft recipes. Read only the selected recipe when fitting a shot.

| Component | Typical phase | Registry contract | Primary pattern | Intended use |
| --- | --- | --- | --- | --- |
| `shotcraft-card-stack` | body | seekable | `progressive-build` | Establish a collection of exactly eight real images or page slices; quantity first, diversity second. |
| `shotcraft-dolly-zoom` | body | seekable | `state-transformation` | 在真实素材上突出一个固定主体，背景膨胀形成一次戏剧性强调。 |
| `shotcraft-multiplane` | body | seekable | `state-transformation` | 展示真实页面、图像或空间层次，沿同一方向探索真实内容。 |

## Adaptation boundary

Do not force a component into its listed pattern when the user's content has another narrative verb. Prefer the closest component structure, select the correct temporal recipe separately, and extend the component's existing timeline. If no component fits, author a local scene and record `data-ipw-component-decision="custom:<specific structural reason>"`; visual preference or implementation convenience is not an exception. Run `media/video_component_check` before acceptance. Record a new catalog candidate only after repeated use and playback validation.

## Narrative capability overlays

These overlays are deliberately many-to-many. They do not duplicate registry components or override a component's spatial contract. When an overlay is the scene's narrative job, record that overlay as `data-motion-pattern`, follow its recipe, and retime or extend the selected component through the project timeline.

| Capability | Compatible component candidates | Boundary |
| --- | --- | --- |
| `montage` | `device-carousel`, `picture-in-picture`, `media-hero`, `split-screen` | Requires at least three intentional shot or focus changes; a grid shown all at once is not montage. |
| `camera-journey` | `screenshot-zoom`, `device-carousel`, `spatial-camera-suite`, `browser-walkthrough`, `mobile-walkthrough`, `device-mockup`, `route-map`, `map-flow`, `metro-network-map`, `location-pulse-map`, `us-map-flow` | Requires a continuous path with stable orientation and a motivated landing point; unrelated zooms do not qualify. |
| `dialogue` | `split-screen` | Requires timed turns and responses; a static collection of quotes is only `focus-transfer`. |
| `kinetic-type` | — | No built-in component remains for this pattern. Author a local text scene whose changes follow meaning and reading order. |
| `audio-reactive` | — | No built-in component remains for this pattern. A local scene qualifies only when measured speech, music, or media cues change its timeline. |
