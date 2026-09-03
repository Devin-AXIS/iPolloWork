import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { DOMParser as XmlDomParser } from "@xmldom/xmldom";

if (typeof DOMParser === "undefined") {
  Object.assign(globalThis, { DOMParser: XmlDomParser });
}

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
import { extractTextReference } from "../src/react-app/domains/session/references/extractors/text";
import { extractTableReference } from "../src/react-app/domains/session/references/extractors/table";
import { extractDocxReference } from "../src/react-app/domains/session/references/extractors/docx";
import { extractPptxReference } from "../src/react-app/domains/session/references/extractors/pptx";
import { ensurePdfTypedArrayHexSupport, extractPdfReference } from "../src/react-app/domains/session/references/extractors/pdf";
import {
  ingestReferenceFile,
  isReferenceFile,
  prepareOriginalReferenceAttachment,
} from "../src/react-app/domains/session/references/ingestion";
import { buildTemplateReferenceSubmitPayload } from "../src/react-app/domains/session/references/template-reference-submit";
import type { TemplateReferenceItem } from "../src/react-app/domains/session/references/types";
import {
  inferTemplateBriefFromIngestions,
} from "../src/react-app/domains/session/references/brief-autofill";

function createTextPdf(text: string): Uint8Array {
  const stream = `BT\n/F1 16 Tf\n72 720 Td\n(${text}) Tj\nET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

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

  test("normalizes a zero chunk-size budget to a safe minimum", () => {
    const chunks = chunkPlainText({
      source: "narrow.md",
      text: "abc",
      maxChunkChars: 0,
    });

    expect(chunks.map((chunk) => chunk.text)).toEqual(["a", "b", "c"]);
  });

  test("clamps oversized chunk budgets to 1200 characters", () => {
    const text = "x".repeat(2401);
    const chunks = chunkPlainText({ source: "large.md", text, maxChunkChars: 5000 });
    const selected = selectReferenceChunks(
      [{ ...chunks[0]!, id: "large:chunk:1", text }],
      { maxChunkChars: 5000 },
    );

    expect(Math.max(...chunks.map((chunk) => chunk.text.length))).toBeLessThanOrEqual(1200);
    expect(selected[0]?.text.length).toBeLessThanOrEqual(1200);
  });

  test("clamps direct chunk selection to 8 chunks per file", () => {
    const chunks = Array.from({ length: 12 }, (_, index) => ({
      id: `many:chunk:${index + 1}`,
      source: "many.md",
      text: `chunk-${index + 1}`,
      tokenEstimate: 1,
    }));

    expect(selectReferenceChunks(chunks, { maxChunks: 100 })).toHaveLength(8);
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
    expect(pack.promptText).toContain("visual and technical system, not a finished artifact to copy");
    expect(pack.promptText).toContain("Derive the content structure from the current brief");
    expect(pack.promptText).toContain("Preserve the template's design tokens");
    expect(pack.totalChars).toBeLessThanOrEqual(1800);
    expect(pack.warnings).toContain("Excluded 1 low-quality reference file.");
  });

  test("omits summaries when the summary budget is zero", () => {
    const file = {
      id: "ref_summary_zero",
      fileName: "summary.md",
      mimeType: "text/markdown",
      size: 10,
      sourceMode: "memory" as const,
      extractedText: "A sufficiently readable reference body for testing.",
      summary: "This summary must not be included.",
      chunks: [],
      quality: "high" as const,
      warnings: [],
    };

    const pack = packReferenceContext([file], { maxSummaryChars: 0 });

    expect(pack.promptText).not.toContain(file.summary);
  });

  test("clamps oversized prompt-pack budgets to the global ceilings", () => {
    const file = {
      id: "ref_caps",
      fileName: "caps.md",
      mimeType: "text/markdown",
      size: 10,
      sourceMode: "memory" as const,
      extractedText: "Readable reference body with enough content for quality checks.",
      summary: "s".repeat(5000),
      chunks: Array.from({ length: 12 }, (_, index) => ({
        id: `caps:chunk:${index + 1}`,
        source: "caps.md",
        text: `chunk-${index}-` + "c".repeat(1800),
        tokenEstimate: 1,
      })),
      quality: "high" as const,
      warnings: [],
    };

    const pack = packReferenceContext([file], {
      maxSummaryChars: 5000,
      maxChunkChars: 5000,
      maxChunksPerFile: 100,
      maxTotalChars: 50000,
    });
    const summary = pack.promptText.match(/Summary:\n([\s\S]*?)\n\nRelevant excerpts:/)?.[1] ?? "";
    const excerpts = pack.promptText.match(/\[excerpt\] ([^\n]*)/g) ?? [];

    expect(summary.length).toBeLessThanOrEqual(1200);
    expect(excerpts.length).toBeLessThanOrEqual(8);
    expect(Math.max(...excerpts.map((excerpt) => excerpt.length - "[excerpt] ".length))).toBeLessThanOrEqual(1200);
    expect(pack.totalChars).toBeGreaterThan(1200);
    expect(pack.totalChars).toBeLessThanOrEqual(12000);
  });

  test("returns an empty prompt when the total budget is zero", () => {
    const pack = packReferenceContext([], { maxTotalChars: 0 });

    expect(pack.promptText).toBe("");
    expect(pack.totalChars).toBe(0);
  });

  test("returns an empty prompt when every reference is rejected", () => {
    const rejected: ReferenceIngestionResult = {
      id: "rejected",
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      size: 100,
      sourceMode: "memory",
      extractedText: "",
      summary: "",
      chunks: [],
      quality: "failed",
      warnings: ["No reliable body text was extracted."],
    };

    const pack = packReferenceContext([rejected]);

    expect(pack.promptText).toBe("");
    expect(pack.totalChars).toBe(0);
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

describe("reference extractors", () => {
  test("uses PDF.js legacy browser builds for Electron compatibility", () => {
    const source = readFileSync(new URL("../src/react-app/domains/session/references/extractors/pdf.ts", import.meta.url), "utf8");

    expect(source).toContain('import("pdfjs-dist/legacy/build/pdf.mjs")');
    expect(source).toContain('import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")');
    expect(source).not.toContain('import("pdfjs-dist")');
    expect(source).not.toContain('import("pdfjs-dist/build/pdf.worker.mjs?url")');
  });

  test("polyfills Uint8Array.toHex when the Electron runtime does not provide it", () => {
    const prototype = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
    const descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toHex");

    if (descriptor && !descriptor.configurable) {
      expect(typeof prototype.toHex).toBe("function");
      return;
    }

    try {
      delete prototype.toHex;
      ensurePdfTypedArrayHexSupport();
      expect(new Uint8Array([0, 1, 15, 16, 255]).toHex()).toBe("00010f10ff");
    } finally {
      if (descriptor) {
        Object.defineProperty(Uint8Array.prototype, "toHex", descriptor);
      } else {
        delete prototype.toHex;
      }
    }
  });

  test("extracts readable text into page-aware chunks from a valid PDF", async () => {
    const file = new File([createTextPdf("Node PDF extraction works")], "readable.pdf", { type: "application/pdf" });
    const extracted = await extractPdfReference(file);

    expect(extracted.text).toContain("Node PDF extraction works");
    expect(extracted.metadata).toEqual({ pages: 1 });
    expect(extracted.chunks).toHaveLength(1);
    expect(extracted.chunks[0]).toMatchObject({ source: "readable.pdf", page: 1, text: "Node PDF extraction works" });
  });

  test("fails cleanly for invalid PDF bytes", async () => {
    const extracted = await extractPdfReference(new File(["not a pdf"], "broken.pdf", { type: "application/pdf" }));

    expect(extracted.text).toBe("");
    expect(extracted.chunks).toEqual([]);
    expect(extracted.warnings?.some((warning) => warning.includes("PDF parsing failed"))).toBe(true);
  });

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

  test("profiles quoted CSV records containing embedded newlines", async () => {
    const csv = 'name,notes\nAlice,"first line\nsecond line"\nBob,"plain"';
    const extracted = await extractTableReference(new File([csv], "notes.csv", { type: "text/csv" }));

    expect(extracted.metadata).toMatchObject({ rows: 2, columns: 2 });
    expect(extracted.text).toContain("Alice | first line\nsecond line");
    expect(extracted.text).toContain("Bob | plain");
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

  test("bounds deeply nested JSON samples and long string values", async () => {
    const data = [{
      id: 1,
      payload: "x".repeat(100_000),
      nested: { one: { two: { three: { four: { five: "too deep" } } } } },
    }];
    const extracted = await extractTableReference(new File([JSON.stringify(data)], "large.json", { type: "application/json" }));

    expect(extracted.text.length).toBeLessThanOrEqual(12_000);
    expect(extracted.text).not.toContain("x".repeat(1_000));
    expect(extracted.text).toContain("[truncated]");
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

  test("extracts DOCX XML with alternate prefixes and single-quoted attributes", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <x:document xmlns:x='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>
        <x:body>
          <x:p><x:pPr><x:pStyle x:val='Heading2'/></x:pPr><x:r><x:t>XML-safe heading</x:t></x:r></x:p>
          <x:p><x:r><x:t>Literal &amp; ampersand.</x:t></x:r></x:p>
        </x:body>
      </x:document>`);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([buffer], "xml-safe.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const extracted = await extractDocxReference(file);

    expect(extracted.text).toContain("XML-safe heading");
    expect(extracted.text).toContain("Literal & ampersand.");
    expect(extracted.chunks?.some((chunk) => chunk.heading === "XML-safe heading")).toBe(true);
  });

  test("keeps DOCX heading chunks scoped to their sections", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>First section</w:t></w:r></w:p>
          <w:p><w:r><w:t>Alpha body detail.</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Second section</w:t></w:r></w:p>
          <w:p><w:r><w:t>Beta body detail.</w:t></w:r></w:p>
        </w:body>
      </w:document>`);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([buffer], "sections.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const extracted = await extractDocxReference(file);

    const first = extracted.chunks?.find((chunk) => chunk.heading === "First section");
    const second = extracted.chunks?.find((chunk) => chunk.heading === "Second section");
    expect(first?.text).toContain("Alpha body detail.");
    expect(first?.text).not.toContain("Beta body detail.");
    expect(second?.text).toContain("Beta body detail.");
    expect(second?.text).not.toContain("Alpha body detail.");
  });

  test("extracts PPTX slide text as page-aware chunks", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><p:sp><p:txBody>
          <a:p><a:r><a:t>Investor Briefing</a:t></a:r></a:p>
          <a:p><a:r><a:t>Audience: enterprise buyers.</a:t></a:r></a:p>
        </p:txBody></p:sp></p:spTree></p:cSld>
      </p:sld>`);
    zip.file("ppt/slides/slide2.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><p:sp><p:txBody>
          <a:p><a:r><a:t>Requirements: explain security posture and migration plan.</a:t></a:r></a:p>
        </p:txBody></p:sp></p:spTree></p:cSld>
      </p:sld>`);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([buffer], "briefing.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const extracted = await extractPptxReference(file);

    expect(extracted.metadata).toMatchObject({ pages: 2 });
    expect(extracted.text).toContain("Investor Briefing");
    expect(extracted.text).toContain("Audience: enterprise buyers.");
    expect(extracted.text).toContain("Requirements: explain security posture and migration plan.");
    expect(extracted.chunks?.map((chunk) => chunk.page)).toEqual([1, 2]);
  });
});

describe("reference ingestion router", () => {
  test("does not send original source files unless opt in is selected", async () => {
    const file = new File([
      "Audience: team\nRequirements: provide a concise, source-grounded template brief for the upcoming review.",
    ], "source.txt", { type: "text/plain" });
    const result = await ingestReferenceFile(file);
    const reference: TemplateReferenceItem = {
      id: result.id,
      file,
      fileName: result.fileName,
      mimeType: result.mimeType,
      size: result.size,
      status: "ready",
      sendOriginal: false,
      ingestion: result,
    };

    const defaultPayload = await buildTemplateReferenceSubmitPayload([reference]);
    expect(defaultPayload.contextPack.promptText).toContain("source.txt");
    expect(defaultPayload.attachments).toEqual([]);
    expect(result.sourceMode).toBe("memory");

    const optInPayload = await buildTemplateReferenceSubmitPayload([{ ...reference, sendOriginal: true }]);
    expect(optInPayload.attachments).toHaveLength(1);
    expect(optInPayload.attachments[0]?.name).toBe("source.txt");
  });

  test("ignores original-file opt in when a reference exceeds the attachment limit", async () => {
    const file = new File(["oversized"], "oversized.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });
    const result = await ingestReferenceFile(file);
    const reference: TemplateReferenceItem = {
      id: result.id,
      file,
      fileName: result.fileName,
      mimeType: result.mimeType,
      size: result.size,
      status: "failed",
      sendOriginal: true,
      ingestion: result,
    };

    const payload = await buildTemplateReferenceSubmitPayload([reference]);

    expect(payload.attachments).toEqual([]);
  });

  test("accepts existing reference file types", () => {
    expect(isReferenceFile(new File(["x"], "brief.pdf", { type: "application/pdf" }))).toBe(true);
    expect(isReferenceFile(new File(["x"], "brief.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toBe(true);
    expect(isReferenceFile(new File(["x"], "brief.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))).toBe(true);
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

  test("routes invalid PDF through failed quality without throwing", async () => {
    const result = await ingestReferenceFile(new File(["not a pdf"], "broken.pdf", { type: "application/pdf" }));

    expect(result.quality).toBe("failed");
    expect(result.warnings.some((warning) => warning.includes("PDF parsing failed"))).toBe(true);
  });

  test("routes invalid JSON through failed quality without throwing", async () => {
    const result = await ingestReferenceFile(new File(["{\"broken\""], "broken.json", { type: "application/json" }));

    expect(result.quality).toBe("failed");
    expect(result.chunks).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("Reference parsing failed"))).toBe(true);
  });

  test("routes PDFs by extension before generic text handling", async () => {
    const file = new File(["not a pdf"], "broken.pdf", { type: "text/plain" });
    Object.defineProperty(file, "type", { value: "text/plain" });
    const result = await ingestReferenceFile(file);

    expect(result.quality).toBe("failed");
    expect(result.warnings.some((warning) => warning.includes("PDF parsing failed"))).toBe(true);
  });

  test("autofills only from high and medium quality references", () => {
    const text = "# Product Launch\n\nAudience: enterprise design teams.\n\nRequirements: preserve template layout.";
    const good = {
      id: "good",
      fileName: "launch.md",
      mimeType: "text/markdown",
      size: 100,
      sourceMode: "memory" as const,
      extractedText: text,
      summary: "File: launch.md",
      chunks: chunkPlainText({ source: "launch.md", text }),
      quality: "high" as const,
      warnings: [],
    };
    const bad = { ...good, id: "bad", fileName: "bad.pdf", extractedText: "Chromium", quality: "failed" as const };

    const brief = inferTemplateBriefFromIngestions([bad, good]);

    expect(brief.title).toBe("Product Launch");
    expect(brief.audience).toContain("enterprise design teams");
    expect(brief.details).toContain("preserve template layout");
  });

  test("autofills Chinese-labeled audience and requirement fields", () => {
    const text = "# 临床交接看板\n\n目标用户：七病区护士\n\n需求：展示风险、负责人和升级路径。";
    const ingestion: ReferenceIngestionResult = {
      id: "zh",
      fileName: "临床交接.md",
      mimeType: "text/markdown",
      size: text.length,
      sourceMode: "memory",
      extractedText: text,
      summary: "File: 临床交接.md",
      chunks: chunkPlainText({ source: "临床交接.md", text }),
      quality: "high",
      warnings: [],
    };

    const brief = inferTemplateBriefFromIngestions([ingestion]);

    expect(brief.title).toBe("临床交接看板");
    expect(brief.audience).toBe("七病区护士");
    expect(brief.details).toBe("展示风险、负责人和升级路径。");
  });

  test("prepares original attachments only for explicit opt in", async () => {
    const attachment = await prepareOriginalReferenceAttachment(new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(attachment.name).toBe("notes.txt");
    expect(attachment.mimeType).toBe("text/plain");
    expect(attachment.kind).toBe("file");
    expect(await attachment.file.text()).toBe("hello");
  });
});
