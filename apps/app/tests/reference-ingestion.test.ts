import { CreativeContextSchema } from "@ipollowork/types/reference-context";
import { buildCreativeContext } from "../src/react-app/domains/session/references/creative-context";
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
  REFERENCE_MAX_BYTES,
  isReferenceFile,
  prepareOriginalReferenceAttachment,
} from "../src/react-app/domains/session/references/ingestion";
import { buildTemplateReferenceSubmitPayload } from "../src/react-app/domains/session/references/template-reference-submit";
import type { TemplateReferenceItem } from "../src/react-app/domains/session/references/types";
import {
  inferTemplateBriefFromIngestions,
} from "../src/react-app/domains/session/references/brief-autofill";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function rels(items: Array<[string, string, string, boolean?]>) {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;
}

describe("rich reference evidence", () => {
  test("Word style extraction preserves explicit requirements and other evidence", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:background w:color="F0F0F0"/><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:color w:val="112233"/><w:sz w:val="32"/></w:rPr><w:t>价格：1299.50 元；型号：YS-001</w:t></w:r></w:p><w:p><w:r><w:t>要求：保留准确数字</w:t></w:r></w:p></w:body></w:document>`);
    zip.file("word/styles.xml", `<w:styles xmlns:w="${W}"><w:style><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/></w:rPr></w:style></w:styles>`);
    const result = await ingestReferenceFile(new File([await zip.generateAsync({ type: "arraybuffer" })], "style.docx"));
    expect(result.style).toMatchObject({ fonts: ["Arial", "Microsoft YaHei"], colors: ["#112233"], backgrounds: ["#F0F0F0"], fontSizesPt: [16] });
    const brief = inferTemplateBriefFromIngestions([result]);
    expect(brief.style).toContain("#112233");
    expect(brief.details).toContain("1299.50");
    expect(brief.details).toContain("YS-001");
    expect(brief.details).toContain("保留准确数字");
  });
  test("Word preserves blank table cells, header/footer, footnotes and media bytes", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:del w:id="7" w:author="Editor"><w:r><w:delText>旧价格 1999</w:delText></w:r></w:del><w:ins w:id="8"><w:r><w:t>新价格 1299</w:t></w:r></w:ins></w:p><w:p><w:r><w:t>产品介绍与使用要求</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><wp:docPr descr="产品正面照"/><a:blip r:embed="photo"/></w:drawing></w:r></w:p></w:body></w:document>`);
    zip.file("word/_rels/document.xml.rels", rels([["h", "header", "header1.xml"], ["f", "footer", "footer1.xml"], ["n", "footnotes", "footnotes.xml"], ["photo", "image", "media/photo.png"], ["movie", "video", "media/demo.mp4"], ["web", "hyperlink", "https://example.invalid/resource", true]]));
    for (const [part, text] of [["header1.xml", "品牌 ACME"], ["footer1.xml", "内部资料"], ["footnotes.xml", "价格含税条件以本注释为准"]]) zip.file(`word/${part}`, `<w:root xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:root>`);
    zip.file("word/media/photo.png", new Uint8Array([1, 2, 3]));
    zip.file("word/media/demo.mp4", new Uint8Array([4, 5, 6]));
    const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "rich.docx");
    const result = await ingestReferenceFile(file);
    expect(result.extractedText).toContain("A |  | C");
    expect(result.extractedText).toContain("价格含税条件");
    expect(result.extractedText).toContain("品牌 ACME");
    expect(result.extractedText).toContain("内部资料");
    expect(result.assets?.find((asset) => asset.kind === "image")?.description).toContain("产品正面照");
    expect(new Uint8Array(await result.assets!.find((asset) => asset.kind === "video")!.file!.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
    expect(result.assets?.find((asset) => asset.kind === "link")).toMatchObject({ external: true, file: undefined });
    const payload = await buildTemplateReferenceSubmitPayload([{ id: result.id, file, fileName: file.name, mimeType: result.mimeType, size: file.size, status: "ready", sendOriginal: false, ingestion: result }]);
    const context = JSON.parse(await payload.attachments[0]!.file.text());
    expect(context.files[0].structuredData.sections[0].tables[0].rows[0]).toHaveLength(3);
    expect(context.files[0].structuredData.sections[0].review).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "del", id: "7", author: "Editor", text: "旧价格 1999" }), expect.objectContaining({ kind: "ins", text: "新价格 1299" })]));
    expect(result.extractedText).not.toContain("旧价格 1999");
    for (const asset of context.files[0].assets.filter((asset: { attachmentName?: string }) => asset.attachmentName)) expect(payload.attachments.some((attachment) => attachment.name === asset.attachmentName && attachment.delivery === "workspace")).toBe(true);
    expect(context.files[0].assets.every((asset: object) => !("file" in asset))).toBe(true);
    expect(payload.contextPack.promptText).toContain("video");
    expect(result.coverage).toEqual({ text: "complete", visuals: "not-supported" });
  });

  test("PPT follows presentation order and retains notes, chart values and shared media provenance", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", rels([["first", "slide", "slides/slide1.xml"], ["second", "slide", "slides/slide2.xml"]]));
    for (const number of [1, 2]) {
      zip.file(`ppt/slides/slide${number}.xml`, `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Product title"/></p:nvSpPr><p:spPr><a:xfrm rot="60000"><a:off x="120" y="240"/><a:ext cx="360" cy="480"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Requirements: slide ${number} detailed product evidence.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
      zip.file(`ppt/slides/_rels/slide${number}.xml.rels`, rels([["image", "image", "../media/shared.png"], ["notes", "notesSlide", "../notesSlides/notesSlide1.xml"], ["chart", "chart", "../charts/chart1.xml"]]));
    }
    zip.file("ppt/media/shared.png", "image-bytes");
    zip.file("ppt/slideMasters/master1.xml", `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:bg><a:solidFill><a:srgbClr val="123456"/></a:solidFill></p:bg></p:cSld></p:sldMaster>`);
    zip.file("ppt/slideMasters/_rels/master1.xml.rels", rels([["bg", "image", "../media/background.png"]]));
    zip.file("ppt/media/background.png", "background-bytes");
    zip.file("ppt/notesSlides/notesSlide1.xml", `<p:notes xmlns:p="${P}" xmlns:a="${A}"><a:p><a:r><a:t>演讲备注：上市时间为十月，不要提前发布。</a:t></a:r></a:p></p:notes>`);
    zip.file("ppt/charts/chart1.xml", `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:ser><c:val><c:numRef><c:f>Sheet1!B2</c:f><c:numCache><c:pt idx="0"><c:v>1299.50</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:chart></c:chartSpace>`);
    const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "rich.pptx");
    const result = await ingestReferenceFile(file);
    expect(result.chunks[0]?.text).toContain("slide 2");
    expect(result.chunks[0]?.page).toBe(1);
    expect(result.extractedText).toContain("不要提前发布");
    expect(result.extractedText).toContain("1299.50");
    expect(result.assets?.filter((asset) => asset.kind === "image").map((asset) => asset.page)).toEqual([1, 2, undefined]);
    expect(result.style?.backgrounds).toEqual(["#123456"]);
    const payload = await buildTemplateReferenceSubmitPayload([{ id: result.id, file, fileName: file.name, mimeType: result.mimeType, size: file.size, status: "ready", sendOriginal: false, ingestion: result }]);
    expect(payload.attachments.filter((attachment) => attachment.name.endsWith("shared.png"))).toHaveLength(1);
    const context = JSON.parse(await payload.attachments[0]!.file.text());
    expect(context.files[0].assets[0].attachmentName).toBe(context.files[0].assets[1].attachmentName);
    const background = context.files[0].assets.find((asset: { sourcePart: string }) => asset.sourcePart === "ppt/slideMasters/master1.xml");
    expect(await payload.attachments.find((item) => item.name === background.attachmentName)!.file.text()).toBe("background-bytes");
    expect(context.files[0].style.backgrounds).toEqual(["#123456"]);
    const creative = CreativeContextSchema.parse(JSON.parse(await payload.attachments.find((item) => item.name === "creative-context.json")!.file.text()));
    expect(creative.content.sections[0]?.excerpt).toContain("slide 2");
    expect(creative.designSystem.observations[0]?.backgrounds).toEqual(["#123456"]);
    expect(creative.layoutLanguage.elements[0]?.geometryPointer).toBe("/files/0/structuredData/slides/0/shapes/0/transform");
    expect(creative.assets[0]?.file).toEqual(creative.assets[1]?.file);
    expect(creative.assets[0]?.page).toBe(1);
    expect(creative.assets[1]?.page).toBe(2);
    expect(creative.assets.every((asset) => asset.semanticRole === null)).toBe(true);
    expect(creative.motionLanguage.status).toBe("not-analyzed");

    expect(payload.contextPack.promptText).toContain("reuse extracted local image/video/audio assets");
    expect(context.files[0].structuredData.slides[0].shapes[0]).toMatchObject({ name: "Product title", transform: [{ x: "120", y: "240", width: "360", height: "480", rotation: "60000" }] });
  });

  test("empty structured files are not scored as high quality and unsafe numbers retain exact evidence", async () => {
    for (const [name, text] of [["empty.csv", ""], ["empty.json", "{}"], ["array.json", "[]"]]) expect((await ingestReferenceFile(new File([text!], name!))).quality).toBe("failed");
    const result = await ingestReferenceFile(new File(['{"id":9007199254740993,"amount":0.123456789012345678901}'], "precise.json"));
    expect(result.structuredData).toMatchObject({ id: "9007199254740993", amount: "0.123456789012345678901" });
    expect(result.rawText).toContain("0.123456789012345678901");
    expect(result.warnings.join(" ")).toContain("numbers preserved as strings");
  });

  test("CSV preserves delimiter, every record and raw source", async () => {
    const text = 'name;price;note\nA;99;"line 1\nline 2"\n;;\nB;;last';
    const result = await extractTableReference(new File([text], "semicolon.csv"));
    expect(result.structuredData).toMatchObject({ delimiter: ";", headers: ["name", "price", "note"], records: [["name", "price", "note"], ["A", "99", "line 1\nline 2"], ["", "", ""], ["B", "", "last"]] });
    expect(result.rawText).toBe(text);
  });

  test("UTF-16 text and Markdown indentation survive decoding and cleaning", async () => {
    const text = "Creator: Alice\n\n    保留代码缩进\n\t制表符";
    const result = await extractTextReference(new File([new Uint8Array([255, 254]), Buffer.from(text, "utf16le")], "unicode.txt"));
    expect(result.text).toBe(text);
  });

  test("oversized embedded media is explicitly omitted without losing the main text", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Keep readable product requirements despite oversized media.</w:t></w:r></w:p></w:body></w:document>`);
    zip.file("word/_rels/document.xml.rels", rels([["movie", "video", "media/large.mp4"]]));
    zip.file("word/media/large.mp4", new Uint8Array(50_000_001));
    const result = await extractDocxReference(new File([await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })], "large.docx"));
    expect(result.text).toContain("Keep readable");
    expect(result.assets?.[0]?.file).toBeUndefined();
    expect(result.warnings?.join(" ")).toContain("exceeds 50000000 bytes");
  });
});

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
  test("preserves legitimate author and producer lines as source evidence", () => {
    const cleaned = cleanReferenceText([
      "Producer: Skia/PDF m92",
      "Creator: Chromium",
      "CreationDate: D:20241102090758",
      "Real launch plan",
      "Audience: product teams",
    ].join("\n"));

    expect(cleaned.text).toContain("Real launch plan");
    expect(cleaned.text).toContain("Audience: product teams");
    expect(cleaned.text).toContain("Skia/PDF");
    expect(cleaned.text).toContain("Creator: Chromium");
    expect(cleaned.warnings).toEqual([]);
  });

  test("classifies empty extracted content as failed", () => {
    const cleaned = cleanReferenceText("\n \n");
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
    expect(source).toContain('new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href');
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
  test("prefills explicit JSON fields and combines requirements from multiple files", async () => {
    const first = await ingestReferenceFile(new File([JSON.stringify({ title: "秋季产品发布", audience: "设计团队", requirements: "展示自动排版与导出。" })], "brief.json", { type: "application/json" }));
    const second = await ingestReferenceFile(new File(["# 补充资料\n受众：设计团队\n需求：保留实际定价与客户案例，不虚构任何数字。"], "extra.md", { type: "text/markdown" }));
    const brief = inferTemplateBriefFromIngestions([first, second]);
    expect(brief.title).toBe("秋季产品发布");
    expect(brief.audience).toBe("设计团队");
    expect(brief.details).toContain("展示自动排版与导出。");
    expect(brief.details).toContain("保留实际定价与客户案例");
  });
  test("preserves later sections and complete structured records in the shared JSON", async () => {
    const files = [
      new File(["Launch requirements. ".repeat(800) + "FINAL_EVIDENCE_42"], "long.txt", { type: "text/plain" }),
      new File(["name,value\n" + Array.from({ length: 40 }, (_, index) => `record${index},${index}`).join("\n")], "table.csv", { type: "text/csv" }),
      new File([JSON.stringify({ records: Array.from({ length: 40 }, (_, index) => ({ index, description: "x".repeat(300) })) })], "records.json", { type: "application/json" }),
    ];
    const references: TemplateReferenceItem[] = [];
    for (const file of files) {
      const ingestion = await ingestReferenceFile(file);
      references.push({ id: ingestion.id, file, fileName: file.name, mimeType: ingestion.mimeType, size: file.size, status: "ready", sendOriginal: false, ingestion });
    }
    const payload = await buildTemplateReferenceSubmitPayload(references);
    const context = JSON.parse(await payload.attachments[0]!.file.text());
    expect(context.files).toHaveLength(3);
    expect(context.files[0].text).toEndWith("FINAL_EVIDENCE_42");
    expect(context.files[1].structuredData.rows.at(-1)).toEqual(["record39", "39"]);
    expect(context.files[2].structuredData.records[39].description).toHaveLength(300);
    expect(payload.attachments[0]?.delivery).toBe("workspace");
    expect(payload.contextPack.promptText).toContain("using file tools before generating");
  });

  test("preserves repeated source evidence and mentions of Chromium", () => {
    const text = "Chromium browser adoption\nOwner: Alice\nOwner: Alice";
    expect(cleanReferenceText(text).text).toBe(text);
  });

  test("reports monotonic parsing progress, metadata and failed-file completion", async () => {
    const progress: number[] = [];
    const result = await ingestReferenceFile(new File([createTextPdf("Audience: Enterprise product teams with a new launch.")], "readable.pdf", { type: "application/pdf" }), (value) => progress.push(value));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(result.metadata?.pages).toBe(1);
    const failedProgress: number[] = [];
    await ingestReferenceFile(new File(["{"], "broken.json", { type: "application/json" }), (value) => failedProgress.push(value));
    expect(failedProgress.at(-1)).toBe(100);
  });

  test("does not allow a partially parsed reference batch to be submitted", async () => {
    const file = new File(["pending"], "pending.txt", { type: "text/plain" });
    await expect(buildTemplateReferenceSubmitPayload([{ id: "pending", file, fileName: file.name, mimeType: file.type, size: file.size, status: "parsing", sendOriginal: false }])).rejects.toThrow("Wait for reference parsing");
    expect((await buildTemplateReferenceSubmitPayload([])).attachments).toEqual([]);
  });

  test("rejects independent image references without inventing text", async () => {
    const file = new File(["image"], "image.png", { type: "image/png" });
    const ingestion = await ingestReferenceFile(file);
    const payload = await buildTemplateReferenceSubmitPayload([{ id: ingestion.id, file, fileName: file.name, mimeType: file.type, size: file.size, status: "failed", sendOriginal: false, ingestion }]);
    const context = JSON.parse(await payload.attachments[0]!.file.text());
    expect(context.files[0].text).toBe("");
    expect(context.files[0].quality).toBe("failed");
    expect(context.files[0].warnings.join(" ")).toContain("Unsupported reference type");
  });

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
    expect(defaultPayload.attachments.map((attachment) => attachment.name)).toEqual(["reference-context.json", "reference-1-asset-1-source.txt", "creative-context.json"]);
    const context = JSON.parse(await defaultPayload.attachments[0]!.file.text());
    expect(context.schemaVersion).toBe(1);
    expect(context.files[0].text).toBe(result.extractedText);
    expect(context.files[0].originalAttached).toBe(false);
    expect(result.sourceMode).toBe("memory");

    const optInPayload = await buildTemplateReferenceSubmitPayload([{ ...reference, sendOriginal: true }]);
    expect(optInPayload.attachments).toHaveLength(4);
    expect(optInPayload.attachments[2]?.name).toBe("source.txt");
  });

  test("ignores original-file opt in when a reference exceeds the attachment limit", async () => {
    const file = new File(["oversized"], "oversized.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: REFERENCE_MAX_BYTES + 1 });
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

    expect(payload.attachments.map((attachment) => attachment.name)).toEqual(["reference-context.json", "creative-context.json"]);
    const context = JSON.parse(await payload.attachments[0]!.file.text());
    expect(context.files[0].quality).toBe("failed");
    expect(context.files[0].originalAttached).toBe(false);
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
    expect(brief.details).toContain("展示风险、负责人和升级路径。");
  });

  test("prepares original attachments only for explicit opt in", async () => {
    const attachment = await prepareOriginalReferenceAttachment(new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(attachment.name).toBe("notes.txt");
    expect(attachment.mimeType).toBe("text/plain");
    expect(attachment.kind).toBe("file");
    expect(await attachment.file.text()).toBe("hello");
  });
});


describe("local-only reference limits and completeness", () => {
  test.each(["pdf", "docx", "pptx", "md", "txt", "csv", "json"])("%s accepts 50,000,000 bytes and rejects one byte more", async (extension) => {
    const file = new File(["fixture"], `source.${extension}`);
    Object.defineProperty(file, "size", { value: REFERENCE_MAX_BYTES, configurable: true });
    expect((await prepareOriginalReferenceAttachment(file)).size).toBe(50_000_000);
    Object.defineProperty(file, "size", { value: REFERENCE_MAX_BYTES + 1 });
    expect((await ingestReferenceFile(file)).quality).toBe("failed");
    await expect(prepareOriginalReferenceAttachment(file)).rejects.toThrow("50 MB");
  });
  test.each(["png", "jpg", "jpeg", "webp", "mp3", "wav", "mp4"])("rejects %s even with a misleading text MIME", async (extension) => {
    const file = new File(["not a document"], `source.${extension}`, { type: "text/plain" });
    expect(isReferenceFile(file)).toBe(false);
    const result = await ingestReferenceFile(file);
    expect(result.assets).toBeUndefined();
    expect(result.quality).toBe("failed");
  });
  test("cancellation stops extraction and does not return a successful result", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(ingestReferenceFile(new File(["text"], "source.txt"), undefined, controller.signal)).rejects.toThrow();
  });
  test("large context is losslessly reconstructed from bounded JSON parts", async () => {
    const original = "产品参数😀\"\n".repeat(300_000) + "FINAL_FACT_123";
    const file = new File([original], "large.txt");
    const ingestion = await ingestReferenceFile(file);
    const payload = await buildTemplateReferenceSubmitPayload([{ id: "large", file, fileName: file.name, mimeType: file.type, size: file.size, status: "ready", sendOriginal: false, ingestion }]);
    const manifest = JSON.parse(await payload.attachments[0]!.file.text());
    expect(manifest.storage).toBe("json-string-parts");
    const parts = await Promise.all(manifest.parts.map(async (part: { attachmentName: string }) => {
      const attachment = payload.attachments.find((item) => item.name === part.attachmentName)!;
      expect(attachment.size).toBeLessThan(4_000_000);
      return JSON.parse(await attachment.file.text());
    }));
    const context = JSON.parse(parts.join(""));
    expect(context.files[0].text).toBe(original);
    expect(context.extraction.modelUsed).toBe(false);
    expect(payload.contextPack.promptText).toContain("Do not invoke models for OCR");
  });
  test("Word autofill uses a readable title rather than an opaque filename", () => {
    const result: ReferenceIngestionResult = { id: "doc", fileName: "upload-987.docx", mimeType: "", size: 50, sourceMode: "memory", quality: "medium", warnings: [], chunks: [], extractedText: "智能家居产品发布\n详细功能和参数", summary: "", structuredData: { sections: [] } };
    expect(inferTemplateBriefFromIngestions([result]).title).toBe("智能家居产品发布");
  });
});


test("an oversized Word auxiliary part does not discard readable main content", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Readable main document requirements and product information.</w:t></w:r></w:p></w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", rels([["header", "header", "header1.xml"]]));
  zip.file("word/header1.xml", new Uint8Array(100_000_001));
  const result = await extractDocxReference(new File([await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })], "partial.docx"));
  expect(result.text).toContain("Readable main document");
  expect(result.warnings?.join(" ")).toContain("other readable parts preserved");
});

test("labeled requirements in one reference do not suppress facts from another", async () => {
  const first = await ingestReferenceFile(new File(["# 发布计划\n需求：介绍智能家具的核心功能，并展示家庭实际使用场景及操作流程。"], "brief.md"));
  const second = await ingestReferenceFile(new File(["产品规格参数：支持 220V 供电，质保三年，安装前请确认尺寸与家庭空间匹配。"], "specs.txt"));
  const brief = inferTemplateBriefFromIngestions([first, second]);
  expect(brief.details).toContain("核心功能");
  expect(brief.details).toContain("220V");
  expect(brief.details).toContain("specs.txt");
});


test("CSV retains escaped quotes, CRLF inside cells, and trailing empty columns", async () => {
  const text = 'a,b,c\r\n"say ""hello""","first\r\nsecond",\r\nlast,,end';
  const result = await extractTableReference(new File([text], "quoted.csv"));
  expect(result.structuredData).toMatchObject({ records: [["a", "b", "c"], ['say "hello"', "first\r\nsecond", ""], ["last", "", "end"]] });
});


test("Creative Context bounds excerpts without dropping raw evidence and preserves explicit empty style", async () => {
  const file = new File(["Original evidence"], "source.txt");
  const ingestion = await ingestReferenceFile(file);
  ingestion.chunks = Array.from({ length: 100 }, (_, index) => ({ id: String(index), source: file.name, text: `${index}:` + "x".repeat(1000), tokenEstimate: 250 }));
  ingestion.style = { fonts: ["Arial"], colors: ["#123456"], backgrounds: [], fontSizesPt: [24], sourceParts: ["theme"] };
  const references: TemplateReferenceItem[] = [{ id: ingestion.id, file, fileName: file.name, mimeType: ingestion.mimeType, size: file.size, status: "ready", sendOriginal: false, ingestion }];
  const context = buildCreativeContext(references, { title: "Edited", audience: "Users", details: "Keep facts", style: "" });
  expect(context.content.sections).toHaveLength(48);
  expect(context.content.omittedSections).toBe(52);
  expect(context.content.sections[0]?.excerptTruncated).toBe(true);
  expect(context.designSystem.direction).toBe("");
  expect(context.designSystem.directionOrigin).toBe("user");
  expect(context.designSystem.observations[0]?.colors).toEqual(["#123456"]);
  expect(ingestion.chunks.at(-1)?.text).toStartWith("99:");
  expect(buildCreativeContext(references).designSystem.directionOrigin).toBe("unknown");
});
