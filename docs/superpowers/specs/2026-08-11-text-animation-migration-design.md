# Faithful Caption Effects to Text Animation Migration

## Goal

Move 13 reusable caption effects into `Animation > Text Animation` while preserving the visible behavior of their deleted registry implementations. The migration is successful only when the selected-text result matches the old effect's structure, timing, and visual identity and remains editable through the current animation property model.

The deleted implementations at commit `16fd0b9b4bbf57493c4a7cf3a7004f3aae429982^` are the behavioral source of truth. The current single-target approximations are not acceptance references.

## Scope

Faithfully migrate:

- `caption-highlight`
- `caption-matrix-decode`
- `caption-gradient-fill`
- `caption-neon-glow`
- `caption-neon-accent`
- `caption-glitch-rgb`
- `caption-clip-wipe`
- `caption-blend-difference`
- `caption-weight-shift`
- `caption-texture`
- `caption-kinetic-slam`
- `caption-emoji-pop`
- `caption-particle-burst`

Keep caption-timing and caption-layout effects caption-specific: `caption-pill-karaoke`, `caption-word-pulse`, `caption-phrase-lift`, `caption-mask-reveal`, `caption-editorial-snap`, and `caption-editorial-emphasis`.

`caption-parallax-layers` remains removed as previously confirmed.

## Fidelity Contract

Each migrated preset must satisfy all of the following:

1. The old registry component and demo are the visual oracle.
2. Structural mechanisms are preserved where they create the effect: word/character splitting, background layers, cloned color channels, particle nodes, masks, and texture assets must not be replaced by a generic flash, scale, blur, or shadow approximation.
3. The effect operates on the user's selected text rather than inserting a separate caption composition.
4. Preview and saved playback execute the same compiled recipe.
5. Applying, editing, replacing, or removing an effect leaves the original text content and unrelated authored children intact.
6. Generated helper nodes are tagged, deterministic, and removable. Reapplying an effect must not accumulate wrappers or particles.
7. Variable-bound text remains editable. When its value changes, generated word/character structure is rebuilt from the new value without losing the animation.
8. Existing common controls remain available: speed/duration, loop, unit, stagger, direction, intensity, colors, and effect-specific bounded parameters.

## Why the Current Model Is Insufficient

The current `CompiledMotion` model targets one selector with one CSS keyframe sequence. Twelve of the 13 old effects create auxiliary DOM or coordinate several targets. Reducing them to a single target removes the behavior that identifies the effect. For example, the old Highlight scales a separate red background layer behind each word; animating the text element's `backgroundColor` can only flash the entire text box.

The solution is a typed structured-text recipe extension to the existing GSAP motion pipeline. This is an extension of the current engine, not arbitrary user script execution and not a return to standalone caption compositions.

## Structured Text Recipe Model

A motion preset may continue compiling to ordinary keyframes or opt into a structured text recipe. A structured recipe declares:

- Split mode: whole text, words, or grapheme characters.
- Generated layers: background, text clone, accent clone, mask, particle container, or texture layer.
- Timeline tracks: target layer, keyframes/tweens, relative timing, stagger, repeat, and cleanup.
- Deterministic runtime data: seeded glyph sequences, particle positions, and particle counts.
- Asset dependencies: registry-owned texture files copied or referenced through a stable project path.

Core owns recipe validation and compilation. Studio preview executes the compiled recipe against the selected element. Studio Server persists the same recipe as generated setup plus GSAP timeline code and stores the semantic motion metadata needed for later editing.

No preset may inject free-form JavaScript. Recipe kinds, layer types, properties, and limits are allow-listed and validated.

## Text Preservation and Lifecycle

Generated nodes use dedicated `data-ipw-motion-*` markers. Before applying or rebuilding a recipe, the runtime removes only generated nodes belonging to that motion instance. Removing the animation unwraps generated structure and restores the selected element's exact text value.

For variable-bound text, the source remains the variable value. The animation may split its rendered text, but variable updates trigger a deterministic rehydrate step. The implementation must not permanently force all variable-bound effects to `unit: whole`; effects whose original identity is per-word or per-character must retain that behavior.

## Effect Acceptance Matrix

| Preset | Required old behavior | Required structure | Editable parameters |
| --- | --- | --- | --- |
| Highlight | Red gradient bar expands left-to-right behind each word, white text remains readable, then the bar exits | Per-word text and independent background layer | unit, stagger, direction, highlight color, roundness, intensity |
| Matrix Decode | Characters cycle through seeded code-like glyphs and settle to the original text with green decode styling | Per-character nodes and deterministic glyph substitution | stagger, density, color, blur, intensity |
| Gradient Fill | Original animated gradient travels through the text fill with its old reveal/emphasis timing | Text mask/fill layer with animated gradient position | direction, primary color, accent color, intensity |
| Neon Glow | Original neon tube-like glow builds and settles without replacing the text with a generic shadow pulse | Text layer plus required glow layers | color, glow, intensity |
| Neon Accent | Original accent clone/highlight motion is retained separately from Neon Glow | Base text plus accent clone/layer | primary color, accent color, glow, intensity |
| RGB Glitch | Distinct red/cyan channel copies offset and snap with the original glitch rhythm | Base text plus RGB clone channels | density, displacement/intensity, blur, preserve readable |
| Clip Wipe | Words reveal through the original directional clipping mask and timing | Per-word wrappers with overflow/mask layer | unit, stagger, direction, intensity |
| Blend Difference | Original difference/invert blend treatment and timing | Blend-enabled text target or clone where required | intensity, preserve readable |
| Weight Shift | Word weights change with the original sequential cadence | Per-word nodes; variable-font weight when supported | unit, stagger, minimum weight, maximum weight |
| Texture Fill | Real old texture fill/mask moves through the text | Text mask plus bundled texture asset/layer | texture choice where available, direction, density, intensity |
| Kinetic Slam | Original forceful word entrance/impact/settle sequence | Per-word nodes and original multi-stage transform timing | unit, stagger, direction, distance, intensity, preserve readable |
| Emoji Pop | Original emoji/character pop treatment and cadence | Emoji-aware grapheme nodes and any required accent layer | stagger, intensity |
| Particle Burst | Real particles emit around emphasized words and dissipate | Per-word anchors plus deterministic particle container/nodes | stagger, color, density, intensity |

Parameter ranges must be bounded. Defaults must reproduce the old demo before customization. Theme-derived colors may be offered, but the old palette remains the visual default when a theme color is not explicitly selected.

## Preview and Property Editing

Template thumbnails use the same recipe executor as the canvas preview with compact sample text. Selecting a template opens the existing animation properties surface. Common controls remain consistent across presets; effect-specific controls appear from the preset schema.

Changing a property rebuilds or patches the preview without duplicating generated layers. Confirming applies the same values to the saved recipe. Editing an already-applied preset round-trips all parameters and structural metadata.

## Persistence and Compatibility

Existing ordinary semantic motion presets continue using the current keyframe compiler unchanged. Structured recipes are opt-in per preset.

Current approximate instances using the same preset ids must remain readable. On the next edit or reapply, they are upgraded to the structured recipe. Removal must work for both old approximate instances and new structured instances.

## Verification

### Automated contract tests

- Recipe validation rejects unknown layers, properties, assets, and unsafe counts.
- Compilation is deterministic for identical text, parameters, and seed.
- Each preset produces the required split mode, layers, tracks, and bounded parameters.
- Apply, reapply, replace, and remove do not duplicate helpers and restore source text.
- Variable-bound text updates rebuild generated structure correctly.
- Existing non-structured presets remain unchanged.

### Visual regression tests

For every migrated effect, render the deleted demo and the new selected-text recipe at representative key times using the same text, dimensions, font, and parameters. Compare screenshots and motion-state assertions for:

- Layer presence and geometry.
- Direction and ordering.
- Color and blend treatment.
- Word/character cadence.
- Start, peak, settle, and exit states.

Tests must fail when an effect is replaced with a whole-box flash or another generic single-target approximation. Pixel thresholds may allow font rasterization differences but not missing layers or changed motion structure.

### Studio workflow tests

- Every migrated card previews in the template grid.
- Applying from the card, confirming properties, editing, and removing all succeed.
- The selected text remains selected and editable.
- Saved playback matches the property preview.

## Delivery Strategy

1. Add and verify the structured recipe pipeline with Highlight as the reference implementation.
2. Restore split/mask/fill effects: Matrix Decode, Gradient Fill, Clip Wipe, and Weight Shift.
3. Restore clone/blend effects: Neon Glow, Neon Accent, RGB Glitch, and Blend Difference.
4. Restore generated-layer and asset effects: Texture Fill, Kinetic Slam, Emoji Pop, and Particle Burst.
5. Run a final 13-effect visual comparison and Studio workflow pass.

Each stage requires focused tests and task-level review before the next stage begins. The migration is not complete while any card uses the current approximation instead of its old structural behavior.

## Non-Goals

- Redesigning unrelated Animation panel layout.
- Migrating karaoke, phrase pacing, or caption-card effects.
- Supporting arbitrary custom effect scripts.
- Preserving accidental old bugs that do not affect the visible effect.
- Treating a passing unit test as a substitute for visual equivalence.
