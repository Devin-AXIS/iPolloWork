# iPolloWork Reference Context Pack Design

## Goal

Build a first version of reference-file handling that fits iPolloWork's template, design, video, article, report, and chat workflows. When a user uploads a reference file, iPolloWork should turn it into a clean, bounded context pack for the current AI task instead of sending the raw file by default or saving it into the generated project directory.

The feature is not a general-purpose file storage system. It is a task-context preparation layer for iPolloWork sessions.

## Current State

Template brief uploads already support optional references in `apps/app/src/react-app/domains/session/templates/template-brief.ts` and `apps/app/src/react-app/domains/session/chat/session-page.tsx`.

The current behavior is useful but too direct:

- DOCX is converted to plain text with a simple `word/document.xml` pass.
- TXT, Markdown, CSV, and JSON are read mostly as raw text.
- PDF text extraction is not available for brief inference.
- Uploaded references are kept as `ComposerAttachment` values and sent through `onSendDraft`.
- `draftToParts` later serializes attachments into model file parts, so attaching a reference file means the raw file or converted file reaches the model.
- `brief.json` already stores only lightweight reference metadata, which is the right persistence direction.

The new design keeps the good part, lightweight brief persistence, and changes the upload/send path so the default model input is controlled text context, not raw files.

## Product Principles

1. Reference files are context for the task, not project assets.
2. Default behavior must not write uploaded source files into `design/<sessionId>/` or `video/<sessionId>/`.
3. Default behavior must not send the original uploaded file as an AI attachment.
4. The model receives a bounded text context pack made from extracted summaries, samples, and selected chunks.
5. Users can still opt in to sending the original file attachment when that is useful.
6. Low-quality extraction must not auto-fill brief fields.
7. Every generated artifact should still be driven by the user's final editable brief plus the selected template's layout contract.

## Architecture

Add a front-end reference ingestion domain:

```text
apps/app/src/react-app/domains/session/references/
  ingestion.ts
  types.ts
  extractors/pdf.ts
  extractors/docx.ts
  extractors/text.ts
  extractors/table.ts
  chunking.ts
  compression.ts
  quality.ts
  prompt-pack.ts
  brief-autofill.ts
```

Delimited spreadsheet parsing is shared at the session-domain level:

```text
apps/app/src/react-app/domains/session/spreadsheets/
  delimited.ts
```

`artifact-spreadsheet-model.ts` and `references/extractors/table.ts` must both use this module for CSV and TSV parsing. The shared module owns quoted fields, escaped quotes, embedded newlines, delimiter handling, and serialization. Reference ingestion owns only profiling, sampling, and context budgets. This avoids a second CSV parser or an additional parsing dependency.

The module runs in the app layer and does not require server-side storage in the first version.

## Core Types

```ts
type ReferenceQuality = "high" | "medium" | "low" | "failed";

type ReferenceChunk = {
  id: string;
  source: string;
  page?: number;
  rowRange?: [number, number];
  heading?: string;
  text: string;
  tokenEstimate: number;
};

type ReferenceIngestionResult = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  sourceMode: "memory";
  extractedText: string;
  summary: string;
  chunks: ReferenceChunk[];
  quality: ReferenceQuality;
  warnings: string[];
};

type TemplateReferenceItem = {
  id: string;
  file: File;
  fileName: string;
  mimeType: string;
  size: number;
  status: "parsing" | "ready" | "weak" | "failed";
  sendOriginal: boolean;
  ingestion?: ReferenceIngestionResult;
};

type ReferenceContextPack = {
  files: ReferenceIngestionResult[];
  promptText: string;
  totalChars: number;
  warnings: string[];
};
```

`TemplateReferenceItem` belongs to UI state. `ReferenceIngestionResult` is the normalized extraction result. `ReferenceContextPack` is the only default reference content sent to the model.

## Data Flow

```text
Template upload input
  -> create TemplateReferenceItem with status="parsing"
  -> ingestReferenceFile(file)
  -> extractor by type
  -> normalize and clean
  -> chunk
  -> deterministic compression
  -> quality gate
  -> update TemplateReferenceItem
  -> conservative brief autofill
  -> sendDraft packs accepted ingestions into synthetic text
  -> send raw attachments only when sendOriginal=true
```

`TemplateBriefCard` should store `TemplateReferenceItem[]`, not `ComposerAttachment[]`, as its primary reference state. `ComposerAttachment[]` should be derived at submit time only for references where `sendOriginal` is true.

## File Strategies

### PDF

Use `pdfjs-dist` to extract page text. Do not scan raw PDF bytes with regular expressions as the primary extractor.

Each page becomes one or more chunks. The extractor must filter known PDF metadata and renderer noise:

```text
Chromium
Skia/PDF
Producer
Creator
CreationDate
ModDate
CIDFont
ToUnicode
FontDescriptor
```

Image-only PDFs should produce `quality="low"` or `quality="failed"` with a user-visible warning. OCR is out of scope for the first version.

### DOCX

Continue using `jszip`, but replace ad hoc string matching with structured XML parsing through `DOMParser`.

Extract:

- Paragraph text.
- Heading-like paragraphs when style metadata is present.
- Simple tables as row text.
- Lists as readable paragraph lines.

The result should preserve enough structure for chunking and brief autofill.

### TXT and Markdown

Decode as text and preserve language content. Markdown headings should be retained as chunk headings. Split by headings, blank lines, and list boundaries.

### CSV

Do not send full CSV content by default.

Generate a table profile:

- Row count.
- Column count.
- Column names.
- First 20 sample rows.
- Optional simple completeness hints, such as empty cell counts per column when cheap.

Reuse the existing editable-spreadsheet CSV/TSV parser by extracting its delimited parsing and serialization into `domains/session/spreadsheets/delimited.ts`. Both the artifact editor and reference ingestion must call this shared implementation. Do not add a second CSV parsing dependency.

The shared parser must preserve quoted commas, escaped quotes, and embedded newlines. Reference profiling must cap individual sampled cells and the complete generated profile so a single large cell cannot expand the ingestion context.

### JSON

Do not send full JSON content by default for large files.

Generate:

- Top-level type.
- Top-level keys.
- Array length when the top-level value or a key contains an array.
- Sample objects from the first 20 array entries.
- A compact schema-like shape.

Malformed JSON becomes `quality="failed"` for extraction, but the upload itself should not crash the UI.

### Images

Images remain optional visual attachments in the first version. No OCR is performed.

Default `sendOriginal` for images can remain true only when the upload UI explicitly describes them as visual references. For template brief document references, image files should not auto-fill form fields.

## Deterministic Compression

The first version should not make an extra AI call just to summarize uploaded files.

Compression means code-driven selection and formatting:

- Count extracted pages, rows, columns, or sections.
- Remove duplicate and near-empty lines.
- Keep document title and heading hierarchy when available.
- Prefer early body chunks and chunks with task-relevant labels.
- Prefer chunks containing words such as audience, target user, goal, requirement, background, scope, conclusion, deliverable, brand, CTA, and their common Chinese equivalents.
- Keep table schema and samples instead of full table text.
- Enforce character and chunk budgets.

The final generation model can understand the context pack. The ingestion module's job is to make that context clean and bounded.

## Quality Gate

After extraction, run quality checks:

- Garbled character ratio above 10 percent should become `low`.
- Readable character ratio below 60 percent should become `low`.
- Text that only contains PDF metadata or renderer names should become `failed`.
- Effective body text under 30 characters should become `low`.
- Excessive repeated lines should become `medium` or `low`.
- Stable page or section text with readable content should become `high`.

Only `high` and `medium` results can participate in automatic brief filling or prompt context. `low` and `failed` results stay visible in the UI but are excluded from autofill.

## Brief Autofill

Autofill must be conservative because iPolloWork users can always edit the form before sending.

Field rules:

- `title`: prefer document H1 or title-like first section, then readable filename stem.
- `audience`: fill only from explicit labels such as `受众`, `目标用户`, `面向谁`, `Audience`, `For`, `users`, `customers`, or similar clear headings.
- `details`: use deterministic summary plus selected high-quality chunks, capped around 300 to 700 Chinese characters or equivalent.

Never use PDF renderer metadata, binary-looking content, repeated table dumps, or low-quality extraction as field values.

When autofill changes fields, show a small notice:

```text
已根据参考文档填入标题/受众/信息，可手动修改。
```

## Prompt Packing

`prompt-pack.ts` should produce bounded synthetic text for `onSendDraft`.

Default limits:

- Per-file summary up to 1200 characters.
- Per chunk up to 1200 characters.
- Up to 8 chunks per file.
- Up to 12000 characters across all reference files.

Prompt shape:

```text
Reference context for this iPolloWork template task:

File 1: product-plan.pdf
Type: application/pdf
Quality: high
Use policy: extracted context only; original file not attached by default.

Document profile:
- Pages extracted: 8
- Readable text: about 5200 chars
- Detected sections: 项目背景, 目标用户, 核心功能, 交付要求

Summary:
...

Relevant excerpts:
[page 1] ...
[page 2] ...

When applying the selected template:
- Prefer explicit facts from these excerpts.
- Do not invent missing evidence.
- Preserve the selected template layout and visual contract.
```

`submitTemplateBrief` should add this prompt pack as a synthetic text part. It should pass `attachments: []` unless the user selected `sendOriginal` for specific references.

## Persistence

The first version writes only lightweight metadata into `brief.json`:

```json
{
  "referenceFiles": [
    {
      "name": "product-plan.pdf",
      "mimeType": "application/pdf",
      "size": 123456,
      "quality": "high",
      "sourceMode": "memory"
    }
  ]
}
```

Do not write original uploaded files, full extracted text, chunks, or `ingestion.json` into the project directory by default.

A future explicit setting may enable reproducible saved references:

```text
design/<sessionId>/references/<fileId>/source.pdf
design/<sessionId>/references/<fileId>/ingestion.json
```

That setting is out of scope for the first version.

## UI Behavior

Each uploaded reference row should show extraction state:

```text
解析中...
已提取 8 页，质量 high
已作为参考上下文加入
无法可靠提取，仅保留为可选附件
```

Controls:

- Remove reference.
- Toggle `sendOriginal` for files where sending the source is supported.
- Show quality and a short warning when extraction is weak.

The submit button should remain disabled while parsing is active. Failed extraction for one file must not block other files.

## Error Handling

- Parser failure: mark that file `failed`, keep the UI responsive, and show a warning.
- Oversized file: reject before parsing or parse only a documented bounded prefix, depending on file type.
- Multi-file upload: parse independently and concurrently with a small concurrency limit.
- Cancellation or removal: abort parsing when possible and clean up state.
- Unsupported type: show existing unsupported-format warning.

## Testing Plan

Unit tests:

- PDF extraction does not treat Chromium, Skia, Producer, Creator, or font metadata as body text.
- PDF page text becomes page-aware chunks.
- Garbled PDF content becomes `low` or `failed`.
- DOCX extracts paragraphs and simple tables.
- Markdown headings become chunk headings.
- CSV produces schema, row count, column count, and sample rows through the same parser used by the editable spreadsheet surface.
- Quoted CSV records with escaped quotes and embedded newlines parse identically in the editor and reference ingestion.
- JSON produces compact structure and samples.
- Long text is chunked and budgeted.
- Low-quality ingestion does not autofill brief fields.
- High-quality ingestion can autofill title, audience, and details.
- Prompt pack respects global and per-file budgets.

Integration tests:

- Template upload PDF, generate context pack, autofill brief, and send synthetic prompt context.
- Garbage PDF does not autofill and does not crash the UI.
- Multiple files produce a bounded prompt pack.
- Default template submission sends no original attachments.
- Opt-in source sending includes only selected original attachments.
- `brief.json` stores only lightweight reference metadata.

## Rollout Order

1. Add `references` module types and pure utilities.
2. Implement text, Markdown, DOCX, CSV, and JSON extractors.
3. Add PDF extraction with `pdfjs-dist` and worker configuration.
4. Implement quality, chunking, deterministic compression, and prompt packing.
5. Update `TemplateBriefCard` state from `ComposerAttachment[]` to `TemplateReferenceItem[]`.
6. Update `submitTemplateBrief` to send context pack text by default and raw attachments only by opt-in.
7. Update UI status, quality labels, warnings, and opt-in attachment toggle.
8. Add unit and integration tests.
9. Run typecheck and targeted tests.

## Non-goals

- Server-side reference storage.
- OCR for image files or scanned PDFs.
- Extra AI summarization during upload.
- Full semantic search or vector indexing.
- Reproducible saved reference packs.
- Editing source documents.

## Success Criteria

- Uploading common reference files improves first-generation quality for templates and design tasks.
- Raw reference files are not saved into generated project directories by default.
- Raw reference files are not sent to the model by default.
- Large or messy files cannot explode prompt size or UI state.
- Low-quality extraction is visible but does not pollute brief fields.
- The implementation fits current iPolloWork app-layer architecture and can later grow into saved/cached references without changing the public mental model.
