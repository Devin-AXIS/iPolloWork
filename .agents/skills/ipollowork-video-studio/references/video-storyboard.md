<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# iPolloWork Video Storyboard

Read for script, source coverage or narrative changes. Input is the confirmed brief/source and latest native storyboard; inspect the current entry only when existing frame identities, visible content or implementation constrain the requested change. Script-only work stops at the saved storyboard. Shared session boundaries are in [video.md](video.md); this phase does not load assembly, speech, soundtrack or final-render guides.

## Plan content and storyboard

1. Inventory source claims, steps, figures and qualifications once. In existing frame narrative keep `point ID → source heading/page/paragraph → frame(s)` → spoken or visibly explained evidence. Without source files trace brief requirements instead; never invent source anchors. Preserve names, numbers, units, causal relationships and meaningful parentheses/qualifiers. Record intentional omissions and unresolved source gaps. Preserve required facts and explicit user caps: an irreconcilable cap needs one user choice, not silent deletion or rushed speech.
2. Identify the driver: speech, dialogue, visible action, music, footage or silent reading. Create the audience change and observable event from the content first, then match executable recipe intent/input/capacity and motivated framing. Ordinary creation starts from the blank project; use a whole-film template only when explicitly selected. Write narration first for speech-led work; do not force it onto visual- or music-led work. Keep process dependencies readable; compare at matching viewpoints and scales; spatial travel serves spatial relationships. Decide readable holds before motion. A library match or attractive stock clip is not evidence of fit.
3. Check executable recipe intent, inputs and capacity only when that knowledge changes the proposed story; use the compact catalog guidance below. Bind events in causal/viewing order to subject/action, required input, result/hold and exact spoken phrases, dialogue turns, media moments, music cues or silent reading. Adjacent phrases may share a visual event; one sentence may span events. Record a compact provisional beat map for substantive shots, without making every clause a new animation.
4. Make one rough narration-duration estimate per shot, about 4 CJK characters or 2.5 Latin words per second plus purposeful reading holds; otherwise use action/media/reading time. Use a single counting calculation only when needed. Approximate targets are not strict caps. Do not calculate per-word, per-phrase or frame-accurate timestamps before synthesis, repeatedly adjust near-identical prose, draw SVG coordinates, write a JS/Python timeline builder or schedule arbitrary four-second motion cadences during drafting.
5. Save the complete native `STORYBOARD.md` with positive estimated durations and `status: outline` before media acquisition or production. Combine source/semantic and saved-format checks into one post-save review: re-read the source and saved storyboard for coverage, qualifiers, fit and readable holds. This is agent semantic self-review, not a deterministic parser or rendered-quality verdict. Reopen only affected shots when user edits, failed checks or measured media introduce evidence.
6. Continue automatically after the saved script into production. Pause only for an explicit script-review or script-only request; never repeat supplied confirmation. Script-only work saves the script without media generation or composition edits. Content determines scene count and duration; template examples are not quotas. Respect explicit maximums; do not add filler or omit content to match samples.

### Native editable script

Use the existing Studio `STORYBOARD.md`, not another JSON plan, document or independently edited transcript. Put whole-video settings in leading `---` frontmatter. Each shot field is a separate `- key: value` line under `## Frame N — Title`; no semicolons, translated keys or Markdown pipe tables. Do not put a code fence around the saved file. Keep extended direction/beat maps in narrative paragraphs after metadata. Omit unset optional fields rather than literal `omit` or `null`. Re-read the saved file: every frame needs non-empty `scene`, positive `duration` and its actual status.

Native parser example; save the content inside the fence, adapting facts and shots:

```markdown
---
format: 1920x1080
message: Turn an idea into a working team
audience: Independent founders
theme: ai-auto
music_prompt: Restrained instrumental pulse beneath narration
---

## Frame 1 — The idea takes shape
- scene: An idea card becomes a three-step plan; the focus moves to the first task.
- duration: 5s
- voiceover: One idea becomes the next clear step.
- camera: fixed:progressive-build
- transition_in: cut
- asset_source: code
- asset_brief: Editable idea and task cards; no external visual required.
- status: outline

0–1s establish the idea; 1–4s reveal and connect tasks; 4–5s hold the first action.
```

| Scope | Fields and meaning |
| --- | --- |
| Whole video | Audience, purpose, genre, format; `theme: "ai-auto"` derives direction while preserving Work tokens, or use the manually selected theme ID; `visual_style`; one supported `motionStyle`; `music_prompt` direction and the actual project-relative `music_asset`. |
| Shot | `scene`, `duration`, `transition_in`, `status: outline`; `voiceover` only for spoken text; `speaker` only when character/dialogue identity matters. `voice_id`, `voice_model`, `voice_name` select a library voice; `voice_id: auto` delegates authorized choice, empty inherits the project default. |
| Production | `camera` resolved to a concrete treatment (fixed/local reveal is valid; no final AI-decides/basic placeholder); `asset_source` = `auto`, `existing`, `search`, `generate`, or `code` for editable graphics; `asset_kind` = image/video or omitted for AI choice; `asset_brief`; `asset_origin` for source URL/attribution or illustration description; `asset_reference` for exact local project media; `sound_effects` for event/time and `sound_effect_reference` for exact local audio. `music` is a deliberate shot override. |
| Recipe | `recipe` = exact executable component ID; `recipe_intent` = why it serves this audience event; `scene_id` = exact installed scene ID. Custom shots omit recipe and use `custom_reason`. Mount/validation status is inspected from actual sources, never authored as a claim. |
| Narrative | Coverage, fit rationale/limits/alternative, Establish/Develop/Land, relative energy, provisional beats, handoff, asset reference roles, sound and QA sample positions. Keep this in frame prose rather than adding schema keys or another sidecar. |

The script table edits this same file. Read its latest saved version before applying; preserve pinned media/music/effects/voices. Row save/reorder alone does not rebuild the film. During generation/apply match existing frames by `src`, not prior row number; add `src` only for a real built subcomposition, never the whole root as every frame's source. Advance outline → built → animated only after implementation exists. Reuse existing `SCRIPT.md` for long narration when necessary; maintain one authoritative transcript. Replace estimates with measured speech/media timing before assembly.

Subject/fact corrections propagate through affected script, actual spoken audio, rendered text, imagery and captions. Regenerate changed narration, retime dependencies and preserve unrelated work. A corrected picture/logo with obsolete speech is incomplete; a favicon is branding, not requested product evidence.

## Planning capability check

Reuse known catalog choices. If a planned explanation depends on an uncertain executable capability, query `media/video_recipe_catalog` once for its narrative need/`recipeCategories`, with `limit <=20` and pagination only for missing results. Read returned intent/useWhen/avoidWhen, available inputs and capacity; note fitting IDs or a concrete no-fit. This is a feasibility check, not installation: do not read component implementation, full motion catalogs or synthesis interfaces before drafting. Full card/variant selection and mounting belong to Compose.

### Sequence templates

Choose a fitting structure from the content before detailed slots; the examples below are optional starting points, not mandatory templates. A sequence assigns narrative jobs, energy/rest and continuity; a recipe implements a job; a transition implements a boundary. Record genre-appropriate relative energy and information density (hook/orientation → development/evidence → resolution/requested action), sequence/justified adaptations in the first frame's notes and slot/handoff in shot narrative. Names alone do not supply missing capabilities or prove execution. Teaching prioritizes dependency order and reading time; factual work preserves context/evidence, and quiet stories need not end in a sales CTA. Avoid compulsory slow motion, fast travel or once-per-preset quotas across genres.

| Sequence | Slots and fit limits |
| --- | --- |
| promo-energy-arc | Identity/orientation → focal product → distinct features with readable rests → supported payoff/requested action. Merge optional slots for short/single-feature films; no mandatory sales CTA for teaching. |
| concept-to-application | Question → definition/boundary → example → useful contrast/misconception → practical takeaway. Not a mechanism simulation; avoid repeated definitions. |
| mechanism-to-test | Phenomenon → supported dependent mechanism → worked case → test/prediction with conditions → resolution. Preserve reading time; lists/correlation are not causality; unsupported branching/feedback/simulation is a real gap. |
| compare-to-decision | Common task/criteria → paired evidence → tradeoffs/limits → conditional choice. Keep scales/units/viewpoints consistent; no unsupported winner. |
| task-to-outcome | Goal/start → dependent actions → observable checkpoint → result → relevant recovery/next action. Required real UI evidence cannot be fictional cards. |
| claim-to-evidence | Context/question → attributed evidence → supported meaning → limitation/alternative → bounded conclusion. Evidence gets sufficient reading time; generated illustrations/testimonials/source names are not proof. |

Only promo-energy-arc adapts [Video Shotcraft promo-energy-arc](https://github.com/Vincentwei1021/video-shotcraft/blob/main/references/sequences/promo-energy-arc.md), reviewed 2026-09-29, Copyright 2026 Wei Yihao, [Apache-2.0](https://github.com/Vincentwei1021/video-shotcraft/blob/main/LICENSE). Modified for HyperFrames, content-led timing and executable local slots. Retain attribution and vendored license. Other sequences are iPolloWork patterns. For a fitting 30–60s promo, upstream orientation 8–12%, focal subject 12–15%, features 55–65%, close 13–16%, and 2–4 optional breath cards are starting ranges: normalize one actual allocation, counting breaths within it, never enforce them on narrated teaching.

Assign each required slot a takeaway, real input, executable recipe and observable landing. Merge/omit optional slots with reason; preserve required facts. Reserve reading/rest during rough drafting, then quantize measured final windows to project frames. Allocate by semantic complexity, native motion ratios and minimum hold, not equal shares. Incoming transitions consume Establish time; they add no duration or overlapping full-scene windows. Count reading once: visual holds do not create silence. Explicit duration conflict needs a choice or meaningful split, not invented cues.

For each incoming shot note outgoing result → continuation/comparison/topic/time/location change/closure → incoming subject → recognizable anchor or intended reset → treatment/window. Preserve supported position/scale/direction/comparison anchors. Use one supported treatment per seam; a truthful cut is valid. If needed, narrowly animate existing subjects in a seek-safe custom handoff rather than drawing replacement content. Avoid competing entrances, stacked transitions, empty fades or obscured final qualifiers. Review outgoing Land/boundary/incoming Establish together within the acceptance batch.
