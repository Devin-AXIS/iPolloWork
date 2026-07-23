# Task 4 report — scoped Design AI lifecycle

## Implemented

- `design-selection` composer parts now become a synthetic, element- and file-scoped agent instruction while preserving normal user text parts.
- Before a scoped prompt is queued, the route reads the selected file, rejects a stale revision, writes the captured pre-image using the current revision, and marks the context running.
- `promptAsync` remains enqueue-only. Session idle status triggers the post-turn file read, then records either a completed checkpoint with post-agent HTML/revision or an unchanged completion without an undo checkpoint.
- Completion is idempotent so repeated idle delivery cannot create duplicate checkpoints.
- The Design panel observes the active file's completed checkpoint, updates its preview/cache, and keeps local canvas history ahead of persistent AI undo.
- Persistent AI undo validates the agent post-image, writes the pre-image with `afterUpdatedAt`, re-reads the restored file, then removes the checkpoint. Revision/content conflicts retain the checkpoint and show the requested reload guidance.

## Tests and checks

- Initial RED run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-session-route.test.ts tests/design-ai-selection.test.ts` — 5 expected failures before implementation.
- Final focused regression run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-session-route.test.ts tests/design-ai-selection.test.ts tests/design-html-runtime.test.ts tests/design-deck-navigation.test.ts tests/design-preview-height.test.ts tests/presentation-canvas.test.ts` — 40 passed, 0 failed.
- Type check: `pnpm.cmd --filter @ipollowork/app typecheck` — passed.
- Whitespace check: `git diff --check` — passed.

## Manual Electron validation

Not run in this headless task environment. The required manual path is: select title/image, send a narrow request through the Design chip, wait for idle refresh, use Design Undo, and verify protected slide roots still do not expose AI.
