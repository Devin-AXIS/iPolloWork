# Faithful Task 1A Report

## Status

DONE

## Scope

Implemented only the generic structured-text motion foundation. No catalog entries or effect-specific recipes were added or changed.

## Commands And Results

- `pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts`
  - RED: failed as expected because `./structuredTextMotion` did not exist.
- `pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts src/motionPresets.test.ts`
  - GREEN: 2 files passed, 24 tests passed.
- `pnpm.cmd --dir vendor/hyperframes/packages/core build`
  - Initial build found a strict optional-particle narrowing error. Bound the optional particle spec before its callback.
- `pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts src/motionPresets.test.ts; pnpm.cmd --dir vendor/hyperframes/packages/core build`
  - Final verification: 2 files passed, 24 tests passed; Core build exited 0.

## Files

- `vendor/hyperframes/packages/core/src/structuredTextMotion.ts`
- `vendor/hyperframes/packages/core/src/structuredTextMotion.test.ts`
- `vendor/hyperframes/packages/core/src/motionPresets.ts`
- `vendor/hyperframes/packages/core/src/index.ts`
- `.superpowers/sdd/faithful-task-1a-report.md`

## Commit

`feat(motion): add structured text motion foundation`

## Self-Review

- `StructuredTextRole`, compiled track/output types, deterministic segmentation, seeded RNG, and validation helpers are exported.
- Roles, mutation properties, finite timing values, generated-node counts, particle count, and asset paths are allow-listed or bounded.
- `CompiledMotion.structured` is opt-in through `MotionPreset.structuredText`; existing presets remain on their ordinary keyframe path.
- Tests prove generic recipe compilation, invalid role/property/particle rejection, deterministic word/grapheme behavior, and that `element.enter.fade` remains unstructured.
- No changes were made to `motionPresetCatalog.ts` or any effect recipe.

## Review Fix Evidence

- RED: `pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts`
  - Exit 1. The 7-test file had 3 expected failures: non-primitive property/ease values were accepted, non-registry assets were accepted, and `segmentStructuredTextFallback` was missing.
- GREEN: `pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts`
  - Exit 0. 1 file passed; 7 tests passed.
- GREEN: `pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts src/motionPresets.test.ts`
  - Exit 0. 2 files passed; 26 tests passed.
- GREEN: `pnpm.cmd --dir vendor/hyperframes/packages/core build`
  - Exit 0. Core TypeScript build and generated-runtime steps completed.

## Review Fix Self-Review

- Keyframe values now reject all non-string/non-finite-number runtime values, and ease accepts only bounded allow-listed GSAP syntax.
- The exported deterministic fallback keeps combining marks, emoji modifiers, and ZWJ sequences in a single grapheme unit.
- Assets are capped at 8 paths of 256 characters, require the `registry/` prefix, and reject empty, absolute, scheme, dot-segment, and unsafe paths before copying.
- Empty text produces no generated particles; seeded particle output is covered by deterministic equality tests.
