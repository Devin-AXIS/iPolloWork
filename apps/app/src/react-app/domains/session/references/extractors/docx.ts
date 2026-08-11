import JSZip from "jszip";
import { chunkPlainText } from "../chunking";
import { cleanReferenceText } from "../quality";
import type { ExtractedReferenceContent } from "../types";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function elementChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function textFromNode(node: Element) {
  return Array.from(node.getElementsByTagNameNS(W_NS, "t"))
    .map((item) => item.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphStyle(paragraph: Element) {
  const style = paragraph.getElementsByTagNameNS(W_NS, "pStyle")[0];
  return style?.getAttributeNS(W_NS, "val") ?? "";
}

export async function extractDocxReference(file: File): Promise<ExtractedReferenceContent> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return { text: "", chunks: [], warnings: ["DOCX document.xml was not found."] };

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) return { text: "", chunks: [], warnings: ["DOCX body was not found."] };

  const lines: string[] = [];
  const sections: Array<{ heading?: string; lines: string[] }> = [{ lines: [] }];
  const headings: string[] = [];
  let currentSection = sections[0]!;
  for (const child of elementChildren(body)) {
    if (child.localName === "p" && child.namespaceURI === W_NS) {
      const text = textFromNode(child);
      if (!text) continue;
      const style = paragraphStyle(child);
      if (/heading/i.test(style)) {
        headings.push(text);
        currentSection = { heading: text, lines: [] };
        sections.push(currentSection);
      }
      lines.push(text);
      currentSection.lines.push(text);
    }
    if (child.localName === "tbl" && child.namespaceURI === W_NS) {
      for (const row of Array.from(child.getElementsByTagNameNS(W_NS, "tr"))) {
        const cells = Array.from(row.getElementsByTagNameNS(W_NS, "tc"))
          .map(textFromNode)
          .filter(Boolean);
        if (cells.length) {
          const rowText = cells.join(" | ");
          lines.push(rowText);
          currentSection.lines.push(rowText);
        }
      }
    }
  }

  const cleaned = cleanReferenceText(lines.join("\n\n"));
  const sectionTexts = sections
    .map((section) => ({ heading: section.heading, text: cleanReferenceText(section.lines.join("\n\n")).text }))
    .filter((section) => section.text);
  const chunks = headings.length && sectionTexts.length
    ? sectionTexts.flatMap((section, sectionIndex) => chunkPlainText({ source: file.name, heading: section.heading, text: section.text })
      .map((chunk, chunkIndex) => ({ ...chunk, id: `${file.name}:section:${sectionIndex + 1}:chunk:${chunkIndex + 1}` })))
    : chunkPlainText({ source: file.name, text: cleaned.text });

  return { text: cleaned.text, chunks, warnings: cleaned.warnings, metadata: { headings } };
}
