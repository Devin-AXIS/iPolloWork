# Core Video Layout Guide

Read `../core-v1-index.md`, the video rules and `catalog.md`, then open only fitting HTML candidates. Public content/media policy remains in the shared guidelines; this guide owns video-specific layout mapping and motion considerations.

## Sources and fit

| Source | Provenance | Adaptation and motion considerations |
| --- | --- | --- |
| `statement-visual.html` | New scene-body implementation of the existing Motion Frames explanation recipe; not an additional original template scene | Map a claim to title/body and a useful asset or editable graphic to the visual slot. Change regions to fit actual imagery. Reveal the claim and visual coherently, with a stable reading interval. |
| `two-zone.html` | Extracted from the previous app-owned `core-v1-video.html` two-zone reference | Compare on common criteria with consistent visual emphasis. Reveal together or in narration order; keep both readable during the comparison. |
| `step-sequence.html` | New implementation of Motion Frames' documented sequence recipe | Map ordered actions to numbered headings/bodies. Scope highlights/reveals to the active scene; keep enough context to follow the sequence. Split phases if copy cannot fit. |
| `evidence-wall.html` | Adapted from the evidence-board scenes in `research-evidence-wall` | Let each source enter as a separate observation, then reveal the synthesis. Keep attribution attached to the evidence and never imply unsupported proof. |
| `relationship-map.html` | Adapted from the connected-factor scenes in `ai-trend-briefing` and `data-proof-story` | Use only meaningful relationships. Reveal the nodes in narrated order and keep the final relationship statement readable without relying on motion. |
| `timeline.html` | Adapted from the schedule and journey scenes in `automation-day-planner` and `course-journey` | Use when order and progression matter. Reveal one milestone at a time, while leaving prior context visible; do not turn the reference count into a duration requirement. |
| `checkpoint.html` | Adapted from the decision gate in `human-approval-branch` and the policy pause in `permission-vault` | Make ownership and the next decision explicit. Animate the gate only after the preceding state is understood; keep outcomes separate when they need different narration. |
| `waterfall.html` | Adapted from `cost-saving-waterfall` | Use for a baseline changed by additive or subtractive factors. Labels must share one unit and direction; if measures are unrelated, use `metric-scorecard` in slides or write a new scene. |
| `feature-orbit.html` | Adapted from the capability orbit in `feature-orbit` | Present a small set of capabilities around one promise. Keep cards short and equal in rank; choose `step-sequence` when the capabilities are dependent steps. |

Motion recipes are guidance to implement in the existing project timeline. Preview scripts only display fragments; they are not animation implementations. These sources do not include root composition, duration, audio, tracks or new GSAP registrations.

## Insert and adapt

1. Preserve the target scene wrapper and editor hooks. Copy only the candidate's template contents and scoped CSS, including needed `.ipw-video-layout` baseline selectors from `shared.css`.
2. Bind to the target theme; omit preview `:root`, body, main and script. Replace every sample, provide real assets and unique IDs, and update geometry after removing slots.
3. Compose for the active stage. The reference canvas is 1920×1080; other aspect ratios need deliberate recomposition, not viewport breakpoints or clipping.
4. Integrate entrances, readable holds, emphasis and exits through the existing timeline using scene-scoped selectors. Do not copy standalone preview code into the project.
5. Derive timing from actual content, narration and explicit user constraints. When timing changes, synchronize scenes, audio, captions, transitions and root bounds under the video rules.
6. Inspect visible frames before/after transitions and direct seeks; test playback, audibility and requested exports separately. A static preview cannot verify those claims.

Long Chinese headings and dense body text require measured fit with final fonts. Adjust proportions or split allowed scenes rather than shrinking every element. Preserve fixed-brand nodes and enough safe space for actual captions and overlays; the reference does not reserve a universal caption height.

## Selection rule

Prefer the indexed relationship that matches the content before reaching for a template-local scene. These nine references are a reusable starting set, not a whitelist: if no candidate preserves the meaning, write a new scene body in the active template's visual language and add it to the catalog only when the same structure is likely to recur. A local variation should stay local when it depends on one template's brand, asset treatment or one-off story.

## Verification scope

The `video-layout-library` flow renders all nine materialized sources at 1920×1080, then changes theme tokens and inserts a longer Chinese heading. Eighteen screenshot-backed frames check visible text bounds, theme inheritance and absence of composition/timing ownership. This does not verify arbitrary content, other stage ratios, animation, audio, Video Studio editing, real-model generation or export; check those on the actual video project.
