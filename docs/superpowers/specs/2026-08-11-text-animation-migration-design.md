# Caption Effects to Text Animation Migration Design

## Goal

Move selected caption-focused visual effects into the existing Text Animation panel so users can select text or caption text and apply the effects as editable, parameterized animation presets.

## Context

The product currently has two related animation surfaces:

- Registry catalog caption effects under `librarySection: "caption-animation"`.
- Animation panel templates under `ANIMATION_TEMPLATES`, backed by core motion presets with `targetKinds`, parameter schemas, defaults, and generated keyframes.

The migration should make reusable text effects feel native to the Animation panel instead of behaving like catalog components. Effects that depend on spoken-caption rhythm or caption-card layout should remain caption-specific.

## Migration Scope

Migrate these caption effects into Text Animation templates:

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

Keep these as caption-specific effects for now:

- `caption-pill-karaoke`
- `caption-word-pulse`
- `caption-phrase-lift`
- `caption-mask-reveal`
- `caption-editorial-snap`
- `caption-editorial-emphasis`

Rationale: the kept set is more closely tied to spoken words, phrase pacing, subtitle bands, or caption-card layout. The migrated set is primarily text styling, reveal, emphasis, or kinetic typography that should work on selected text.

## User Experience

The user selects a text element or caption text content in the preview/editor area, opens Animation, selects Text Animation, then applies one of the migrated effects.

Migrated effects must appear as normal Text Animation cards, with the same disabled state behavior as existing templates when the current selection is incompatible.

The old catalog versions of migrated effects should no longer be the primary user path. They can be removed from `caption-animation` after their Text Animation equivalents are available and tested.

## Preset Model

Each migrated effect should become a core motion preset with:

- A stable id using the existing naming shape, for example `text.emphasis.highlight-sweep`.
- `targetKinds: ["text"]`, unless an effect is clearly safe for both text and generic elements.
- A phase of `enter`, `emphasis`, or `exit`.
- A parameter schema with bounded editable values.
- Defaults that produce a polished effect without user configuration.
- Generated keyframes in the core preset keyframe builder.

The Animation panel template should map one card to one preset id, plus template-level default parameters when needed.

## Required Editable Parameters

All migrated presets should use the existing parameterized animation style. Effects should expose only meaningful controls, not every internal value.

Shared parameters:

- `unit`: text split behavior. Use `whole`, `word`, or `character` where the effect supports split text.
- `stagger`: delay between words or characters, bounded between `0` and `0.3` seconds.
- `intensity`: normalized visual strength, bounded to a safe range.
- `duration`: controlled through the existing speed/duration workflow rather than ad hoc per-effect timing.

Color-driven effects:

- `colorSource`: `theme` by default, with `custom` support where the current parameter system supports it.
- `color`, `accentColor`, or `highlightColor`: only when the effect needs a user-selected custom color.
- `glow`: bounded glow strength for neon and light-based effects.

Directional effects:

- `direction`: `left`, `right`, `up`, or `down` for wipe, highlight, texture, and gradient movement where applicable.
- `distance`: bounded movement distance for kinetic effects.

Complex effects:

- `density`: particle, texture, or visual-noise amount.
- `blur`: bounded blur radius for decode, glow, glitch, and blend-style effects.
- `preserveReadable`: default true for aggressive effects such as glitch or kinetic slam.

## Effect Mapping

`caption-highlight` becomes a text highlight sweep. It should support `unit`, `stagger`, `highlightColor`, `direction`, `intensity`, and optional rounded highlight styling. It must work for normal text, not only active subtitle words.

`caption-matrix-decode` becomes a character decode reveal. It should support `unit: "character"`, `stagger`, `density`, `intensity`, and theme-aware color.

`caption-gradient-fill` becomes a gradient text fill or gradient sweep. It should support `colorSource`, `direction`, `intensity`, and optional split timing.

`caption-neon-glow` and `caption-neon-accent` become neon emphasis presets. They should support theme/custom color, `glow`, `intensity`, and readable defaults.

`caption-glitch-rgb` becomes a readable RGB glitch emphasis. It should support `intensity`, `blur`, `density`, and `preserveReadable`.

`caption-clip-wipe` becomes a directional text reveal. It should support `unit`, `stagger`, `direction`, and `intensity`.

`caption-blend-difference` becomes a blend or invert emphasis preset. It should support `intensity` and `preserveReadable`.

`caption-weight-shift` becomes a font weight emphasis preset. It should support `unit`, `stagger`, and `intensity`, and should degrade gracefully when the selected font has limited weight support.

`caption-texture` becomes a texture or masked fill emphasis. It should support `colorSource`, `direction`, `density`, and `intensity`.

`caption-kinetic-slam` becomes a kinetic type emphasis preset. It should support `unit`, `stagger`, `distance`, `intensity`, and `preserveReadable`.

`caption-emoji-pop` becomes a playful text emphasis if the selected text contains emoji or inline emoji spans. It should not require captions.

`caption-particle-burst` becomes a text emphasis preset with controlled particles or a particle-like fallback. It should support `unit`, `stagger`, `colorSource`, `density`, and `intensity`.

## Removal Policy

After a migrated effect has a Text Animation template, working core preset, tests, and acceptable preview behavior, remove the corresponding `caption-*` registry catalog item from `caption-animation`.

Do not remove retained caption-specific effects in this migration.

## Testing Strategy

Core preset tests should verify:

- New presets are discoverable by id.
- Parameter validation rejects unknown or unsafe parameters.
- Defaults are valid.
- Generated keyframes are deterministic and bounded.
- Text unit handling works for whole, word, and character where supported.

Studio tests should verify:

- Text Animation template count and ids include migrated effects.
- Migrated effects do not appear in the caption catalog after removal.
- Theme-aware templates default to `colorSource: "theme"`.
- Incompatible selections remain disabled.

Registry tests should verify:

- Caption-specific retained effects remain in `caption-animation`.
- Removed migrated effects are absent from registry manifests and `registry.json`.

## Non-Goals

- Do not redesign the whole Animation panel.
- Do not migrate caption karaoke, phrase pacing, or subtitle-card effects in this pass.
- Do not add unbounded free-form script editing for these presets.
- Do not introduce a new animation engine; keep using the existing GSAP-based preset pipeline.
