# Reference Context Pack Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the post-merge hardening of reference ingestion while reusing the editable spreadsheet CSV/TSV parser.

**Architecture:** Move delimited parsing and serialization from the artifact spreadsheet model into a session-level shared module. Keep reference-specific sampling and budgets in the reference extractor, then close reviewed submission, multilingual, warning, and empty-context edge cases without restoring legacy attachment helpers.

**Tech Stack:** TypeScript, React, Bun tests, SheetJS for binary spreadsheets, existing iPolloWork session domains.

## Global Constraints

- Do not add a second CSV parsing dependency.
- Raw reference files remain opt-in attachments and are never persisted by default.
- CSV and JSON generated profiles must remain at or below 12,000 characters.
- Only `high` and `medium` ingestions participate in autofill and prompt context.
- Preserve latest `main` behavior: failed template package imports remain selected.

---

### Task 1: Shared Delimited Spreadsheet Parser

**Files:**
- Create: `apps/app/src/react-app/domains/session/spreadsheets/delimited.ts`
- Modify: `apps/app/src/react-app/domains/session/artifacts/artifact-spreadsheet-model.ts`
- Modify: `apps/app/src/react-app/domains/session/references/extractors/table.ts`
- Modify: `apps/app/scripts/artifact-spreadsheet.test.ts`
- Modify: `apps/app/tests/reference-ingestion.test.ts`
- Modify: `apps/app/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `parseDelimitedSpreadsheet(content: string, delimiter: string): string[][]`
- Produces: `serializeDelimitedSpreadsheet(rows: string[][], delimiter: string): string`
- Consumers: artifact spreadsheet editing and reference CSV profiling.

- [ ] **Step 1: Add failing shared-parser coverage**

```ts
test("parses quoted delimiters, escaped quotes, and embedded newlines", () => {
  expect(parseDelimitedSpreadsheet('name,notes\nAlice,"line 1\nline 2"\nBob,"said ""hi"""\n', ",")).toEqual([
    ["name", "notes"],
    ["Alice", "line 1\nline 2"],
    ["Bob", 'said "hi"'],
  ]);
});
```

- [ ] **Step 2: Run the parser and reference tests to verify failure**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate scripts/artifact-spreadsheet.test.ts tests/reference-ingestion.test.ts -t "quoted"`

Expected: FAIL until the shared exports exist and reference profiling uses them.

- [ ] **Step 3: Extract the existing state machine**

```ts
export type SpreadsheetRows = string[][];

export function parseDelimitedSpreadsheet(content: string, delimiter: string): SpreadsheetRows {
  // Move the existing quote-aware state machine here unchanged.
}

export function serializeDelimitedSpreadsheet(rows: SpreadsheetRows, delimiter: string): string {
  // Move the existing quote-aware serializer here unchanged.
}
```

Update both consumers to import these functions. Remove `papaparse` and `@types/papaparse` from the app and lockfile.

- [ ] **Step 4: Verify both consumers**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate scripts/artifact-spreadsheet.test.ts tests/reference-ingestion.test.ts`

Expected: both suites pass, including embedded-newline CSV coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/react-app/domains/session/spreadsheets/delimited.ts apps/app/src/react-app/domains/session/artifacts/artifact-spreadsheet-model.ts apps/app/src/react-app/domains/session/references/extractors/table.ts apps/app/scripts/artifact-spreadsheet.test.ts apps/app/tests/reference-ingestion.test.ts apps/app/package.json pnpm-lock.yaml
git commit -m "refactor: share delimited spreadsheet parsing"
```

---

### Task 2: Bound Structured Data and Original Attachments

**Files:**
- Modify: `apps/app/src/react-app/domains/session/references/extractors/table.ts`
- Modify: `apps/app/src/react-app/domains/session/references/ingestion.ts`
- Modify: `apps/app/src/react-app/domains/session/references/template-reference-submit.ts`
- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx`
- Modify: `apps/app/tests/reference-ingestion.test.ts`

**Interfaces:**
- Produces: `canSendOriginalReference(file): boolean`
- Preserves: `buildTemplateReferenceSubmitPayload()` never rejects merely because an oversized item retained stale opt-in state.

- [ ] **Step 1: Add failing limits tests**

```ts
expect((await extractTableReference(largeJsonFile)).text.length).toBeLessThanOrEqual(12_000);
expect((await buildTemplateReferenceSubmitPayload([oversizedOptIn])).attachments).toEqual([]);
```

- [ ] **Step 2: Run limits tests to verify failure**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts -t "bounds|attachment limit"`

Expected: FAIL against unbounded JSON and unconditional source attachment preparation.

- [ ] **Step 3: Implement recursive JSON sampling limits**

Cap sample depth at 4, node count at 240, string values at 240 characters, and total profile output at 12,000 characters. Cap CSV sample cells at 500 characters and the complete profile at 12,000 characters.

- [ ] **Step 4: Enforce source attachment eligibility**

```ts
export function canSendOriginalReference(file: Pick<File, "name" | "type" | "size">) {
  return file.size <= REFERENCE_MAX_BYTES && isReferenceFile(file);
}
```

Use the helper in both submit payload construction and the UI toggle disabled state.

- [ ] **Step 5: Run limits tests and commit**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts`

Expected: PASS.

```bash
git add apps/app/src/react-app/domains/session/references apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/tests/reference-ingestion.test.ts
git commit -m "fix: bound structured reference ingestion"
```

---

### Task 3: Multilingual Autofill and Recoverable UI Feedback

**Files:**
- Modify: `apps/app/src/react-app/domains/session/references/brief-autofill.ts`
- Modify: `apps/app/src/react-app/domains/session/references/compression.ts`
- Modify: `apps/app/src/react-app/domains/session/references/prompt-pack.ts`
- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx`
- Modify: `apps/app/src/i18n/locales/en.ts`
- Modify: `apps/app/src/i18n/locales/zh.ts`
- Modify: `apps/app/tests/reference-ingestion.test.ts`
- Modify: `apps/app/tests/template-market-actions.test.ts`

**Interfaces:**
- `labelValue()` recognizes ASCII and full-width colons and escaped English/Chinese labels.
- `packReferenceContext()` returns empty prompt text when no file passes quality gates.
- Each weak/failed row displays its first warning; submit failures keep the brief visible and show localized feedback.

- [ ] **Step 1: Add failing multilingual, warning, and empty-pack tests**

```ts
expect(inferTemplateBriefFromIngestions([chineseReference])).toMatchObject({
  audience: "七病区护士",
  details: "展示风险、负责人和升级路径。",
});
expect(packReferenceContext([failedReference]).promptText).toBe("");
expect(sessionPageSource).toContain("reference.ingestion?.warnings[0]");
expect(sessionPageSource).toContain('t("templates.brief.submit_failed")');
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts tests/template-market-actions.test.ts -t "Chinese-labeled|rejected|warning|submit"`

Expected: FAIL until all four behaviors are implemented.

- [ ] **Step 3: Implement escaped multilingual labels and topic keywords**

Add `受众`, `目标用户`, `面向谁`, `需求`, `要求`, `关键信息`, `内容`, `范围`, `目标`, `背景`, `结论`, `交付物`, and `品牌`. Escape labels before constructing regular expressions and accept both `:` and `：`.

- [ ] **Step 4: Implement UI feedback and empty prompt behavior**

Return `promptText: ""` when no references are accepted. Show the first ingestion warning in the row with truncation/title support. Catch template brief submission failures, call `toast.error(t("templates.brief.submit_failed"), ...)`, and retain the brief state.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts tests/template-brief.test.ts tests/template-market-actions.test.ts`

Expected: PASS.

```bash
git add apps/app/src/react-app/domains/session/references apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/src/i18n/locales/en.ts apps/app/src/i18n/locales/zh.ts apps/app/tests/reference-ingestion.test.ts apps/app/tests/template-market-actions.test.ts
git commit -m "fix: harden multilingual reference feedback"
```

---

### Task 4: Final Integration Verification and Push

**Files:**
- Verify only; modify files only for failures traced to this feature.

- [ ] **Step 1: Run targeted tests**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate scripts/artifact-spreadsheet.test.ts tests/reference-ingestion.test.ts tests/template-brief.test.ts tests/template-market-actions.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Run static verification**

Run: `pnpm.cmd --filter @ipollowork/app typecheck`

Expected: exit 0.

- [ ] **Step 3: Build dependencies and app**

Run: `pnpm.cmd --filter @ipollowork/types build`

Run: `pnpm.cmd --filter @ipollowork/app build`

Expected: both exit 0; existing Vite chunk warnings are non-blocking.

- [ ] **Step 4: Verify Git state and mergeability**

Run: `git diff --check origin/main..HEAD`

Run: `git merge-tree --write-tree --name-only origin/main HEAD`

Expected: no feature whitespace errors and no merge conflicts.

- [ ] **Step 5: Push**

```bash
git push origin codex/reference-context-pack
```

Expected: remote branch advances without force push.

---

## Self-Review

- Spec coverage: shared parser reuse, structured-data budgets, source attachment eligibility, Chinese labels, warning visibility, empty prompt handling, verification, and push are covered.
- Scope: no OCR, server persistence, AI summarization, vector indexing, or spreadsheet editor redesign.
- Type consistency: shared parser returns `string[][]`; reference results remain `ReferenceIngestionResult`; attachment eligibility accepts the existing File-compatible shape.
- Placeholder scan: no unresolved implementation placeholders remain.
