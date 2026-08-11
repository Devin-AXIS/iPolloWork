# Task 1 Report: Reference Core Types, Quality, Chunking, Compression, and Prompt Pack

## Scope

Implemented the pure TypeScript reference-context core under `apps/app`:

- `src/react-app/domains/session/references/types.ts`
- `src/react-app/domains/session/references/quality.ts`
- `src/react-app/domains/session/references/chunking.ts`
- `src/react-app/domains/session/references/compression.ts`
- `src/react-app/domains/session/references/prompt-pack.ts`
- `tests/reference-ingestion.test.ts`

No project-specific runtime state, extractors, or UI integration were added.

## Implemented behavior

- Added the reference domain types and prompt-pack option contracts.
- Added PDF renderer metadata cleaning, duplicate-line removal, readable-text checks, noise detection, and repeated-line quality classification.
- Added deterministic token estimation and stable source-based chunk IDs.
- Added deterministic topic-based chunk selection and summary generation.
- Added quality-filtered prompt packing with summary, excerpt, per-file, and total-character budgets.
- Kept prompt packing limited to high- and medium-quality references and emits the required exclusion warning.

The chunker preserves all input text while splitting oversized blocks into complete fixed-size chunks; this is a small robustness improvement over the abbreviated example in the brief and does not alter the specified test behavior.

## TDD evidence

1. Added the verbatim test intent from the brief before creating the reference modules.
2. Ran the mandated command while modules were absent. It failed with `Cannot find module .../references/quality`, confirming the expected red state.
3. Added the five implementation modules.
4. Re-ran the mandated command successfully.

## Verification

Command:

```text
pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
```

Result: 5 pass, 0 fail, 18 assertions.

Additional command:

```text
pnpm.cmd --filter @ipollowork/app typecheck
```

Result: exit code 0.

`git diff --check` also completed with no output or errors for the task files.

## Worktree handling

The worktree contained unrelated pre-existing modifications and untracked files before this task. They were not reverted, reset, staged, or included in the task commit.

## Commit

The six task files were committed in one commit:

`823d39f6 feat: add reference context core`

The commit hook printed `Can't find lefthook in PATH`; no hook checks ran because that tool is not installed or available in the environment. Focused tests and app typecheck were run directly and passed.

## Remaining Review Finding Fix

Clamped configurable reference-context budgets to the hard ceilings while preserving smaller caller budgets, including zero, one, and two:

- Per-file summary: 1200 characters.
- Per chunk: 1200 characters in chunking and compression selection.
- Chunks per file: 8.
- Total prompt pack: 12000 characters.

Added regression coverage proving oversized values such as 5000, 100, and 50000 cannot bypass those ceilings.

Verification:

```text
pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
10 pass, 0 fail, 28 expect() calls

pnpm.cmd --filter @ipollowork/app typecheck
exit code 0
```

## Review Fix Report

Fixed the Task 1 review findings:

- Normalized `maxChunkChars` to a finite minimum of one so zero or invalid chunk budgets cannot create a non-terminating loop.
- Updated compression and prompt-pack truncation so returned strings never exceed their caps, including caps of zero, one, or two characters and `maxTotalChars`.
- Added boundary coverage for `maxChunkChars: 0`, `maxSummaryChars: 0`, and `maxTotalChars: 0`.

Verification:

```text
pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
8 pass, 0 fail, 22 expect() calls

pnpm.cmd --filter @ipollowork/app typecheck
exit code 0
```

## Remaining Task 1 Review Findings

Fixed the remaining budget-ceiling issues:

- Prompt-pack summary and chunk truncation remain capped at 1200 characters, while final total prompt truncation can use up to 12000 and still honors smaller values.
- Direct `selectReferenceChunks` callers now clamp `maxChunks` to the hard ceiling of 8 per file.
- Added regression coverage for `maxChunks: 100` and for a sufficiently large prompt pack exceeding 1200 while remaining within 12000.

Verification:

```text
pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
11 pass, 0 fail, 30 expect() calls

pnpm.cmd --filter @ipollowork/app typecheck
exit code 0
```
