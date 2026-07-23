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

## Final review fixes

- A failed scoped Design request now preserves the raw composer draft and its selection chip, allowing a stale-revision failure to be retried. Ordinary drafts retain the existing clear-on-failure behavior.
- A draft may contain only one unique Design selection context; a repeated same-id chip normalizes to one context, while two different selected elements are rejected before synthetic instruction expansion or preflight.
- An idle turn that does not change the selected Design file now shows `No Design change was detected.` after its atomic completion claim, so it cannot create an undo point or duplicate its toast on repeated idle notifications.
- Ctrl/Meta wheel is intercepted and posted to the parent only for presentation canvases. Site and poster previews keep their normal browser/iframe wheel behavior.

### Final review verification

- RED baseline: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-composer.test.ts tests/design-ai-session-route.test.ts tests/design-html-runtime.test.ts` — 4 expected failures before implementation.
- Green suite: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-composer.test.ts tests/design-ai-session-route.test.ts tests/design-ai-selection.test.ts tests/design-html-runtime.test.ts tests/design-deck-navigation.test.ts tests/design-preview-height.test.ts tests/presentation-canvas.test.ts` — 52 passed, 0 failed.
- Type check: `pnpm.cmd --filter @ipollowork/app typecheck` — passed.
- Whitespace check: `git diff --check` — passed.

## Manual Electron validation

Not run in this headless task environment. The required manual path is: select title/image, send a narrow request through the Design chip, wait for idle refresh, use Design Undo, and verify protected slide roots still do not expose AI.

## Review fixes

- Design-selection expansion now validates every selection part against the target session and workspace before emitting a synthetic instruction. Missing, stale, foreign-session, and foreign-workspace parts reject the whole draft; duplicate ids are preflighted once.
- Scoped preflight and prompt submission run through one failure-cleanup helper. A read/write failure, prompt rejection, or prompt result error marks every selected context failed, including contexts already marked running.
- Store lifecycle now uses `pending -> running -> completing -> completed|failed`. `claimCompletion` is an atomic running-to-completing claim, so repeated idle notifications cannot produce parallel completion reads or duplicate undo checkpoints. Terminal contexts cannot be revived or overwritten by later failures.
- The Design panel requires the checkpoint context to match its active workspace before applying a completion refresh.
- Session deletion resets its Design AI contexts/checkpoints. This is the smallest production cleanup point in the allowed files; archiving intentionally preserves session state.
- The existing token parser is already centralized in `design-ai-selection.ts`; this task only consumes structured composer parts, so no duplicate token grammar was added.

### Review-fix verification

- RED baseline: focused Design tests failed for missing atomic completion claim, unguarded panel workspace refresh, foreign-token acceptance, and absent preflight/prompt cleanup.
- Focused corrected tests: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-session-route.test.ts tests/design-ai-selection.test.ts` — 15 passed, 0 failed.
- Full Task 4 suite: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-session-route.test.ts tests/design-ai-selection.test.ts tests/design-html-runtime.test.ts tests/design-deck-navigation.test.ts tests/design-preview-height.test.ts tests/presentation-canvas.test.ts` — 44 passed, 0 failed.
- Type check: `pnpm.cmd --filter @ipollowork/app typecheck` — passed.
- Whitespace check: `git diff --check` — passed.
