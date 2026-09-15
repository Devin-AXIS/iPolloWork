import type { ReferenceDesign } from "@ipollowork/types/reference-context";

export type ReferenceStyle = {
  fonts: string[];
  colors: string[];
  backgrounds: string[];
  fontSizesPt: number[];
  sourceParts: string[];
  design?: ReferenceDesign;
};

export type ReferenceQuality = "high" | "medium" | "low" | "failed";

/** Binary content stays outside the JSON; the submitter supplies its attachment name. */
export type ReferenceAsset = {
  sourcePart: string;
  path: string;
  kind: "image" | "video" | "audio" | "embedded" | "document" | "link";
  page?: number;
  description?: string;
  external?: boolean;
  file?: File;
  media?: { width?: number; height?: number; durationSeconds?: number; frameTimeSeconds?: number };
};

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
  metadata?: ExtractedReferenceContent["metadata"];
  structuredData?: unknown;
  style?: ReferenceStyle;
  rawText?: string;
  assets?: ReferenceAsset[];
  coverage?: { text: "complete" | "partial" | "none"; visuals: "pending" | "none" | "not-supported" };
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
  progress?: number;
  progressDetail?: string;
};

export type ReferenceContextPack = {
  files: ReferenceIngestionResult[];
  promptText: string;
  totalChars: number;
  warnings: string[];
};

export type ExtractedReferenceContent = {
  text: string;
  rawText?: string;
  /** Raw evidence for quality scoring, excluding generated profile labels. */
  qualityText?: string;
  assets?: ReferenceAsset[];
  coverage?: ReferenceIngestionResult["coverage"];
  chunks?: ReferenceChunk[];
  warnings?: string[];
  structuredData?: unknown;
  style?: ReferenceStyle;
  metadata?: {
    pages?: number;
    rows?: number;
    columns?: number;
    headings?: string[];
  };
};

export type ReferenceProgress = (percent: number, detail?: string) => void;

export type PromptPackOptions = {
  maxSummaryChars?: number;
  maxChunkChars?: number;
  maxChunksPerFile?: number;
  maxTotalChars?: number;
};
