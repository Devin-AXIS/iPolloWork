# Reference Context Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build iPolloWork's first Reference Context Pack pipeline so uploaded reference files are parsed, cleaned, budgeted, and sent as controlled text context by default.

**Architecture:** Add a focused front-end `references` domain under the session area. The domain exposes pure ingestion, quality, chunking, compression, prompt packing, and brief-autofill functions, then `TemplateBriefCard` consumes those functions and derives raw `ComposerAttachment` values only for references explicitly marked `sendOriginal`.

**Tech Stack:** TypeScript, React, Bun test, Vite, `jszip`, existing `xlsx`, new `pdfjs-dist` for PDF text extraction.

## Global Constraints

- Default behavior must not write uploaded source files into `design/<sessionId>/` or `video/<sessionId>/`.
- Default behavior must not send the original uploaded file as an AI attachment.
- The model receives a bounded text context pack made from extracted summaries, samples, and selected chunks.
- Users can opt in to sending the original file attachment through `sendOriginal`.
- Only `quality === "high"` and `quality === "medium"` may participate in automatic brief filling or prompt context.
- Do not make an extra AI call during upload summarization.
- First version does not include OCR, server-side reference storage, vector indexing, or saved `ingestion.json`.
- Prompt pack limits: per-file summary <= 1200 characters, per chunk <= 1200 characters, per file <= 8 chunks, all files <= 12000 characters.

---

## File Structure

- Create `apps/app/src/react-app/domains/session/references/types.ts`
  - Owns `ReferenceQuality`, `ReferenceChunk`, `ReferenceIngestionResult`, `TemplateReferenceItem`, `ReferenceContextPack`, and extractor output types.
- Create `apps/app/src/react-app/domains/session/references/quality.ts`
  - Classifies extracted content and filters known PDF metadata noise.
- Create `apps/app/src/react-app/domains/session/references/chunking.ts`
  - Converts normalized text, pages, and table profiles into bounded chunks.
- Create `apps/app/src/react-app/domains/session/references/compression.ts`
  - Produces deterministic summaries and selects relevant chunks.
- Create `apps/app/src/react-app/domains/session/references/prompt-pack.ts`
  - Produces the synthetic context string used by `sendDraft`.
- Create `apps/app/src/react-app/domains/session/references/brief-autofill.ts`
  - Infers conservative `TemplateBrief` values from accepted ingestions.
- Create `apps/app/src/react-app/domains/session/references/extractors/text.ts`
  - Extracts TXT and Markdown.
- Create `apps/app/src/react-app/domains/session/references/extractors/docx.ts`
  - Extracts DOCX with `jszip` and `DOMParser`.
- Create `apps/app/src/react-app/domains/session/references/extractors/table.ts`
  - Profiles CSV and JSON without full-table dumping.
- Create `apps/app/src/react-app/domains/session/references/extractors/pdf.ts`
  - Extracts PDF page text with `pdfjs-dist`.
- Create `apps/app/src/react-app/domains/session/references/ingestion.ts`
  - Routes files to extractors and returns `ReferenceIngestionResult`.
- Modify `apps/app/src/react-app/domains/session/templates/template-brief.ts`
  - Keep existing template-specific prompt/config helpers.
  - Re-export compatibility helpers from `references` while migration is in progress.
  - Remove legacy raw text inference once `TemplateBriefCard` is migrated.
- Modify `apps/app/src/react-app/domains/session/chat/session-page.tsx`
  - Store `TemplateReferenceItem[]`.
  - Show parsing status, quality, warnings, remove, and `sendOriginal` toggle.
  - Send `ReferenceContextPack.promptText` as synthetic text.
  - Send raw attachments only for `sendOriginal=true`.
  - Write only lightweight reference metadata into `brief.json`.
- Modify `apps/app/package.json` and `pnpm-lock.yaml`
  - Add `pdfjs-dist`.
- Modify `apps/app/tests/template-brief.test.ts`
  - Keep existing template prompt tests and move reference-specific assertions to new tests when clearer.
- Create `apps/app/tests/reference-ingestion.test.ts`
  - Pure unit coverage for extractors, quality, chunking, compression, prompt packing, and autofill.
- Extend `apps/app/tests/template-brief.test.ts`
  - Add pure submit payload coverage for default context-only sending and opt-in original attachments.

---

### Task 1: Reference Core Types, Quality, Chunking, Compression, and Prompt Pack

**Files:**
- Create: `apps/app/src/react-app/domains/session/references/types.ts`
- Create: `apps/app/src/react-app/domains/session/references/quality.ts`
- Create: `apps/app/src/react-app/domains/session/references/chunking.ts`
- Create: `apps/app/src/react-app/domains/session/references/compression.ts`
- Create: `apps/app/src/react-app/domains/session/references/prompt-pack.ts`
- Test: `apps/app/tests/reference-ingestion.test.ts`

**Interfaces:**
- Produces:
  - `estimateTokens(text: string): number`
  - `cleanReferenceText(text: string): { text: string; warnings: string[] }`
  - `assessReferenceQuality(input: { text: string; chunks?: ReferenceChunk[]; warnings?: string[] }): { quality: ReferenceQuality; warnings: string[] }`
  - `chunkPlainText(input: { source: string; text: string; page?: number; heading?: string; maxChunkChars?: number }): ReferenceChunk[]`
  - `buildDeterministicSummary(result: Pick<ReferenceIngestionResult, "fileName" | "mimeType" | "extractedText" | "chunks" | "warnings">): string`
  - `selectReferenceChunks(chunks: ReferenceChunk[], options?: { maxChunks?: number; maxChunkChars?: number }): ReferenceChunk[]`
  - `packReferenceContext(files: ReferenceIngestionResult[], options?: PromptPackOptions): ReferenceContextPack`
- Consumes: no project-specific runtime state.

- [ ] **Step 1: Write failing tests for cleaning, quality, chunking, and prompt budgets**

Add these imports and tests to `apps/app/tests/reference-ingestion.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  cleanReferenceText,
  assessReferenceQuality,
} from "../src/react-app/domains/session/references/quality";
import {
  chunkPlainText,
} from "../src/react-app/domains/session/references/chunking";
import {
  buildDeterministicSummary,
  selectReferenceChunks,
} from "../src/react-app/domains/session/references/compression";
import {
  packReferenceContext,
} from "../src/react-app/domains/session/references/prompt-pack";
import type { ReferenceIngestionResult } from "../src/react-app/domains/session/references/types";

describe("reference ingestion core", () => {
  test("cleans known PDF renderer metadata before quality checks", () => {
    const cleaned = cleanReferenceText([
      "Producer: Skia/PDF m92",
      "Creator: Chromium",
      "CreationDate: D:20241102090758",
      "Real launch plan",
      "Audience: product teams",
    ].join("\n"));

    expect(cleaned.text).toContain("Real launch plan");
    expect(cleaned.text).toContain("Audience: product teams");
    expect(cleaned.text).not.toContain("Skia/PDF");
    expect(cleaned.text).not.toContain("Chromium");
    expect(cleaned.warnings).toContain("Removed PDF renderer metadata.");
  });

  test("classifies metadata-only extracted content as failed", () => {
    const cleaned = cleanReferenceText("Producer: Skia/PDF\nCreator: Chromium");
    const quality = assessReferenceQuality({ text: cleaned.text, warnings: cleaned.warnings });

    expect(quality.quality).toBe("failed");
    expect(quality.warnings).toContain("No reliable body text was extracted.");
  });

  test("chunks readable text with token estimates and stable ids", () => {
    const chunks = chunkPlainText({
      source: "brief.md",
      heading: "Audience",
      text: "Audience: enterprise designers.\n\nRequirements: keep the visual contract and replace copy.",
      maxChunkChars: 48,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ source: "brief.md", heading: "Audience" });
    expect(chunks[0]?.id).toBe("brief.md:chunk:1");
    expect(chunks[0]?.tokenEstimate).toBeGreaterThan(0);
  });

  test("packs only high and medium quality files within budgets", () => {
    const highChunks = chunkPlainText({
      source: "product-plan.pdf",
      page: 1,
      text: "Project background and target users. ".repeat(120),
      maxChunkChars: 900,
    });
    const lowChunks = chunkPlainText({
      source: "bad.pdf",
      page: 1,
      text: "Unreadable",
      maxChunkChars: 900,
    });
    const files: ReferenceIngestionResult[] = [
      {
        id: "ref_high",
        fileName: "product-plan.pdf",
        mimeType: "application/pdf",
        size: 1000,
        sourceMode: "memory",
        extractedText: highChunks.map((chunk) => chunk.text).join("\n"),
        summary: "Useful product plan.",
        chunks: highChunks,
        quality: "high",
        warnings: [],
      },
      {
        id: "ref_low",
        fileName: "bad.pdf",
        mimeType: "application/pdf",
        size: 1000,
        sourceMode: "memory",
        extractedText: "Unreadable",
        summary: "",
        chunks: lowChunks,
        quality: "low",
        warnings: ["No reliable body text was extracted."],
      },
    ];

    const pack = packReferenceContext(files, {
      maxTotalChars: 1800,
      maxSummaryChars: 200,
      maxChunkChars: 300,
      maxChunksPerFile: 2,
    });

    expect(pack.promptText).toContain("product-plan.pdf");
    expect(pack.promptText).not.toContain("bad.pdf");
    expect(pack.totalChars).toBeLessThanOrEqual(1800);
    expect(pack.warnings).toContain("Excluded 1 low-quality reference file.");
  });

  test("deterministic summary names sections without calling AI", () => {
    const chunks = chunkPlainText({
      source: "launch.md",
      text: "# Launch Plan\n\nAudience: enterprise teams.\n\nCore features: template generation.",
      maxChunkChars: 1200,
    });
    const summary = buildDeterministicSummary({
      fileName: "launch.md",
      mimeType: "text/markdown",
      extractedText: chunks.map((chunk) => chunk.text).join("\n"),
      chunks,
      warnings: [],
    });

    expect(summary).toContain("File: launch.md");
    expect(summary).toContain("Detected topics:");
    expect(summary).toContain("audience");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
```

Expected: FAIL because the `references` modules do not exist.

- [ ] **Step 3: Implement core types**

Create `apps/app/src/react-app/domains/session/references/types.ts`:

```ts
export type ReferenceQuality = "high" | "medium" | "low" | "failed";

export type ReferenceChunk = {
  id: string;
  source: string;
  page?: number;
  rowRange?: [number, number];
  heading?: string;
  text: string;
  tokenEstimate: number;
};

export type ReferenceIngestionResult = {
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

export type TemplateReferenceItem = {
  id: string;
  file: File;
  fileName: string;
  mimeType: string;
  size: number;
  status: "parsing" | "ready" | "weak" | "failed";
  sendOriginal: boolean;
  ingestion?: ReferenceIngestionResult;
};

export type ReferenceContextPack = {
  files: ReferenceIngestionResult[];
  promptText: string;
  totalChars: number;
  warnings: string[];
};

export type ExtractedReferenceContent = {
  text: string;
  chunks?: ReferenceChunk[];
  warnings?: string[];
  metadata?: {
    pages?: number;
    rows?: number;
    columns?: number;
    headings?: string[];
  };
};

export type PromptPackOptions = {
  maxSummaryChars?: number;
  maxChunkChars?: number;
  maxChunksPerFile?: number;
  maxTotalChars?: number;
};
```

- [ ] **Step 4: Implement quality utilities**

Create `apps/app/src/react-app/domains/session/references/quality.ts`:

```ts
import type { ReferenceQuality } from "./types";

const PDF_METADATA_PATTERNS = [
  /\bChromium\b/i,
  /\bSkia\/PDF\b/i,
  /^\s*(?:Producer|Creator|CreationDate|ModDate|CIDFont|ToUnicode|FontDescriptor)\s*:?.*$/i,
];

const GARBLE_PATTERN = /[\uFFFD\u25A0-\u25A3]|(?:[^\p{L}\p{N}\p{P}\p{Zs}\r\n\t]){2,}/gu;
const READABLE_PATTERN = /[\p{L}\p{N}]/gu;

export function cleanReferenceText(text: string): { text: string; warnings: string[] } {
  const warnings = new Set<string>();
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      if (PDF_METADATA_PATTERNS.some((pattern) => pattern.test(line))) {
        warnings.add("Removed PDF renderer metadata.");
        return false;
      }
      return true;
    });

  const seen = new Set<string>();
  const deduped = lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { text: deduped.join("\n"), warnings: [...warnings] };
}

export function assessReferenceQuality(input: { text: string; warnings?: string[] }): { quality: ReferenceQuality; warnings: string[] } {
  const warnings = new Set(input.warnings ?? []);
  const text = input.text.trim();
  if (text.length < 30) {
    warnings.add("No reliable body text was extracted.");
    return { quality: text ? "low" : "failed", warnings: [...warnings] };
  }

  const garbled = text.match(GARBLE_PATTERN)?.join("").length ?? 0;
  const readable = text.match(READABLE_PATTERN)?.join("").length ?? 0;
  const garbledRatio = garbled / Math.max(text.length, 1);
  const readableRatio = readable / Math.max(text.replace(/\s/g, "").length, 1);

  if (garbledRatio > 0.1 || readableRatio < 0.6) {
    warnings.add("Extracted text appears noisy.");
    return { quality: "low", warnings: [...warnings] };
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const unique = new Set(lines.map((line) => line.toLowerCase())).size;
  if (lines.length >= 8 && unique / lines.length < 0.6) {
    warnings.add("Extracted text contains many repeated lines.");
    return { quality: "medium", warnings: [...warnings] };
  }

  return { quality: "high", warnings: [...warnings] };
}
```

- [ ] **Step 5: Implement chunking utilities**

Create `apps/app/src/react-app/domains/session/references/chunking.ts`:

```ts
import type { ReferenceChunk } from "./types";

export function estimateTokens(text: string): number {
  const asciiWords = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const nonAsciiChars = text.replace(/[\x00-\x7F\s]/g, "").length;
  return Math.max(1, Math.ceil(asciiWords * 1.3 + nonAsciiChars * 0.8));
}

export function chunkPlainText(input: {
  source: string;
  text: string;
  page?: number;
  heading?: string;
  maxChunkChars?: number;
}): ReferenceChunk[] {
  const maxChunkChars = input.maxChunkChars ?? 1200;
  const blocks = input.text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks.length ? blocks : [input.text.trim()].filter(Boolean)) {
    if (!current) {
      current = block.slice(0, maxChunkChars);
      if (block.length > maxChunkChars) chunks.push(current);
      if (block.length > maxChunkChars) current = block.slice(maxChunkChars);
      continue;
    }
    if (`${current}\n\n${block}`.length <= maxChunkChars) {
      current = `${current}\n\n${block}`;
    } else {
      chunks.push(current);
      current = block.slice(0, maxChunkChars);
    }
  }

  if (current) chunks.push(current.slice(0, maxChunkChars));

  return chunks.map((text, index) => ({
    id: `${input.source}:chunk:${index + 1}`,
    source: input.source,
    ...(input.page ? { page: input.page } : {}),
    ...(input.heading ? { heading: input.heading } : {}),
    text,
    tokenEstimate: estimateTokens(text),
  }));
}
```

- [ ] **Step 6: Implement deterministic compression**

Create `apps/app/src/react-app/domains/session/references/compression.ts`:

```ts
import type { ReferenceChunk, ReferenceIngestionResult } from "./types";

const TOPIC_KEYWORDS = [
  "audience",
  "target user",
  "goal",
  "requirement",
  "background",
  "scope",
  "conclusion",
  "deliverable",
  "brand",
  "cta",
  "受众",
  "目标用户",
  "目标",
  "需求",
  "背景",
  "范围",
  "结论",
  "交付",
  "品牌",
];

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function chunkScore(chunk: ReferenceChunk) {
  const text = `${chunk.heading ?? ""}\n${chunk.text}`.toLowerCase();
  let score = chunk.page === 1 ? 3 : 0;
  for (const keyword of TOPIC_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) score += 2;
  }
  if (chunk.heading) score += 1;
  return score;
}

export function selectReferenceChunks(chunks: ReferenceChunk[], options: { maxChunks?: number; maxChunkChars?: number } = {}) {
  const maxChunks = options.maxChunks ?? 8;
  const maxChunkChars = options.maxChunkChars ?? 1200;
  return [...chunks]
    .sort((a, b) => chunkScore(b) - chunkScore(a) || a.id.localeCompare(b.id))
    .slice(0, maxChunks)
    .map((chunk) => ({ ...chunk, text: truncate(chunk.text, maxChunkChars) }));
}

export function buildDeterministicSummary(result: Pick<ReferenceIngestionResult, "fileName" | "mimeType" | "extractedText" | "chunks" | "warnings">) {
  const topics = TOPIC_KEYWORDS
    .filter((keyword) => result.extractedText.toLowerCase().includes(keyword.toLowerCase()))
    .slice(0, 8);
  const pages = new Set(result.chunks.map((chunk) => chunk.page).filter((page): page is number => typeof page === "number"));
  return [
    `File: ${result.fileName}`,
    `Type: ${result.mimeType}`,
    pages.size ? `Pages extracted: ${pages.size}` : "",
    `Readable text: about ${result.extractedText.length} chars`,
    topics.length ? `Detected topics: ${topics.join(", ")}` : "Detected topics: not enough labeled structure",
    result.warnings.length ? `Warnings: ${result.warnings.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 7: Implement prompt packing**

Create `apps/app/src/react-app/domains/session/references/prompt-pack.ts`:

```ts
import { selectReferenceChunks } from "./compression";
import type { PromptPackOptions, ReferenceContextPack, ReferenceIngestionResult } from "./types";

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function packReferenceContext(files: ReferenceIngestionResult[], options: PromptPackOptions = {}): ReferenceContextPack {
  const maxSummaryChars = options.maxSummaryChars ?? 1200;
  const maxChunkChars = options.maxChunkChars ?? 1200;
  const maxChunksPerFile = options.maxChunksPerFile ?? 8;
  const maxTotalChars = options.maxTotalChars ?? 12000;
  const accepted = files.filter((file) => file.quality === "high" || file.quality === "medium");
  const rejected = files.length - accepted.length;
  const warnings = rejected ? [`Excluded ${rejected} low-quality reference file${rejected === 1 ? "" : "s"}.`] : [];
  const sections: string[] = ["Reference context for this iPolloWork template task:"];

  for (const [index, file] of accepted.entries()) {
    const chunks = selectReferenceChunks(file.chunks, { maxChunks: maxChunksPerFile, maxChunkChars });
    sections.push([
      "",
      `File ${index + 1}: ${file.fileName}`,
      `Type: ${file.mimeType}`,
      `Quality: ${file.quality}`,
      "Use policy: extracted context only; original file not attached by default.",
      "",
      "Summary:",
      truncate(file.summary, maxSummaryChars),
      "",
      "Relevant excerpts:",
      ...chunks.map((chunk) => {
        const label = chunk.page ? `[page ${chunk.page}]` : chunk.rowRange ? `[rows ${chunk.rowRange[0]}-${chunk.rowRange[1]}]` : "[excerpt]";
        return `${label} ${chunk.text}`;
      }),
    ].join("\n"));
  }

  if (accepted.length) {
    sections.push([
      "",
      "When applying the selected template:",
      "- Prefer explicit facts from these excerpts.",
      "- Do not invent missing evidence.",
      "- Preserve the selected template layout and visual contract.",
    ].join("\n"));
  }

  const promptText = truncate(sections.join("\n"), maxTotalChars);
  return { files: accepted, promptText, totalChars: promptText.length, warnings };
}
```

- [ ] **Step 8: Run tests and commit**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
```

Expected: PASS for `reference ingestion core`.

Commit:

```bash
git add apps/app/src/react-app/domains/session/references/types.ts apps/app/src/react-app/domains/session/references/quality.ts apps/app/src/react-app/domains/session/references/chunking.ts apps/app/src/react-app/domains/session/references/compression.ts apps/app/src/react-app/domains/session/references/prompt-pack.ts apps/app/tests/reference-ingestion.test.ts
git commit -m "feat: add reference context core"
```

---

### Task 2: Text, Markdown, CSV, JSON, and DOCX Extractors

**Files:**
- Create: `apps/app/src/react-app/domains/session/references/extractors/text.ts`
- Create: `apps/app/src/react-app/domains/session/references/extractors/table.ts`
- Create: `apps/app/src/react-app/domains/session/references/extractors/docx.ts`
- Modify: `apps/app/tests/reference-ingestion.test.ts`

**Interfaces:**
- Consumes:
  - `cleanReferenceText(text: string)`
  - `chunkPlainText(input): ReferenceChunk[]`
- Produces:
  - `extractTextReference(file: File): Promise<ExtractedReferenceContent>`
  - `extractTableReference(file: File): Promise<ExtractedReferenceContent>`
  - `extractDocxReference(file: File): Promise<ExtractedReferenceContent>`

- [ ] **Step 1: Add failing extractor tests**

Append to `apps/app/tests/reference-ingestion.test.ts`:

```ts
import JSZip from "jszip";
import { extractTextReference } from "../src/react-app/domains/session/references/extractors/text";
import { extractTableReference } from "../src/react-app/domains/session/references/extractors/table";
import { extractDocxReference } from "../src/react-app/domains/session/references/extractors/docx";

describe("reference extractors", () => {
  test("extracts markdown headings as chunk headings", async () => {
    const file = new File(["# Launch Plan\n\n## Audience\nEnterprise teams."], "launch.md", { type: "text/markdown" });
    const extracted = await extractTextReference(file);

    expect(extracted.text).toContain("Launch Plan");
    expect(extracted.chunks?.some((chunk) => chunk.heading === "Launch Plan")).toBe(true);
    expect(extracted.chunks?.some((chunk) => chunk.heading === "Audience")).toBe(true);
  });

  test("profiles CSV without dumping all rows", async () => {
    const rows = ["name,role", ...Array.from({ length: 30 }, (_, index) => `user${index},designer`)];
    const file = new File([rows.join("\n")], "users.csv", { type: "text/csv" });
    const extracted = await extractTableReference(file);

    expect(extracted.text).toContain("Rows: 30");
    expect(extracted.text).toContain("Columns: 2");
    expect(extracted.text).toContain("name, role");
    expect(extracted.text).toContain("user19");
    expect(extracted.text).not.toContain("user29");
  });

  test("profiles JSON arrays with compact samples", async () => {
    const data = Array.from({ length: 25 }, (_, index) => ({ id: index, segment: "team" }));
    const file = new File([JSON.stringify(data)], "segments.json", { type: "application/json" });
    const extracted = await extractTableReference(file);

    expect(extracted.text).toContain("Top-level type: array");
    expect(extracted.text).toContain("Array length: 25");
    expect(extracted.text).toContain("\"id\"");
    expect(extracted.text).not.toContain("\"id\":24");
  });

  test("extracts DOCX paragraphs and table cells", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Clinical Handoff</w:t></w:r></w:p>
          <w:p><w:r><w:t>Audience: Ward nurses.</w:t></w:r></w:p>
          <w:tbl>
            <w:tr><w:tc><w:p><w:r><w:t>Risk</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body>
      </w:document>`);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([buffer], "handoff.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const extracted = await extractDocxReference(file);

    expect(extracted.text).toContain("Clinical Handoff");
    expect(extracted.text).toContain("Audience: Ward nurses.");
    expect(extracted.text).toContain("Risk | Owner");
    expect(extracted.chunks?.some((chunk) => chunk.heading === "Clinical Handoff")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
```

Expected: FAIL because extractor modules do not exist.

- [ ] **Step 3: Implement text and Markdown extractor**

Create `apps/app/src/react-app/domains/session/references/extractors/text.ts`:

```ts
import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk } from "../types";

function markdownChunks(source: string, text: string): ReferenceChunk[] {
  const sections: Array<{ heading?: string; body: string[] }> = [];
  let current: { heading?: string; body: string[] } = { body: [] };
  sections.push(current);

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      current = { heading: heading[1]?.trim(), body: [line] };
      sections.push(current);
    } else {
      current.body.push(line);
    }
  }

  return sections.flatMap((section) => chunkPlainText({
    source,
    heading: section.heading,
    text: section.body.join("\n"),
  }));
}

export async function extractTextReference(file: File): Promise<ExtractedReferenceContent> {
  const cleaned = cleanReferenceText(await file.text());
  const isMarkdown = /\.md(?:own)?$/i.test(file.name) || file.type.toLowerCase().includes("markdown");
  return {
    text: cleaned.text,
    chunks: isMarkdown ? markdownChunks(file.name, cleaned.text) : chunkPlainText({ source: file.name, text: cleaned.text }),
    warnings: cleaned.warnings,
  };
}
```

- [ ] **Step 4: Implement CSV and JSON table profiler**

Create `apps/app/src/react-app/domains/session/references/extractors/table.ts`:

```ts
import { chunkPlainText } from "../chunking";
import type { ExtractedReferenceContent } from "../types";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function profileCsv(fileName: string, text: string): ExtractedReferenceContent {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] ?? "");
  const rows = lines.slice(1).map(parseCsvLine);
  const sample = rows.slice(0, 20);
  const profile = [
    `File: ${fileName}`,
    "Table type: CSV",
    `Rows: ${rows.length}`,
    `Columns: ${headers.length}`,
    `Column names: ${headers.join(", ")}`,
    "Sample rows:",
    ...sample.map((row, index) => `${index + 1}. ${row.join(" | ")}`),
  ].join("\n");

  return {
    text: profile,
    chunks: chunkPlainText({ source: fileName, text: profile }),
    metadata: { rows: rows.length, columns: headers.length },
  };
}

function compactShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 2).map(compactShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, child]) => [key, compactShape(child)]));
  }
  return typeof value;
}

function profileJson(fileName: string, text: string): ExtractedReferenceContent {
  const parsed = JSON.parse(text) as unknown;
  const topType = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
  const sample = Array.isArray(parsed) ? parsed.slice(0, 20) : parsed && typeof parsed === "object" ? Object.fromEntries(Object.entries(parsed).slice(0, 20)) : parsed;
  const profile = [
    `File: ${fileName}`,
    `Top-level type: ${topType}`,
    Array.isArray(parsed) ? `Array length: ${parsed.length}` : "",
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? `Top-level keys: ${Object.keys(parsed).slice(0, 30).join(", ")}` : "",
    "Compact shape:",
    JSON.stringify(compactShape(parsed), null, 2),
    "Sample:",
    JSON.stringify(sample, null, 2),
  ].filter(Boolean).join("\n");

  return {
    text: profile,
    chunks: chunkPlainText({ source: fileName, text: profile }),
    metadata: { rows: Array.isArray(parsed) ? parsed.length : undefined },
  };
}

export async function extractTableReference(file: File): Promise<ExtractedReferenceContent> {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || file.type.toLowerCase() === "application/json") return profileJson(file.name, text);
  return profileCsv(file.name, text);
}
```

- [ ] **Step 5: Implement DOCX extractor**

Create `apps/app/src/react-app/domains/session/references/extractors/docx.ts`:

```ts
import JSZip from "jszip";
import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent } from "../types";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function textFromNode(node: Element) {
  return [...node.getElementsByTagNameNS(W_NS, "t")]
    .map((item) => item.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphStyle(paragraph: Element) {
  const style = paragraph.getElementsByTagNameNS(W_NS, "pStyle")[0];
  return style?.getAttributeNS(W_NS, "val") ?? style?.getAttribute("w:val") ?? "";
}

export async function extractDocxReference(file: File): Promise<ExtractedReferenceContent> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return { text: "", chunks: [], warnings: ["DOCX document.xml was not found."] };

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) return { text: "", chunks: [], warnings: ["DOCX body was not found."] };

  const lines: string[] = [];
  const headings: string[] = [];
  for (const child of [...body.children]) {
    if (child.localName === "p") {
      const text = textFromNode(child);
      if (!text) continue;
      const style = paragraphStyle(child);
      if (/heading/i.test(style)) headings.push(text);
      lines.push(text);
    }
    if (child.localName === "tbl") {
      for (const row of [...child.getElementsByTagNameNS(W_NS, "tr")]) {
        const cells = [...row.getElementsByTagNameNS(W_NS, "tc")].map(textFromNode).filter(Boolean);
        if (cells.length) lines.push(cells.join(" | "));
      }
    }
  }

  const cleaned = cleanReferenceText(lines.join("\n\n"));
  const chunks = headings.length
    ? headings.flatMap((heading) => chunkPlainText({ source: file.name, heading, text: cleaned.text }))
    : chunkPlainText({ source: file.name, text: cleaned.text });

  return { text: cleaned.text, chunks, warnings: cleaned.warnings, metadata: { headings } };
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
```

Expected: PASS for core and extractor tests.

Commit:

```bash
git add apps/app/src/react-app/domains/session/references/extractors/text.ts apps/app/src/react-app/domains/session/references/extractors/table.ts apps/app/src/react-app/domains/session/references/extractors/docx.ts apps/app/tests/reference-ingestion.test.ts
git commit -m "feat: add reference document extractors"
```

---

### Task 3: Ingestion Router and Brief Autofill

**Files:**
- Create: `apps/app/src/react-app/domains/session/references/ingestion.ts`
- Create: `apps/app/src/react-app/domains/session/references/brief-autofill.ts`
- Modify: `apps/app/src/react-app/domains/session/templates/template-brief.ts`
- Modify: `apps/app/tests/reference-ingestion.test.ts`
- Modify: `apps/app/tests/template-brief.test.ts`

**Interfaces:**
- Consumes:
  - `extractTextReference(file)`
  - `extractTableReference(file)`
  - `extractDocxReference(file)`
  - `buildDeterministicSummary(result)`
  - `assessReferenceQuality(input)`
- Produces:
  - `referenceFileExtension(name: string): string`
  - `referenceMime(file: Pick<File, "name" | "type">): string`
  - `isReferenceFile(file: Pick<File, "name" | "type">): boolean`
  - `ingestReferenceFile(file: File): Promise<ReferenceIngestionResult>`
  - `inferTemplateBriefFromIngestions(ingestions: ReferenceIngestionResult[]): TemplateBrief`
  - `prepareOriginalReferenceAttachment(file: File): Promise<ComposerAttachment>`

- [ ] **Step 1: Add failing ingestion and autofill tests**

Append to `apps/app/tests/reference-ingestion.test.ts`:

```ts
import {
  ingestReferenceFile,
  isReferenceFile,
  prepareOriginalReferenceAttachment,
} from "../src/react-app/domains/session/references/ingestion";
import {
  inferTemplateBriefFromIngestions,
} from "../src/react-app/domains/session/references/brief-autofill";

describe("reference ingestion router", () => {
  test("accepts existing reference file types", () => {
    expect(isReferenceFile(new File(["x"], "brief.pdf", { type: "application/pdf" }))).toBe(true);
    expect(isReferenceFile(new File(["x"], "brief.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toBe(true);
    expect(isReferenceFile(new File(["x"], "brief.md", { type: "text/markdown" }))).toBe(true);
    expect(isReferenceFile(new File(["x"], "brief.csv", { type: "text/csv" }))).toBe(true);
    expect(isReferenceFile(new File(["x"], "brief.json", { type: "application/json" }))).toBe(true);
    expect(isReferenceFile(new File(["x"], "brief.svg", { type: "image/svg+xml" }))).toBe(false);
  });

  test("ingests high quality text references with deterministic summary", async () => {
    const file = new File(["# Product Launch\n\nAudience: enterprise design teams.\n\nRequirements: preserve template layout."], "launch.md", { type: "text/markdown" });
    const result = await ingestReferenceFile(file);

    expect(result.fileName).toBe("launch.md");
    expect(result.quality).toBe("high");
    expect(result.summary).toContain("File: launch.md");
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  test("autofills only from high and medium quality references", () => {
    const good = {
      id: "good",
      fileName: "launch.md",
      mimeType: "text/markdown",
      size: 100,
      sourceMode: "memory" as const,
      extractedText: "# Product Launch\n\nAudience: enterprise design teams.\n\nRequirements: preserve template layout.",
      summary: "File: launch.md",
      chunks: chunkPlainText({ source: "launch.md", text: "# Product Launch\n\nAudience: enterprise design teams.\n\nRequirements: preserve template layout." }),
      quality: "high" as const,
      warnings: [],
    };
    const bad = { ...good, id: "bad", fileName: "bad.pdf", extractedText: "Chromium", quality: "failed" as const };

    const brief = inferTemplateBriefFromIngestions([bad, good]);

    expect(brief.title).toBe("Product Launch");
    expect(brief.audience).toContain("enterprise design teams");
    expect(brief.details).toContain("preserve template layout");
  });

  test("prepares original attachments only for explicit opt in", async () => {
    const attachment = await prepareOriginalReferenceAttachment(new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(attachment.name).toBe("notes.txt");
    expect(attachment.mimeType).toBe("text/plain");
    expect(attachment.kind).toBe("file");
    expect(await attachment.file.text()).toBe("hello");
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
```

Expected: FAIL because `ingestion.ts` and `brief-autofill.ts` do not exist.

- [ ] **Step 3: Implement ingestion router**

Create `apps/app/src/react-app/domains/session/references/ingestion.ts`:

```ts
import type { ComposerAttachment } from "@/app/types";
import { buildDeterministicSummary } from "./compression";
import { assessReferenceQuality } from "./quality";
import type { ExtractedReferenceContent, ReferenceIngestionResult } from "./types";
import { extractDocxReference } from "./extractors/docx";
import { extractTableReference } from "./extractors/table";
import { extractTextReference } from "./extractors/text";

export const REFERENCE_MAX_BYTES = 25 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

const EXTENSIONS = new Set(["pdf", "docx", "md", "txt", "png", "jpg", "jpeg", "webp", "csv", "json"]);
const MIMES = new Set([
  PDF_MIME,
  DOCX_MIME,
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  md: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  json: "application/json",
};

export function referenceFileExtension(name: string) {
  return name.split(".").pop()?.trim().toLowerCase() ?? "";
}

export function referenceMime(file: Pick<File, "name" | "type">) {
  const mime = file.type.trim().toLowerCase();
  if (MIMES.has(mime)) return mime;
  return MIME_BY_EXTENSION[referenceFileExtension(file.name)] ?? "text/plain";
}

export function isReferenceFile(file: Pick<File, "name" | "type">) {
  const extension = referenceFileExtension(file.name);
  if (EXTENSIONS.has(extension)) return true;
  const mime = file.type.trim().toLowerCase();
  return Boolean(mime && MIMES.has(mime));
}

async function extractReference(file: File): Promise<ExtractedReferenceContent> {
  const extension = referenceFileExtension(file.name);
  const mime = referenceMime(file);
  if (extension === "docx" || mime === DOCX_MIME) return extractDocxReference(file);
  if (extension === "csv" || extension === "json" || mime === "text/csv" || mime === "application/json") return extractTableReference(file);
  if (extension === "md" || extension === "txt" || mime.startsWith("text/")) return extractTextReference(file);
  if (mime.startsWith("image/")) return { text: "", chunks: [], warnings: ["Images are kept as optional visual attachments; OCR is not available."] };
  return { text: "", chunks: [], warnings: ["No extractor is available for this file type."] };
}

export async function ingestReferenceFile(file: File): Promise<ReferenceIngestionResult> {
  if (file.size > REFERENCE_MAX_BYTES) {
    return {
      id: `${file.name}-${file.lastModified}`,
      fileName: file.name,
      mimeType: referenceMime(file),
      size: file.size,
      sourceMode: "memory",
      extractedText: "",
      summary: "",
      chunks: [],
      quality: "failed",
      warnings: [`${file.name} is larger than 25 MB.`],
    };
  }

  const extracted = await extractReference(file);
  const quality = assessReferenceQuality({ text: extracted.text, warnings: extracted.warnings });
  const draft: ReferenceIngestionResult = {
    id: `${file.name}-${file.lastModified}`,
    fileName: file.name,
    mimeType: referenceMime(file),
    size: file.size,
    sourceMode: "memory",
    extractedText: extracted.text,
    summary: "",
    chunks: extracted.chunks ?? [],
    quality: quality.quality,
    warnings: quality.warnings,
  };
  return { ...draft, summary: buildDeterministicSummary(draft) };
}

export async function prepareOriginalReferenceAttachment(file: File): Promise<ComposerAttachment> {
  if (file.size > REFERENCE_MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  if (!isReferenceFile(file)) throw new Error(`${file.name} is not a supported reference document.`);
  const mimeType = referenceMime(file);
  const kind = mimeType.startsWith("image/") ? "image" as const : "file" as const;
  const previewUrl = kind === "image" && typeof URL !== "undefined" && "createObjectURL" in URL ? URL.createObjectURL(file) : undefined;
  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType,
    size: file.size,
    kind,
    file,
    previewUrl,
  };
}
```

- [ ] **Step 4: Implement conservative brief autofill**

Create `apps/app/src/react-app/domains/session/references/brief-autofill.ts`:

```ts
import type { TemplateBrief } from "../templates/template-brief";
import type { ReferenceIngestionResult } from "./types";

function cleanLine(value: string) {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(value: string, limit: number) {
  return cleanLine(value).slice(0, limit).trim();
}

function fileNameStem(name: string) {
  return name.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ?? name;
}

function titleFromText(text: string, fileName: string) {
  const h1 = text.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  if (h1?.[1]) return snippet(h1[1], 120);
  const first = text.split(/\r?\n/).map(cleanLine).find((line) => line.length > 1 && line.length <= 90 && !/:$/.test(line));
  return first || fileNameStem(fileName);
}

function labelValue(text: string, labels: string[]) {
  for (const line of text.split(/\r?\n/)) {
    const clean = cleanLine(line);
    for (const label of labels) {
      const match = clean.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, "i"));
      if (match?.[1]) return snippet(match[1], 360);
    }
  }
  return "";
}

export function inferTemplateBriefFromIngestions(ingestions: ReferenceIngestionResult[]): TemplateBrief {
  const accepted = ingestions.filter((item) => item.quality === "high" || item.quality === "medium");
  const first = accepted[0];
  if (!first) return { title: "", audience: "", details: "" };
  const combined = accepted.map((item) => [item.extractedText, ...item.chunks.slice(0, 4).map((chunk) => chunk.text)].join("\n")).join("\n\n");
  const title = titleFromText(first.extractedText, first.fileName);
  const audience = labelValue(combined, ["Audience", "For", "Users", "Customers", "受众", "目标用户", "面向谁", "用户", "客户"]);
  const details = labelValue(combined, ["Requirements", "Details", "Key information", "Content", "Scope", "需求", "信息", "关键内容", "内容", "范围"])
    || accepted.flatMap((item) => item.chunks).slice(0, 3).map((chunk) => cleanLine(chunk.text)).join(" ").slice(0, 700).trim();
  return { title, audience, details };
}
```

- [ ] **Step 5: Add compatibility exports in template brief module**

Modify `apps/app/src/react-app/domains/session/templates/template-brief.ts` to import from references and keep old public names used by existing code until Task 5 migrates `TemplateBriefCard`.

Add near existing imports:

```ts
import {
  isReferenceFile,
  prepareOriginalReferenceAttachment,
} from "@/react-app/domains/session/references/ingestion";
import {
  inferTemplateBriefFromIngestions,
} from "@/react-app/domains/session/references/brief-autofill";
```

Add exports near legacy reference helpers:

```ts
export const isTemplateBriefReferenceFile = isReferenceFile;
export const prepareTemplateBriefReferenceAttachment = prepareOriginalReferenceAttachment;
export { inferTemplateBriefFromIngestions };
```

During this task, do not delete legacy functions if TypeScript still finds imports from current UI code. Task 5 removes legacy usage after the UI state is migrated.

- [ ] **Step 6: Run targeted tests and commit**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts tests/template-brief.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/app/src/react-app/domains/session/references/ingestion.ts apps/app/src/react-app/domains/session/references/brief-autofill.ts apps/app/src/react-app/domains/session/templates/template-brief.ts apps/app/tests/reference-ingestion.test.ts apps/app/tests/template-brief.test.ts
git commit -m "feat: route template references through ingestion"
```

---

### Task 4: PDF Extractor

**Files:**
- Modify: `apps/app/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/app/src/react-app/domains/session/references/extractors/pdf.ts`
- Modify: `apps/app/src/react-app/domains/session/references/ingestion.ts`
- Modify: `apps/app/tests/reference-ingestion.test.ts`

**Interfaces:**
- Consumes:
  - `cleanReferenceText(text)`
  - `chunkPlainText(input)`
- Produces:
  - `extractPdfReference(file: File): Promise<ExtractedReferenceContent>`

- [ ] **Step 1: Add dependency**

Run:

```bash
pnpm --filter @ipollowork/app add pdfjs-dist
```

Expected: `apps/app/package.json` and `pnpm-lock.yaml` include `pdfjs-dist`.

- [ ] **Step 2: Add failing PDF tests**

Append to `apps/app/tests/reference-ingestion.test.ts`:

```ts
import { extractPdfReference } from "../src/react-app/domains/session/references/extractors/pdf";

describe("PDF reference extraction", () => {
  test("fails cleanly for invalid PDF bytes", async () => {
    const extracted = await extractPdfReference(new File(["not a pdf"], "broken.pdf", { type: "application/pdf" }));

    expect(extracted.text).toBe("");
    expect(extracted.chunks).toEqual([]);
    expect(extracted.warnings?.some((warning) => warning.includes("PDF parsing failed"))).toBe(true);
  });
});
```

Add a router assertion to the existing `ingests high quality text references` test group:

```ts
test("routes invalid PDF through failed quality without throwing", async () => {
  const result = await ingestReferenceFile(new File(["not a pdf"], "broken.pdf", { type: "application/pdf" }));

  expect(result.quality).toBe("failed");
  expect(result.warnings.some((warning) => warning.includes("PDF parsing failed"))).toBe(true);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
```

Expected: FAIL because `extractors/pdf.ts` does not exist or ingestion does not route PDFs.

- [ ] **Step 4: Implement PDF extractor**

Create `apps/app/src/react-app/domains/session/references/extractors/pdf.ts`:

```ts
import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent, ReferenceChunk } from "../types";

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if ("GlobalWorkerOptions" in pdfjs && typeof window !== "undefined") {
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  return pdfjs;
}

export async function extractPdfReference(file: File): Promise<ExtractedReferenceContent> {
  try {
    const pdfjs = await loadPdfjs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false });
    const pdf = await loadingTask.promise;
    const chunks: ReferenceChunk[] = [];
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const raw = content.items
        .map((item) => "str" in item ? String(item.str) : "")
        .join(" ");
      const cleaned = cleanReferenceText(raw);
      if (!cleaned.text) continue;
      pageTexts.push(cleaned.text);
      chunks.push(...chunkPlainText({ source: file.name, page: pageNumber, text: cleaned.text }));
    }

    const text = pageTexts.join("\n\n");
    return {
      text,
      chunks,
      warnings: text ? [] : ["No readable PDF text was extracted."],
      metadata: { pages: pdf.numPages },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: "", chunks: [], warnings: [`PDF parsing failed: ${message}`] };
  }
}
```

- [ ] **Step 5: Route PDFs through the extractor**

Modify `apps/app/src/react-app/domains/session/references/ingestion.ts`.

Add import:

```ts
import { extractPdfReference } from "./extractors/pdf";
```

Add this branch in `extractReference` before image handling:

```ts
if (extension === "pdf" || mime === PDF_MIME) return extractPdfReference(file);
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts
pnpm --filter @ipollowork/app typecheck
```

Expected: tests PASS and typecheck PASS.

Commit:

```bash
git add apps/app/package.json pnpm-lock.yaml apps/app/src/react-app/domains/session/references/extractors/pdf.ts apps/app/src/react-app/domains/session/references/ingestion.ts apps/app/tests/reference-ingestion.test.ts
git commit -m "feat: extract reference PDF text"
```

---

### Task 5: Template Brief UI State Migration

**Files:**
- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx`
- Modify: `apps/app/src/i18n/locales/en.ts`
- Modify: `apps/app/src/i18n/locales/zh.ts`
- Modify: `apps/app/tests/template-brief.test.ts`

**Interfaces:**
- Consumes:
  - `TemplateReferenceItem`
  - `ingestReferenceFile(file)`
  - `inferTemplateBriefFromIngestions(ingestions)`
  - `packReferenceContext(ingestions)`
  - `prepareOriginalReferenceAttachment(file)`
- Produces:
  - `TemplateBriefCard` holds `TemplateReferenceItem[]`.
  - `onSubmit(brief, references)` passes `TemplateReferenceItem[]`.

- [ ] **Step 1: Add pure submit payload helper test before editing large React component**

In `apps/app/src/react-app/domains/session/chat/session-page.tsx`, plan to export a pure helper:

```ts
export async function buildTemplateReferenceSubmitPayload(references: TemplateReferenceItem[]) {
  const ingestions = references.map((reference) => reference.ingestion).filter((item): item is ReferenceIngestionResult => Boolean(item));
  const contextPack = packReferenceContext(ingestions);
  const attachments = await Promise.all(
    references.filter((reference) => reference.sendOriginal).map((reference) => prepareOriginalReferenceAttachment(reference.file)),
  );
  return { contextPack, attachments };
}
```

Add this failing test to `apps/app/tests/template-brief.test.ts`:

```ts
import { buildTemplateReferenceSubmitPayload } from "../src/react-app/domains/session/chat/session-page";
import type { TemplateReferenceItem } from "../src/react-app/domains/session/references/types";

test("template reference submit payload sends context by default and raw files only by opt in", async () => {
  const file = new File(["Audience: enterprise teams"], "launch.txt", { type: "text/plain" });
  const reference: TemplateReferenceItem = {
    id: "ref_1",
    file,
    fileName: "launch.txt",
    mimeType: "text/plain",
    size: file.size,
    status: "ready",
    sendOriginal: false,
    ingestion: {
      id: "ref_1",
      fileName: "launch.txt",
      mimeType: "text/plain",
      size: file.size,
      sourceMode: "memory",
      extractedText: "Audience: enterprise teams",
      summary: "File: launch.txt",
      chunks: [{ id: "launch.txt:chunk:1", source: "launch.txt", text: "Audience: enterprise teams", tokenEstimate: 4 }],
      quality: "high",
      warnings: [],
    },
  };

  const defaultPayload = await buildTemplateReferenceSubmitPayload([reference]);
  expect(defaultPayload.contextPack.promptText).toContain("launch.txt");
  expect(defaultPayload.attachments).toEqual([]);

  const optInPayload = await buildTemplateReferenceSubmitPayload([{ ...reference, sendOriginal: true }]);
  expect(optInPayload.attachments).toHaveLength(1);
  expect(optInPayload.attachments[0]?.name).toBe("launch.txt");
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/template-brief.test.ts
```

Expected: FAIL because `buildTemplateReferenceSubmitPayload` is not exported and the component still uses `ComposerAttachment[]`.

- [ ] **Step 3: Update imports and helper in `session-page.tsx`**

Modify imports near existing template brief imports:

```ts
import {
  ingestReferenceFile,
  isReferenceFile,
  prepareOriginalReferenceAttachment,
} from "../references/ingestion";
import {
  inferTemplateBriefFromIngestions,
} from "../references/brief-autofill";
import {
  packReferenceContext,
} from "../references/prompt-pack";
import type {
  ReferenceIngestionResult,
  TemplateReferenceItem,
} from "../references/types";
```

Add the exported helper above `TemplateBriefCard`:

```ts
export async function buildTemplateReferenceSubmitPayload(references: TemplateReferenceItem[]) {
  const ingestions = references
    .map((reference) => reference.ingestion)
    .filter((item): item is ReferenceIngestionResult => Boolean(item));
  const contextPack = packReferenceContext(ingestions);
  const attachments = await Promise.all(
    references
      .filter((reference) => reference.sendOriginal)
      .map((reference) => prepareOriginalReferenceAttachment(reference.file)),
  );
  return { contextPack, attachments };
}
```

- [ ] **Step 4: Change `TemplateBriefCard` state and submit signature**

Change the function signature:

```ts
function TemplateBriefCard({
  template,
  onSubmit,
  onClose,
}: {
  template: TemplateManifestV1;
  onSubmit: (brief: TemplateBrief, references: TemplateReferenceItem[]) => void;
  onClose: () => void | Promise<void>;
}) {
```

Change state:

```ts
const [references, setReferences] = useState<TemplateReferenceItem[]>([]);
const referencesRef = useRef<TemplateReferenceItem[]>([]);
```

Change `addReferenceFiles` body to create parsing items and ingest independently:

```ts
const addReferenceFiles = async (files: File[]) => {
  if (!files.length) return;
  const unsupported = files.filter((file) => !isReferenceFile(file));
  const supported = files.filter((file) => isReferenceFile(file));
  if (unsupported.length) {
    toast.warning(
      unsupported.length === 1
        ? t("templates.brief.reference_unsupported_one", { name: unsupported[0]?.name ?? "" })
        : t("templates.brief.reference_unsupported_many", { count: unsupported.length }),
      { description: t("templates.brief.reference_supported_formats") },
    );
  }
  if (!supported.length) return;

  setReferenceBusy(true);
  const pending = supported.map((file) => ({
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    status: "parsing" as const,
    sendOriginal: false,
  }));
  setReferences((current) => [...current, ...pending]);

  try {
    const results = await Promise.all(pending.map(async (item) => {
      const ingestion = await ingestReferenceFile(item.file);
      const status = ingestion.quality === "high" || ingestion.quality === "medium" ? "ready" : ingestion.quality === "low" ? "weak" : "failed";
      return { ...item, mimeType: ingestion.mimeType, status, ingestion };
    }));
    setReferences((current) => current.map((item) => results.find((result) => result.id === item.id) ?? item));
    applyReferenceBriefAutofill(inferTemplateBriefFromIngestions(results.map((result) => result.ingestion)));
  } finally {
    setReferenceBusy(false);
  }
};
```

Change `applyReferenceBriefAutofill` to accept one `TemplateBrief`:

```ts
const applyReferenceBriefAutofill = (inferred: TemplateBrief) => {
  if (!inferred.title && !inferred.audience && !inferred.details) return;
  setBrief((current) => ({
    title: current.title.trim() ? current.title : inferred.title,
    audience: current.audience.trim() ? current.audience : inferred.audience,
    details: current.details.trim() ? current.details : inferred.details,
  }));
  toast.success(t("templates.brief.reference_autofilled"));
};
```

- [ ] **Step 5: Update reference row UI**

In the reference row mapping, replace uses of `reference.name` with `reference.fileName`, and display status:

```tsx
<div className="text-[10px] text-dls-secondary">
  {reference.status === "parsing"
    ? t("templates.brief.reference_status_parsing")
    : reference.status === "ready"
      ? t("templates.brief.reference_status_ready", { quality: reference.ingestion?.quality ?? "high" })
      : reference.status === "weak"
        ? t("templates.brief.reference_status_weak")
        : t("templates.brief.reference_status_failed")}
</div>
```

Add an opt-in toggle button beside remove:

```tsx
<Button
  type="button"
  variant={reference.sendOriginal ? "secondary" : "ghost"}
  size="sm"
  className="h-7 shrink-0 rounded-lg px-2 text-[10px]"
  disabled={reference.status === "parsing"}
  onClick={() => setReferences((current) => current.map((item) => item.id === reference.id ? { ...item, sendOriginal: !item.sendOriginal } : item))}
>
  {reference.sendOriginal ? t("templates.brief.reference_send_original_on") : t("templates.brief.reference_send_original_off")}
</Button>
```

Update remove aria-label to use `reference.fileName`.

- [ ] **Step 6: Add i18n keys**

Add to `apps/app/src/i18n/locales/en.ts`:

```ts
"templates.brief.reference_autofilled": "Filled title, audience, and details from the reference document. You can edit them before sending.",
"templates.brief.reference_status_parsing": "Parsing...",
"templates.brief.reference_status_ready": "Extracted context, quality {quality}",
"templates.brief.reference_status_weak": "Could not extract reliable context; kept as optional attachment",
"templates.brief.reference_status_failed": "Extraction failed; kept as optional attachment",
"templates.brief.reference_send_original_on": "Attaching source",
"templates.brief.reference_send_original_off": "Source off",
```

Add to `apps/app/src/i18n/locales/zh.ts`:

```ts
"templates.brief.reference_autofilled": "已根据参考文档填入标题/受众/信息，可手动修改。",
"templates.brief.reference_status_parsing": "解析中...",
"templates.brief.reference_status_ready": "已提取参考上下文，质量 {quality}",
"templates.brief.reference_status_weak": "无法可靠提取，仅保留为可选附件",
"templates.brief.reference_status_failed": "解析失败，仅保留为可选附件",
"templates.brief.reference_send_original_on": "发送原文件",
"templates.brief.reference_send_original_off": "不发原文件",
```

- [ ] **Step 7: Update `submitTemplateBrief` to send context pack by default**

Change signature:

```ts
const submitTemplateBrief = useCallback(async (brief: TemplateBrief, references: TemplateReferenceItem[]) => {
```

Inside the callback before writing `brief.json`, compute:

```ts
const referencePayload = await buildTemplateReferenceSubmitPayload(references);
```

Change `referenceFiles` metadata:

```ts
referenceFiles: references.map((reference) => ({
  name: reference.fileName,
  mimeType: reference.mimeType,
  size: reference.size,
  quality: reference.ingestion?.quality ?? "failed",
  sourceMode: reference.ingestion?.sourceMode ?? "memory",
  sentOriginal: reference.sendOriginal,
})),
```

Replace `referencePrompt` with:

```ts
const referencePrompt = referencePayload.contextPack.promptText.trim();
```

Change send draft attachments:

```ts
attachments: referencePayload.attachments,
```

- [ ] **Step 8: Run tests and commit**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/template-brief.test.ts tests/reference-ingestion.test.ts
pnpm --filter @ipollowork/app typecheck
```

Expected: PASS.

Commit:

```bash
git add apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/src/i18n/locales/en.ts apps/app/src/i18n/locales/zh.ts apps/app/tests/template-brief.test.ts
git commit -m "feat: send template reference context by default"
```

---

### Task 6: Clean Up Legacy Reference Helpers

**Files:**
- Modify: `apps/app/src/react-app/domains/session/templates/template-brief.ts`
- Modify: `apps/app/tests/template-brief.test.ts`
- Modify: `apps/app/tests/reference-ingestion.test.ts`

**Interfaces:**
- Consumes: all reference behavior from `domains/session/references`.
- Produces: `template-brief.ts` contains only template brief config, template prompt, and non-reference helpers.

- [ ] **Step 1: Find remaining legacy reference imports**

Run:

```bash
rg -n "extractTemplateBriefReferenceText|inferTemplateBriefFromReferenceFile|prepareTemplateBriefReferenceAttachment|isTemplateBriefReferenceFile" apps/app/src apps/app/tests
```

Expected: Only `template-brief.ts` and tests contain legacy names before cleanup.

- [ ] **Step 2: Move legacy tests to reference ingestion names**

In `apps/app/tests/template-brief.test.ts`, remove tests that assert DOCX/PDF attachment conversion behavior from `template-brief.ts` and make sure equivalent coverage exists in `apps/app/tests/reference-ingestion.test.ts`:

```ts
test("does not send original source files unless opt in is selected", async () => {
  const file = new File(["Audience: team"], "source.txt", { type: "text/plain" });
  const result = await ingestReferenceFile(file);
  const pack = packReferenceContext([result]);

  expect(pack.promptText).toContain("source.txt");
  expect(result.sourceMode).toBe("memory");
});
```

- [ ] **Step 3: Remove legacy extraction code from template brief module**

In `apps/app/src/react-app/domains/session/templates/template-brief.ts`, remove:

```ts
export const TEMPLATE_BRIEF_REFERENCE_MAX_BYTES = 25 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const TEMPLATE_BRIEF_AUTOFILL_TEXT_LIMIT = 12_000;
const TEMPLATE_BRIEF_AUTOFILL_FIELD_LIMIT = 700;
const TEMPLATE_BRIEF_REFERENCE_EXTENSIONS = new Set([...]);
const TEMPLATE_BRIEF_REFERENCE_MIMES = new Set([...]);
const TEMPLATE_BRIEF_REFERENCE_MIME_BY_EXTENSION = { ... };
function templateBriefReferenceExtension(name: string) { ... }
function templateBriefReferenceNameStem(name: string) { ... }
function decodeXmlText(value: string) { ... }
async function extractDocxText(file: File) { ... }
function isTemplateBriefPdfReference(file: Pick<File, "name" | "type">) { ... }
function isTemplateBriefTextReference(file: Pick<File, "name" | "type">) { ... }
function cleanTemplateBriefLine(value: string) { ... }
function cleanTemplateBriefSnippet(value: string, limit = TEMPLATE_BRIEF_AUTOFILL_FIELD_LIMIT) { ... }
function firstMatchingLabelValue(text: string, labels: RegExp[]) { ... }
function markdownSectionText(text: string, keywords: string[]) { ... }
function firstBodyExcerpt(text: string, title: string) { ... }
function inferredTitleFromText(text: string, filename: string) { ... }
export function templateBriefFromReferenceText(...) { ... }
export async function extractTemplateBriefReferenceText(file: File) { ... }
export async function inferTemplateBriefFromReferenceFile(file: File): Promise<TemplateBrief> { ... }
export async function prepareTemplateBriefReferenceAttachment(file: File): Promise<ComposerAttachment> { ... }
```

Keep:

```ts
export const TEMPLATE_BRIEF_REFERENCE_ACCEPT = [
  ".pdf",
  ".docx",
  ".md",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".csv",
  ".json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
].join(",");
```

Remove unused imports such as `ComposerAttachment` and `JSZip` from `template-brief.ts`.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/template-brief.test.ts tests/reference-ingestion.test.ts
pnpm --filter @ipollowork/app typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/react-app/domains/session/templates/template-brief.ts apps/app/tests/template-brief.test.ts apps/app/tests/reference-ingestion.test.ts
git commit -m "refactor: isolate reference ingestion from template briefs"
```

---

### Task 7: Final Verification

**Files:**
- No new files.
- Verify modified files from Tasks 1 through 6.

**Interfaces:**
- Consumes: all implemented reference modules and migrated UI.
- Produces: verified branch ready for code review.

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
pnpm --filter @ipollowork/app exec bun test --isolate tests/reference-ingestion.test.ts tests/template-brief.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run app typecheck**

Run:

```bash
pnpm --filter @ipollowork/app typecheck
```

Expected: PASS.

- [ ] **Step 3: Run broader app test suite if runtime allows**

Run:

```bash
pnpm --filter @ipollowork/app test
```

Expected: PASS. If this fails due to pre-existing unrelated failures, record the failing test names and rerun the targeted tests from Step 1.

- [ ] **Step 4: Inspect git diff for accidental raw file persistence**

Run:

```bash
rg -n "references/.+source|ingestion\\.json|writeWorkspaceBinaryFile|writeWorkspaceFile\\([^\\n]+reference|attachments: references|attachments: reference" apps/app/src apps/server/src
```

Expected: no matches that write original reference files or full ingestion results into template project directories; no template submission path with `attachments: references`.

- [ ] **Step 5: Commit verification notes if any test-only fix was needed**

If Step 3 required a small fix, commit it:

```bash
git add apps/app/src apps/app/tests
git commit -m "test: verify reference context pack"
```

If no fix was needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: Tasks cover core types, deterministic compression, quality gates, DOCX/TXT/MD/CSV/JSON/PDF extraction, prompt packing, UI status, opt-in raw attachments, lightweight `brief.json`, tests, typecheck, and no-default-persistence checks.
- Scope check: OCR, server storage, AI summarization, vector search, and saved references remain non-goals and are not included in the tasks.
- Type consistency: `TemplateReferenceItem`, `ReferenceIngestionResult`, `ReferenceContextPack`, `sendOriginal`, `sourceMode`, and quality values match the approved spec.
- Red-flag scan: This plan contains no unresolved sections.
