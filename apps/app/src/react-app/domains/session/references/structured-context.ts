import { selectReferenceChunks } from "./compression";
import { canSendOriginalReference } from "./ingestion";
import type { ReferenceQuality, TemplateReferenceItem } from "./types";

export type WorkContextSourceKind =
  | "brief"
  | "document"
  | "presentation"
  | "data"
  | "image"
  | "video";

export type WorkContextSource = {
  id: string;
  kind: WorkContextSourceKind;
  name: string;
  mimeType?: string;
  size?: number;
  quality: ReferenceQuality;
  summary: string;
  excerpts: Array<{ page?: number; rowRange?: [number, number]; text: string }>;
  warnings: string[];
  sourceFileAvailable: boolean;
  workspacePath?: string;
};

export type StructuredWorkContext = {
  schemaVersion: 1;
  status: "indexed" | "analyzed";
  brief: {
    title: string;
    audience: string;
    details: string;
  };
  sources: WorkContextSource[];
  analysis: {
    summary: string;
    objectives: string[];
    audience: string[];
    facts: Array<{ statement: string; sourceIds: string[] }>;
    sections: Array<{ title: string; purpose: string; sourceIds: string[] }>;
    constraints: string[];
    unknowns: string[];
  };
};

export type TemplateReferenceRecord = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  quality: ReferenceQuality;
  sourceMode: "memory";
  sentOriginal: boolean;
};

type WorkBrief = StructuredWorkContext["brief"];

function sourceKind(mimeType: string): WorkContextSourceKind {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("presentation")) return "presentation";
  if (mimeType.includes("csv") || mimeType.includes("json")) return "data";
  return "document";
}

function sourceId(index: number) {
  return `source-${index + 1}`;
}

export function templateReferenceRecords(
  references: TemplateReferenceItem[],
): TemplateReferenceRecord[] {
  return references.map((reference, index) => ({
    id: sourceId(index),
    name: reference.fileName,
    mimeType: reference.ingestion?.mimeType ?? reference.mimeType,
    size: reference.size,
    quality: reference.ingestion?.quality ?? "failed",
    sourceMode: reference.ingestion?.sourceMode ?? "memory",
    sentOriginal: reference.sendOriginal && canSendOriginalReference(reference.file),
  }));
}

/**
 * The deterministic first pass shared by every artifact surface and AI engine.
 * AI enriches `analysis` in-place, while source IDs remain stable for later
 * storyboard facts and asset decisions.
 */
export function structuredWorkContext(
  brief: WorkBrief,
  references: TemplateReferenceItem[],
  options: { workspacePathsByReferenceId?: ReadonlyMap<string, string> } = {},
): StructuredWorkContext {
  const sources: WorkContextSource[] = [
    {
      id: "brief",
      kind: "brief",
      name: "User brief",
      quality: "high",
      summary: brief.details.trim() || brief.title.trim(),
      excerpts: brief.details.trim() ? [{ text: brief.details.trim() }] : [],
      warnings: [],
      sourceFileAvailable: false,
    },
    ...references.map((reference, index): WorkContextSource => {
      const ingestion = reference.ingestion;
      const mimeType = ingestion?.mimeType ?? reference.mimeType;
      const workspacePath = options.workspacePathsByReferenceId?.get(reference.id);
      return {
        id: sourceId(index),
        kind: sourceKind(mimeType),
        name: reference.fileName,
        mimeType,
        size: reference.size,
        quality: ingestion?.quality ?? "failed",
        summary: ingestion?.summary ?? "",
        excerpts: selectReferenceChunks(ingestion?.chunks ?? [], {
          maxChunks: 6,
          maxChunkChars: 800,
        }).map(({ page, rowRange, text }) => ({
          ...(page ? { page } : {}),
          ...(rowRange ? { rowRange } : {}),
          text,
        })),
        warnings: ingestion?.warnings ?? [],
        sourceFileAvailable: Boolean(workspacePath)
          || (reference.sendOriginal && canSendOriginalReference(reference.file)),
        ...(workspacePath ? { workspacePath } : {}),
      };
    }),
  ];

  return {
    schemaVersion: 1,
    status: "indexed",
    brief,
    sources,
    analysis: {
      summary: "",
      objectives: [],
      audience: brief.audience.trim() ? [brief.audience.trim()] : [],
      facts: [],
      sections: [],
      constraints: [],
      unknowns: [],
    },
  };
}
