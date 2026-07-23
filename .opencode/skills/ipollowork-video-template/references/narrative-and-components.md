# Narrative and components

- [Select a narrative architecture](#select-a-narrative-architecture)
- [Create a scene plan](#create-a-scene-plan)
- [Component families](#component-families)
- [Component contract](#component-contract)
- [Timing pattern](#timing-pattern)
- [Motion hierarchy](#motion-hierarchy)

## Select a narrative architecture

Choose a story before choosing effects.

| Video goal | Recommended scene sequence |
| --- | --- |
| product launch | Hook → Problem → Product → Features → Proof → CTA |
| feature demo | Problem → Operation → Result → Benefit → CTA |
| educational | Question → Definition → Example → Application → Takeaway |
| data proof | Claim → Metric → Trend → Insight → Source → Conclusion |
| brand film | Mood → Brand idea → Product world → Promise → Signature |
| announcement | Context → News → Key details → Date/action → CTA |
| single motion frame | One message → one visual idea → one exit or loop boundary |

Remove a scene when it has no unique job. Do not force every video into the product-launch sequence.

## Create a scene plan

Before coding, use a table like:

| ID | Purpose | Start | Duration | Component | Visible copy | Media |
| --- | --- | ---: | ---: | --- | --- | --- |
| `scene-hook` | earn attention | 0 | 2.8 | Title Scene | headline + eyebrow | abstract field |
| `scene-proof` | establish credibility | 2.8 | 4.0 | Metric Scene | metric + source | chart |
| `scene-cta` | close decisively | 6.8 | 3.2 | CTA Scene | CTA + brand | logo |

Confirm that a person can read the visible text during its scene. Reduce copy or extend time instead of accelerating speech.

## Component families

### Scene components

- Title / Hook Scene
- Problem Scene
- Feature Scene
- Device Demo Scene
- Metric / Data Scene
- Code Explainer Scene
- Quote / Testimonial Scene
- Chapter Scene
- CTA Scene
- Logo Outro

### Content components

- Headline and subtitle
- Eyebrow and section label
- Metric and source
- Chart and legend
- Code window and result
- Feature card
- Quote card
- Device frame
- Caption line
- Brand lockup

### Motion components

- Text reveal
- Number count-up
- Cursor or type-on
- Mask wipe
- Light leak
- Glitch
- Liquid field
- Particle field
- Device orbit
- Logo assembly

## Component contract

Define every reusable component with:

- name and narrative purpose;
- required and optional inputs;
- variable IDs and types;
- stable root selector;
- HTML structure and accessibility expectations;
- visual tokens;
- timeline entry and exit hooks;
- recommended duration and reading limits;
- supported aspect ratios;
- fallback when media or WebGL fails;
- allowed edits and locked internals.

Example:

```text
MetricScene
Purpose: prove one claim with verified data
Inputs: metric, metricLabel, insight, source
Root: [data-component="metric-scene"]
Duration: 3.5–5.0 seconds
Motion: count-up then reveal insight
Locked: chart scale math, source position, timeline hooks
Editable: values, labels, accent, optional supporting media
```

Start with this catalog inside the main Skill. Split a separate component Skill only when a component family has its own substantial workflow, validation, or tools. Good future candidates are captions, data visualization, product-device demos, and transition systems. Avoid one Skill per small DOM component.

## Timing pattern

For each scene, budget:

```text
entrance + readable hold + exit = scene duration
```

A common four-second scene may use:

```text
0.0–0.6 entrance
0.6–3.4 readable hold and internal motion
3.4–4.0 exit or transition
```

Use this as a starting heuristic, not a fixed formula. Narration duration and copy readability are authoritative.

## Motion hierarchy

1. Direct attention to the current message.
2. Establish continuity between scenes.
3. Add atmosphere after communication works.

Use one dominant motion idea per scene. Keep secondary motion quieter. Avoid stacking type-on, glitch, parallax, particles, and camera movement at equal intensity.

Prefer GSAP for required timeline motion. CSS may handle static styling and minor deterministic effects, but infinite CSS loops must not carry essential story state.
