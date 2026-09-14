import type JSZip from "jszip";
import type { ReferenceAsset } from "../types";

export const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

const packageBudgets = new WeakMap<JSZip, { bytes: number }>();
function packageBudget(zip: JSZip) {
  let budget = packageBudgets.get(zip);
  if (!budget) { budget = { bytes: 0 }; packageBudgets.set(zip, budget); }
  return budget;
}

// Stop decompression before materializing an oversized XML/media part in memory.
async function readPart(entry: JSZip.JSZipObject, limit: number, budget: { bytes: number }): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    // JSZip 3.10.1 omits this documented browser API from JSZipObject's typings.
    // https://stuk.github.io/jszip/documentation/api_zipobject/internal_stream.html
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream("uint8array");
    stream.on("data", (chunk) => {
      size += chunk.length;
      budget.bytes += chunk.length;
      if (budget.bytes > 200_000_000) { stream.pause(); reject(new Error("Office expanded content exceeds 200 MB; split the document.")); return; }
      if (size > limit) { stream.pause(); reject(new Error(`Office part exceeds ${limit} bytes: ${entry.name}`)); return; }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    }).resume();
  });
}

export async function officeXml(zip: JSZip, path: string) {
  const entry = zip.file(path);
  return entry ? new TextDecoder().decode(await readPart(entry, 100_000_000, packageBudget(zip))) : undefined;
}

export function xmlDocument(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid Office XML.");
  return doc;
}

export function descendants(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", name));
}

export function officeText(node: Node): string {
  if (node.nodeType !== 1 && node.nodeType !== 9) return "";
  if (node.nodeType === 1) {
    const element = node as Element;
    if (element.localName === "del" || element.localName === "instrText") return "";
    if (element.localName === "t") return element.textContent ?? "";
    if (element.localName === "tab") return "\t";
    if (element.localName === "br" || element.localName === "cr") return "\n";
    if (element.localName === "p") return Array.from(element.childNodes).map(officeText).join("") + "\n";
  }
  return Array.from(node.childNodes).map(officeText).join("");
}

export function officeTables(doc: Document) {
  return descendants(doc, "tbl").map((table) => ({
    rows: Array.from(table.childNodes).filter((node): node is Element => node.nodeType === 1 && "localName" in node && node.localName === "tr")
      .map((row) => Array.from(row.childNodes).filter((node): node is Element => node.nodeType === 1 && "localName" in node && node.localName === "tc")
        .map((cell) => ({
          text: officeText(cell).trim(),
          colSpan: Number(descendants(cell, "gridSpan")[0]?.getAttributeNS(WORD_NS, "val") || cell.getAttribute("gridSpan") || 1),
          rowSpan: Number(cell.getAttribute("rowSpan") || 1),
          verticalMerge: descendants(cell, "vMerge")[0]?.getAttributeNS(WORD_NS, "val") ?? (descendants(cell, "vMerge").length ? "continue" : undefined),
        }))),
  }));
}

function resolvePart(source: string, target: string): string | undefined {
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.includes("\\")) return undefined;
  const segments = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") { if (!segments.length) return undefined; segments.pop(); }
    else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

export async function officeRelationships(zip: JSZip, part: string) {
  const path = part.split("/");
  const name = path.pop();
  const xml = await officeXml(zip, [...path, "_rels", `${name}.rels`].join("/"));
  if (!xml) return [];
  return descendants(xmlDocument(xml), "Relationship").map((item) => {
    const external = item.getAttribute("TargetMode") === "External";
    const target = item.getAttribute("Target") ?? "";
    return { id: item.getAttribute("Id") ?? "", type: item.getAttribute("Type")?.split("/").pop() ?? "", external, target: external ? target : resolvePart(part, target) };
  });
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  tif: "image/tiff", tiff: "image/tiff", emf: "image/emf", wmf: "image/wmf",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", wmv: "video/x-ms-wmv",
};

/** One package reader shared by Word and PowerPoint; never fetch external relationships. */
export function officePackage(zip: JSZip) {
  if (Object.keys(zip.files).length > 4096) throw new Error("Office package contains more than 4096 entries; split the document.");
  const warnings: string[] = [];
  const binaries = new Map<string, File>();
  let totalBytes = 0;
  let mediaCount = 0;
  return {
    warnings,
    async inspect(part: string, doc: Document, page?: number) {
      const assets: ReferenceAsset[] = [];
      const related: Array<{ sourcePart: string; type: string; text: string; data: unknown }> = [];
      const relationships = await officeRelationships(zip, part);
      for (const rel of relationships) {
        if (!rel.target) { warnings.push(`Invalid relationship target in ${part}: ${rel.id}`); continue; }
        const target = rel.target;
        if (["image", "video", "audio", "media", "oleObject", "package", "hyperlink"].includes(rel.type)) {
          const extension = target.split(".").pop()?.toLowerCase() ?? "";
          const mime = MIME[extension] ?? "application/octet-stream";
          const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : rel.type === "hyperlink" ? "link" : "embedded";
          const refs = descendants(doc, "*").filter((element) => Array.from(element.attributes).some((attr) => attr.namespaceURI === REL_NS && attr.value === rel.id));
          const descriptions = refs.flatMap((element) => {
            let parent: Element | null = element;
            while (parent && !["pic", "graphicFrame", "drawing", "object", "sp"].includes(parent.localName)) parent = parent.parentElement ?? (parent.parentNode?.nodeType === 1 ? parent.parentNode as Element : null);
            return parent ? [...descendants(parent, "docPr"), ...descendants(parent, "cNvPr")].flatMap((item) => [item.getAttribute("descr"), item.getAttribute("title"), item.getAttribute("name")]).filter(Boolean) : [];
          });
          let file = binaries.get(target);
          if (!rel.external && !file && kind !== "link") {
            const entry = zip.file(target);
            if (!entry) warnings.push(`Missing embedded file: ${target}`);
            else if (mediaCount >= 128 || totalBytes >= 100_000_000) warnings.push(`Media extraction limit reached; retained source location: ${target}`);
            else {
              mediaCount += 1;
              try {
                const bytes = await readPart(entry, Math.min(50_000_000, 100_000_000 - totalBytes), packageBudget(zip));
                file = new File([bytes], target.split("/").pop() || "media", { type: mime }); binaries.set(target, file); totalBytes += bytes.length;
              } catch (error) { warnings.push(error instanceof Error ? error.message : `Unable to extract ${target}`); }
            }
          }
          assets.push({ sourcePart: part, path: target, page, kind, external: rel.external, description: [...new Set(descriptions)].join("; ") || undefined, file });
        }
        if (!rel.external && ["chart", "diagramData", "notesSlide", "comments"].includes(rel.type)) {
          const xml = await officeXml(zip, target);
          if (!xml) { warnings.push(`Missing related part: ${target}`); continue; }
          const relatedDoc = xmlDocument(xml);
          const text = officeText(relatedDoc).trim();
          const series = descendants(relatedDoc, "ser").map((seriesNode) => ({
            text: officeText(seriesNode).trim(),
            sources: Array.from(seriesNode.childNodes).filter((node): node is Element => node.nodeType === 1).map((node) => ({
              role: node.localName,
              formulas: descendants(node, "f").map((value) => value.textContent),
              points: descendants(node, "pt").map((point) => ({ index: point.getAttribute("idx"), value: descendants(point, "v")[0]?.textContent ?? "" })),
            })),
          }));
          related.push({ sourcePart: target, type: rel.type, text, data: series.length ? series : { text } });
        }
      }
      return { assets, related };
    },
  };
}
