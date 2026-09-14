import { expect, test } from "bun:test";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { ReferenceDesignSchema } from "@ipollowork/types/reference-context";
import { ingestReferenceFile } from "../src/react-app/domains/session/references/ingestion";
import { buildTemplateReferenceSubmitPayload } from "../src/react-app/domains/session/references/template-reference-submit";
import { inferTemplateBriefFromIngestions } from "../src/react-app/domains/session/references/brief-autofill";

Object.assign(globalThis, { DOMParser });
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (type: string, target: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${R}/${type}" Target="${target}"/></Relationships>`;

test("PPT resolves each page's theme, master typography, layout geometry and explicit overrides", async () => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId r:id="s1"/><p:sldId r:id="s2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1, 2].map((i) => `<Relationship Id="s${i}" Type="${R}/slide" Target="slides/slide${i}.xml"/>`).join("")}</Relationships>`);
  for (const i of [1, 2]) {
    zip.file(`ppt/slides/slide${i}.xml`, `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>Product title ${i}</a:t></a:r><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:rPr><a:t> subtitle</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, rels("slideLayout", `../slideLayouts/layout${i}.xml`));
    zip.file(`ppt/slideLayouts/layout${i}.xml`, `<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="127000" y="254000"/><a:ext cx="1270000" cy="635000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`);
    zip.file(`ppt/slideLayouts/_rels/layout${i}.xml.rels`, rels("slideMaster", `../slideMasters/master${i}.xml`));
    zip.file(`ppt/slideMasters/master${i}.xml`, `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg></p:cSld><p:clrMap bg1="lt1" tx1="dk1"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="3600"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle></p:txStyles></p:sldMaster>`);
    zip.file(`ppt/slideMasters/_rels/master${i}.xml.rels`, rels("theme", `../theme/theme${i}.xml`));
    zip.file(`ppt/theme/theme${i}.xml`, `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="${i === 1 ? "FF0000" : "00FF00"}"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Font${i}"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>`);
  }
  const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "themes.pptx");
  const ingestion = await ingestReferenceFile(file);
  const design = ReferenceDesignSchema.parse(ingestion.style?.design);
  expect(design.pages[0]).toMatchObject({ widthPt: 720, heightPt: 405, background: "#FFFFFF" });
  expect(design.pages[0]?.elements[0]).toMatchObject({ role: "title", roleOrigin: "explicit", fontFamily: "Font1", fontSizePt: 36, color: "#FF0000", bold: true, alignment: "ctr", xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 });
  expect(design.pages[1]?.elements[0]).toMatchObject({ fontFamily: "Font2", color: "#00FF00" });
  expect(design.pages[0]?.elements[1]).toMatchObject({ fontSizePt: 18, color: "#112233" });
  expect(design.palette).toContainEqual({ color: "#FFFFFF", role: "background", count: 2 });
  const payload = await buildTemplateReferenceSubmitPayload([{ id: ingestion.id, file, fileName: file.name, mimeType: ingestion.mimeType, size: file.size, status: "ready", sendOriginal: false, ingestion }]);
  const full = JSON.parse(await payload.attachments.find((item) => item.name === "reference-context.json")!.file.text());
  const compact = JSON.parse(await payload.attachments.find((item) => item.name === "creative-context.json")!.file.text());
  expect(full.files[0].style.design.pages).toHaveLength(2);
  expect(compact.designSystem.observations[0].design.pages).toEqual([]);
  expect(compact.designSystem.observations[0].design.palette).toEqual(design.palette);
  expect(inferTemplateBriefFromIngestions([ingestion]).style).toContain("标题：Font1 36 pt");
});

test("Word combines defaults, basedOn and run overrides while preserving page dimensions and spacing", async () => {
  const zip = new JSZip();
  zip.file("word/styles.xml", `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DefaultFont"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Base"><w:rPr><w:color w:val="123456"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style><w:style w:styleId="Heading1"><w:basedOn w:val="Base"/><w:name w:val="Heading 1"/><w:rPr><w:sz w:val="48"/><w:b/></w:rPr></w:style></w:styles>`);
  zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Inherited title</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:color w:val="ABCDEF"/></w:rPr><w:t> override</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="720"/></w:sectPr></w:body></w:document>`);
  const ingestion = await ingestReferenceFile(new File([await zip.generateAsync({ type: "arraybuffer" })], "styles.docx"));
  const design = ReferenceDesignSchema.parse(ingestion.style?.design);
  expect(design.pages[0]).toMatchObject({ widthPt: 612, heightPt: 792 });
  expect(design.pages[0]?.elements[0]).toMatchObject({ role: "heading", fontFamily: "DefaultFont", fontSizePt: 24, color: "#123456", bold: true, alignment: "center", spaceAfterPt: 6 });
  expect(design.pages[0]?.elements[1]).toMatchObject({ bold: false, color: "#ABCDEF" });
  expect(design.structure).toMatchObject({ margintopPt: 72, marginleftPt: 36 });
});

test.each([
  ["source.md", "# Title\n\n## Detail\n```\n# not a heading\n```\n<div style=\"font-size:32px;color:#123456\">Example</div>", "declared"],
  ["source.txt", "Plain information with no visual formatting.", "structure-only"],
  ["source.csv", "name,value\nA,10\nB,20", "structure-only"],
  ["source.json", '{"design":{"fontFamily":"Arial","fontSize":"24pt","color":"#123456"},"product":{"color":"red"}}', "declared"],
])("%s has a truthful design result", async (name, text, availability) => {
  const ingestion = await ingestReferenceFile(new File([text], name));
  const design = ReferenceDesignSchema.parse(ingestion.style?.design);
  expect(design.availability).toBe(availability);
  expect(design.method).toBe("local-rules");
  if (name.endsWith(".md")) expect(design.structure).toMatchObject({ headingLevel1: 1, headingLevel2: 1 });
  if (name.endsWith(".json")) {
    expect(design.typography).toContainEqual({ fontFamily: "Arial", role: "unknown", count: 1 });
    expect(design.palette.some((item) => item.color === "red")).toBe(false);
  }
  if (availability === "structure-only") expect(design.palette).toEqual([]);
});

test("CSV style columns are declarations and JSON scan limits remain explicit", async () => {
  const csv = await ingestReferenceFile(new File(["fontFamily,color\nArial,#123456"], "tokens.csv"));
  expect(csv.style?.design?.availability).toBe("declared");
  expect(csv.style?.design?.typography[0]?.fontFamily).toBe("Arial");
  const data = Array.from({ length: 6000 }, (_, i) => ({ id: i }));
  const json = await ingestReferenceFile(new File([JSON.stringify(data)], "large.json"));
  expect(json.style?.design?.structure.declarationScanLimited).toBe(1);
  expect(json.structuredData).toHaveLength(6000);
});

test("PDF exposes text typography, page coordinates and drawing colors without guessing background roles", async () => {
  const stream = "BT /F1 30 Tf 1 0 0 rg 20 700 Td (Product title) Tj /F1 12 Tf 0 0 0 rg 0 -40 Td (Body information) Tj 0 -20 Td (More body information) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const ingestion = await ingestReferenceFile(new File([pdf], "styled.pdf"));
  const design = ReferenceDesignSchema.parse(ingestion.style?.design);
  expect(design.pages[0]).toMatchObject({ widthPt: 600, heightPt: 800 });
  expect(design.pages[0]?.elements[0]).toMatchObject({ fontSizePt: 30, role: "heading", roleOrigin: "rule", xPt: 20 });
  expect(design.palette).toContainEqual({ color: "#FF0000", role: "drawing-fill-state", count: 1 });
  expect(design.pages[0]?.background).toBeUndefined();
  expect(design.pages[0]?.elements[0]?.color).toBeUndefined();
  expect(ingestion.extractedText).toContain("More body information");
});

test("explicit text style is read back as a declaration, not lost behind structural metadata", async () => {
  const ingestion = await ingestReferenceFile(new File(["主题：产品介绍\n风格：黑白极简\n字体：Arial\n提供完整的产品介绍及展示要求。"], "brief.txt"));
  expect(ingestion.style?.design?.availability).toBe("declared");
  expect(inferTemplateBriefFromIngestions([ingestion]).style).toContain("黑白极简");
});

test("Markdown code examples do not become the document's design declarations", async () => {
  const ingestion = await ingestReferenceFile(new File(['# Documentation\n```html\n<div style="color:#FF0000">Example</div>\nfontFamily: DemoFont\n```\nNormal content'], "example.md"));
  expect(ingestion.style?.design?.availability).toBe("structure-only");
  expect(ingestion.style?.design?.palette).toEqual([]);
  expect(ingestion.style?.design?.typography).toEqual([]);
});
