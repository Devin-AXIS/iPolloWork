# Task 2 Report

## Status

Implemented Task 2 extractors and extended the reference-ingestion tests.

## Changes

- Added text and Markdown extraction with cleaned content and heading-aware chunks.
- Added bounded CSV profiling with row/column metadata and the first 20 sample rows.
- Added JSON profiling with top-level shape, bounded samples, and array metadata.
- Added DOCX extraction from `word/document.xml`, including paragraphs, heading styles, and table rows.
- Added the four prescribed extractor tests to `reference-ingestion.test.ts`.

The DOCX parser uses a small XML tokenizer because the Bun test runtime does not provide a global `DOMParser`, and the app package does not directly depend on an XML parser package.

## Verification

- `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts`
  - 15 pass, 0 fail, 46 assertions.
- `pnpm.cmd --filter @ipollowork/app typecheck`
  - Passed.
- `git diff --check` for the four task files
  - Passed.

## Commit

`bb161be5` (`feat: add reference document extractors`).

The commit contains only the four task files. The report itself remains outside the commit as requested.

## Review Fix

- Replaced regex/token matching in `extractors/docx.ts` with `new DOMParser().parseFromString(xml, "application/xml")`.
- Added namespace-aware traversal for WordprocessingML bodies, paragraphs, heading styles, runs, text nodes, and simple tables.
- Added a regression test covering an alternate namespace prefix, single-quoted style attributes, and XML entity decoding.
- Added a test-only DOMParser polyfill from the existing locked `@xmldom/xmldom` package through pnpm's materialized virtual-store path.

## Review Fix Verification

- `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts`
  - 16 pass, 0 fail, 49 assertions.
- `pnpm.cmd --filter @ipollowork/app typecheck`
  - Passed.
- `git diff --check` for the fix files
  - Passed; Git only reported its normal LF-to-CRLF working-copy warnings.

## Review Fix Concerns

- `@xmldom/xmldom` is not importable by bare package name from app tests; the test polyfill uses the already-materialized locked pnpm virtual-store path. If that path is absent in another install layout, test dependency wiring will need context outside the allowed files.
