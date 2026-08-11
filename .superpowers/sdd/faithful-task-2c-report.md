# Faithful Task 2C - Server structured Highlight persistence

## Scope

- `vendor/hyperframes/packages/studio-server/src/routes/files.ts`
- `vendor/hyperframes/packages/studio-server/src/routes/motionPresets.test.ts`

## Implementation

- Compiles motion with the authoritative source text before materializing text DOM.
- Persists every structured Highlight track separately using its role selector, position, duration, keyframes, easing, and stagger.
- Uses keyframe easing only for structured tracks; no preset-level default ease is authored on those tweens.
- Gives every structured track a unique runtime GSAP id while keeping the same encoded MotionInstance data so phase replacement and removal remove the full set.
- Keeps ordinary character animations addressable inside structured Highlight text layers without nesting wrappers; word animations reuse the structured unit markers.
- Restores the original target DOM snapshot if any structured track writer fails.
- Rebuilds any remaining structured text motion after mutation; otherwise restores the source text before applying ordinary word/character splitting.

## Verification

- `bun.cmd --filter @hyperframes/studio-server test -- src/routes/motionPresets.test.ts` (12 passed)
- `bun.cmd --filter @hyperframes/studio-server typecheck`
- `bun.cmd --filter @hyperframes/studio-server build`
- `git diff --check`
