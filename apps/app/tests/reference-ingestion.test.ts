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
    expect(pack.totalChars).toBeLessThanOrEqual(12000);
  });

  test("returns an empty prompt when the total budget is zero", () => {
    const pack = packReferenceContext([], { maxTotalChars: 0 });

    expect(pack.promptText).toBe("");
    expect(pack.totalChars).toBe(0);
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
