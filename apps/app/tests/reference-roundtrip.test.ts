import { CreativeContextSchema } from "@ipollowork/types/reference-context";
import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { startServer } from "../../server/src/server";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import { ingestReferenceFile } from "../src/react-app/domains/session/references/ingestion";
import { buildTemplateReferenceSubmitPayload } from "../src/react-app/domains/session/references/template-reference-submit";
import { persistComposerAttachments } from "../src/react-app/shell/session-prompt";

Object.assign(globalThis, { DOMParser });
const head = "FIRST_EVIDENCE_2026";
const tail = "FINAL_EVIDENCE_987654321";
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function fixture(type: string, size: number): Promise<File> {
  if (["txt", "md", "csv", "json"].includes(type)) {
    const prefix = type === "json" ? `{"text":"${head}` : type === "csv" ? `value\n"${head}` : `${head}\n`;
    const suffix = type === "json" ? `${tail}","precise":0.123456789012345678901}` : type === "csv" ? `${tail}"` : tail;
    return new File([prefix, "x".repeat(size - prefix.length - suffix.length), suffix], `boundary.${type}`);
  }
  if (type === "pdf") {
    // Two text pages plus an unreferenced stream exercise real file-size transport.
    const pdf = (padding: number) => {
      const stream = (text: string) => {
        const content = `BT /F1 12 Tf 10 700 Td (${text}) Tj ET`;
        return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      };
      const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
        stream(head),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
        stream(tail),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${padding} >>\nstream\n${"0".repeat(padding)}\nendstream`];
      let result = "%PDF-1.4\n";
      const offsets = [0];
      for (const [i, object] of objects.entries()) { offsets.push(result.length); result += `${i + 1} 0 obj\n${object}\nendobj\n`; }
      const xref = result.length;
      result += `xref\n0 9\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return result;
    };
    let padding = size - pdf(0).length;
    for (let i = 0; i < 3; i++) padding += size - pdf(padding).length;
    return new File([pdf(padding)], "boundary.pdf");
  }
  const zip = new JSZip();
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const main = type === "docx" ? "word/document.xml" : "ppt/slides/slide1.xml";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rootPart = type === "docx" ? main : "ppt/presentation.xml";
  const contentType = type === "docx" ? "wordprocessingml.document" : "presentationml.presentation";
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${rootPart}" ContentType="application/vnd.openxmlformats-officedocument.${contentType}.main+xml"/>${type === "pptx" ? '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' : ""}</Types>`);
  zip.file("_rels/.rels", `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="${rootPart}"/></Relationships>`);
  if (type === "pptx") {
    zip.file(rootPart, `<p:presentation xmlns:p="${p}" xmlns:r="${officeRel}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}/slide" Target="slides/slide1.xml"/></Relationships>`);
  }
  const xml = (text: string) => type === "docx" ? `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>` : `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file(main, xml(head + tail));
  const empty = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  zip.file(main, xml(head + "x".repeat(size - empty.length) + tail));
  return new File([await zip.generateAsync({ type: "uint8array", compression: "STORE" })], `boundary.${type}`);
}

// Run each real 50 MB format in a fresh process to avoid accumulating parser heaps:
// IPOLLOWORK_REFERENCE_LARGE_TYPE=docx bun test tests/reference-roundtrip.test.ts
const type = process.env.IPOLLOWORK_REFERENCE_LARGE_TYPE ?? "json";
const size = process.env.IPOLLOWORK_REFERENCE_LARGE_TYPE ? 50_000_000 : 2_000;
test(`reference ${type}: ${size} real bytes upload, parse, persist, reconstruct and read back`, async () => {
  const root = await mkdtemp(join(tmpdir(), "ipw-reference-roundtrip-"));
  const server = await startServer({ host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: "test-token", hostToken: "host-token", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [{ id: "ws", name: "Reference test", path: root, preset: "starter", workspaceType: "local" }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false });
  try {
    const client = createiPolloWorkServerClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "test-token" });
    const started = Date.now();
    const file = await fixture(type, size);
    expect(file.size).toBe(size);
    const originalHash = hash(new Uint8Array(await file.arrayBuffer()));
    const ingestion = await ingestReferenceFile(file);
    const evidence = ingestion.rawText ?? ingestion.extractedText;
    expect(evidence).toContain(head);
    expect(evidence).toContain(tail);
    expect(ingestion.quality).not.toBe("failed");
    const payload = await buildTemplateReferenceSubmitPayload([{ id: "reference", file, fileName: file.name, mimeType: ingestion.mimeType, size, status: "ready", sendOriginal: false, ingestion }], { brief: { title: "User title", audience: "Users", details: "Keep exact numbers", style: "" } });
    const saved = await persistComposerAttachments({ attachments: payload.attachments, workspaceId: "ws", sessionId: "test", client });
    const contextPath = saved.find((item) => item.name === "reference-context.json")!.workspacePath;
    const inboxPath = contextPath.replace(/^\.opencode\/ipollowork\/inbox\//, "");
    const downloaded = await client.downloadInboxItem("ws", Buffer.from(inboxPath).toString("base64url"));
    const bytes = new Uint8Array(downloaded.data);
    const local = await readFile(join(root, contextPath));
    expect(hash(bytes)).toBe(hash(local));
    const context = JSON.parse(new TextDecoder().decode(bytes));
    expect(context.storage).toBeUndefined();
    expect(context.files[0].rawText ?? context.files[0].text).toBe(evidence);
    const original = saved.find((item) => item.name.endsWith(`-${file.name}`))!;
    const originalRead = await client.downloadInboxItem("ws", Buffer.from(original.workspacePath.replace(/^\.opencode\/ipollowork\/inbox\//, "")).toString("base64url"));
    expect(hash(new Uint8Array(originalRead.data))).toBe(originalHash);
    const creativePath = saved.find((item) => item.name === "creative-context.json")!.workspacePath;
    const creativeDownload = await client.downloadInboxItem("ws", Buffer.from(creativePath.replace(/^\.opencode\/ipollowork\/inbox\//, "")).toString("base64url"));
    const creative = CreativeContextSchema.parse(JSON.parse(new TextDecoder().decode(creativeDownload.data)));
    expect(creative.evidence.workspacePath).toBe(contextPath);
    expect(creative.sources[0]?.original?.workspacePath).toBe(original.workspacePath);
    expect(creative.brief.user?.style).toBe("");
    expect(creative.designSystem.directionOrigin).toBe("user");
    expect(saved.at(-1)?.workspacePath).toBe(creativePath);
    expect(creativeDownload.data.byteLength).toBeLessThan(100_000);
    console.log(JSON.stringify({ creativeBytes: creativeDownload.data.byteLength, type, sourceBytes: size, contextBytes: bytes.length, attachments: saved.length, sha256: hash(bytes), elapsedMs: Date.now() - started, result: "passed" }));
  } finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 300_000);
