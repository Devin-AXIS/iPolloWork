# Faithful Task 1B Report

## RED

- Added focused Highlight assertions in `motionPresets.test.ts`.
- `compileMotionInstance()` returned no structured payload for `text.emphasis.highlight-sweep`.
- The catalog rejected the requested `speed` control because it was not in the parameter schema.

## GREEN

- Highlight now compiles to `caption-highlight.word-sweep`: independent `unit`, `background`, and `text` layers for each split unit.
- The default word recipe restores the legacy red gradient, 10px corners, red shadow, white text, brightness pulse, reveal, fade, and reset tracks.
- Direction, split unit, stagger, custom color, intensity, roundness, and speed are compiled into the structured recipe.
- The previous whole-text background keyframes are now a visual no-op; the future structured renderer is the sole visual source for Highlight.

## Files

- `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`
- `vendor/hyperframes/packages/core/src/motionPresetKeyframes.ts`
- `vendor/hyperframes/packages/core/src/motionPresets.ts`
- `vendor/hyperframes/packages/core/src/motionPresets.test.ts`

## Verification

- `bun x vitest run src/motionPresets.test.ts`
- `bun --filter @hyperframes/core build`
- `git diff --check`
