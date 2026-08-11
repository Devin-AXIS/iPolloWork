# Faithful Task 2B - Studio structured text preview

## Scope

- `vendor/hyperframes/packages/studio/src/components/editor/SemanticMotionPanel.tsx`
- `vendor/hyperframes/packages/studio/src/components/editor/SemanticMotionPanel.test.tsx`

## Implemented

- Compile preview motions with the selected element's current text content.
- For structured text recipes, snapshot and materialize the text DOM, then create one GSAP track per structured role.
- Preserve per-keyframe easing without a top-level structured tween ease, apply per-track stagger, and use `timeline.set` for zero-duration reset tracks.
- Compile before creating the GSAP timeline and contain compilation errors without mutating the DOM or surfacing an effect error to React.
- Keep ordinary motion previews on their prior outer-element tween path.
- On cleanup, kill the preview timeline, clear transient structured-node styles, and restore the exact original DOM snapshot.

## Verification

- PASS: `packages/studio/node_modules/.bin/vitest.exe run src/components/editor/SemanticMotionPanel.test.tsx --reporter=verbose`
  - 13 tests passed, including Highlight per-word materialization, per-keyframe-only easing, reveal/exit/reset tracks, no nested wrappers, original node/style/attribute restoration, and safe rejection of more than 512 character units before timeline creation.
- PASS: `git diff --check`
- BLOCKED outside this task's allowed write scope: `bun.cmd run typecheck` reaches an existing unrelated error in `src/components/sidebar/BlocksTab.tsx:543` (`TS2367`, `caption-animation` comparison). No Task 2B file was reported by TypeScript.

## Git

- No `git add` performed.
- No commit created.
