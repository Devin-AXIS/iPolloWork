# Task 5: Template Brief UI State Migration

## Status

Completed. Template reference UI state now uses `TemplateReferenceItem[]`; raw attachments are created only at submission time for items whose `sendOriginal` flag is enabled.

## Implementation

- Replaced legacy `ComposerAttachment[]` reference state in `TemplateBriefCard` with ingestion-backed `TemplateReferenceItem[]`.
- Uploads immediately add parsing rows, ingest supported files concurrently, show extraction status and quality, and autofill empty brief fields from high/medium-quality ingestion results.
- Added an explicit per-reference source toggle. It is off by default and disabled while parsing.
- `submitTemplateBrief` now writes ingestion metadata, adds the packed synthetic reference context to the prompt, and attaches only explicitly opted-in original files.
- Added English and Chinese labels for reference autofill, extraction states, and source-attachment opt-in.
- Added a regression test proving the default payload contains a context pack with no raw attachments, while opt-in produces the original attachment.

## Helper Isolation

The pure submit payload helper lives in `apps/app/src/react-app/domains/session/references/template-reference-submit.ts` and is re-exported from `session-page.tsx`. This minimal extra module was necessary because importing `session-page.tsx` under Bun evaluates a Vite-only `import.meta.glob` dependency through the design panel. The test imports the isolated helper and the page retains the requested exported API.

## Verification

Passed:

```text
pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/template-brief.test.ts tests/reference-ingestion.test.ts
43 pass, 0 fail

pnpm.cmd --filter @ipollowork/app typecheck
tsc -p tsconfig.json --noEmit (exit 0)
```

The test command emits existing PDF extraction warnings but has no failures.

## Concern

Running `template-brief.test.ts` alone reaches an existing DOCX test environment dependency (`DOMParser`), whereas the required combined command loads the reference-ingestion environment first and passes. No production behavior is affected.

---

# Task 5 Review Fixes

## Changes

- Reference completion now reconciles results against a synchronous mirror of the current reference list. A reference removed while parsing is excluded from both state updates and brief autofill.
- Each ingestion is isolated with `try/catch`; a malformed supported file changes from `parsing` to `failed` and shows a warning without blocking the rest of the batch.
- Original image attachment preview URLs are revoked after the direct draft dispatch in a `finally` block, including dispatch and workspace-write errors. Partial attachment preparation also cleans up any previews it already created.

## Tests

- Added a pure helper regression test for revoking only attachment preview URLs that exist.
- UI timing behavior is kept in `TemplateBriefCard` rather than extracted solely for testing; its state mirror makes removal visible before any asynchronous ingestion completion is applied.

## Verification

Passed:

```text
pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/template-brief.test.ts tests/reference-ingestion.test.ts
44 pass, 0 fail

pnpm.cmd --filter @ipollowork/app typecheck
tsc -p tsconfig.json --noEmit (exit 0)
```
