export type ReferenceQuality = "high" | "medium" | "low" | "failed";

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
};

export type ReferenceContextPack = {
  files: ReferenceIngestionResult[];
  promptText: string;
  totalChars: number;
  warnings: string[];
};

export type ExtractedReferenceContent = {
  text: string;
  chunks?: ReferenceChunk[];
  warnings?: string[];
  metadata?: {
    pages?: number;
    rows?: number;
    columns?: number;
    headings?: string[];
  };
};

export type PromptPackOptions = {
  maxSummaryChars?: number;
  maxChunkChars?: number;
  maxChunksPerFile?: number;
  maxTotalChars?: number;
};
