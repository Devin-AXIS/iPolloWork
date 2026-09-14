import { CreativeContextSchema, type CreativeContext } from "@ipollowork/types/reference-context";
import type { TemplateBrief } from "../templates/template-brief";
import { inferTemplateBriefFromIngestions } from "./brief-autofill";
import type { TemplateReferenceItem } from "./types";

export const CREATIVE_CONTEXT_FILE_NAME = "creative-context.json";
export function assetAttachmentName(referenceIndex: number, assetIndex: number, name: string) {
  return `reference-${referenceIndex + 1}-asset-${assetIndex + 1}-${name.replace(/[\\/\u0000-\u001f]/g, "-")}`;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }

export function buildCreativeContext(references: TemplateReferenceItem[], brief?: TemplateBrief): CreativeContext {
  const context: CreativeContext = {
    schemaVersion: 1, kind: "creative-context", extraction: { mode: "local", modelUsed: false },
    evidence: { attachmentName: "reference-context.json" },
    brief: { user: brief ?? null, inferred: inferTemplateBriefFromIngestions(references.flatMap((item) => item.ingestion ? [item.ingestion] : [])), inference: "rules" },
    sources: [], content: { sections: [], omittedSections: 0, order: "source-order" },
    designSystem: { direction: brief?.style ?? null, directionOrigin: brief?.style !== undefined ? "user" : "unknown", observations: [], interpretation: "extracted-values-only" },
    layoutLanguage: { elements: [], omittedElements: 0, composition: null }, assets: [], omittedAssets: 0,
    motionLanguage: { status: "not-analyzed" },
  };
  for (const [sourceIndex, reference] of references.entries()) {
    const sourceId = `source-${sourceIndex + 1}`;
    const pointer = `/files/${sourceIndex}`;
    const ingestion = reference.ingestion;
    const assets = ingestion?.assets ?? [];
    const fileRef = (index: number) => {
      const file = assets[index]?.file;
      return file ? { attachmentName: assetAttachmentName(sourceIndex, assets.findIndex((asset) => asset.file === file), file.name) } : null;
    };
    context.sources.push({ id: sourceId, name: reference.fileName, evidencePointer: pointer,
      quality: ingestion?.quality ?? "failed", warnings: ingestion?.warnings ?? ["Parsing failed"],
      textCoverage: ingestion?.coverage?.text ?? "unknown", original: fileRef(assets.findIndex((asset) => asset.kind === "document")),
    });
    for (const [index, chunk] of (ingestion?.chunks ?? []).entries()) {
      if (context.content.sections.length >= 48) { context.content.omittedSections++; continue; }
      context.content.sections.push({ id: `${sourceId}-section-${index + 1}`, sourceId,
        evidencePointer: `${pointer}/chunks/${index}`, page: chunk.page, heading: chunk.heading ?? null,
        excerpt: chunk.text.slice(0, 600), excerptTruncated: chunk.text.length > 600,
      });
    }
    if (ingestion?.style) context.designSystem.observations.push({ sourceId, evidencePointer: `${pointer}/style`,
      fonts: ingestion.style.fonts, colors: ingestion.style.colors, backgrounds: ingestion.style.backgrounds, fontSizesPt: ingestion.style.fontSizesPt,
    });
    const structured = record(ingestion?.structuredData);
    for (const key of ["slides", "pages", "sections"]) {
      for (const [pageIndex, rawPage] of list(structured[key]).entries()) {
        const page = record(rawPage);
        const elementsKey = key === "slides" ? "shapes" : key === "pages" ? "textItems" : "paragraphs";
        for (const [index, rawElement] of list(page[elementsKey]).entries()) {
          if (context.layoutLanguage.elements.length >= 64) { context.layoutLanguage.omittedElements++; continue; }
          const element = record(rawElement);
          const evidencePointer = `${pointer}/structuredData/${key}/${pageIndex}/${elementsKey}/${index}`;
          context.layoutLanguage.elements.push({ sourceId, evidencePointer,
            page: typeof page.page === "number" ? page.page : undefined,
            kind: text(element.kind) || (key === "sections" ? "paragraph" : "text"), text: text(element.text).slice(0, 160),
            geometryPointer: element.transform ? `${evidencePointer}/transform` : null, coordinateSpace: "source-local",
          });
        }
      }
    }
    for (const [index, asset] of assets.entries()) {
      if (asset.kind === "document") continue;
      if (context.assets.length >= 96) { context.omittedAssets++; continue; }
      context.assets.push({ id: `${sourceId}-asset-${index + 1}`, sourceId, evidencePointer: `${pointer}/assets/${index}`,
        kind: asset.kind, file: fileRef(index), page: asset.page, description: asset.description?.slice(0, 300) ?? null,
        availability: asset.external || asset.kind === "link" ? "external-not-fetched" : asset.file ? "local" : "metadata-only", semanticRole: null,
      });
    }
  }
  return CreativeContextSchema.parse(context);
}
