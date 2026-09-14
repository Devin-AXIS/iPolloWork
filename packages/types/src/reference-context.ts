import { z } from "zod";

export const REFERENCE_MAX_BYTES = 50_000_000;
export const REFERENCE_CONTEXT_MAX_BYTES = 500_000_000;
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const size = z.number().int().nonnegative();
export const ReferenceContextPartsSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("template-reference-context"), storage: z.literal("json-string-parts"),
  sha256: Sha256Schema, bytes: size.max(REFERENCE_CONTEXT_MAX_BYTES),
  parts: z.array(z.object({ attachmentName: z.string().min(1), bytes: size.max(4_000_000) })).min(1).max(2048),
});
export const ReferenceAssemblySchema = ReferenceContextPartsSchema.pick({ sha256: true, bytes: true }).extend({
  parts: z.array(z.object({ path: z.string().min(1), bytes: size.max(4_000_000) })).min(1).max(2048),
});
export type ReferenceAssembly = z.infer<typeof ReferenceAssemblySchema>;
export type InboxUploadOptions = { path?: string; verify?: boolean; referenceAssembly?: ReferenceAssembly };
export const VerifiedInboxReceiptSchema = z.object({ ok: z.literal(true), path: z.string().min(1), bytes: size, sha256: Sha256Schema });

const CreativeFileSchema = z.object({ attachmentName: z.string().min(1), workspacePath: z.string().min(1).optional() });
const BriefSchema = z.object({ title: z.string(), audience: z.string(), details: z.string(), style: z.string().optional() });
const DesignElementSchema = z.object({
  kind: z.string(), role: z.enum(["title", "heading", "body", "unknown"]),
  roleOrigin: z.enum(["explicit", "rule", "unknown"]), text: z.string(), sources: z.array(z.string()),
  xPt: z.number().optional(), yPt: z.number().optional(), widthPt: z.number().optional(), heightPt: z.number().optional(), rotationDeg: z.number().optional(),
  fontFamily: z.string().optional(), fontSizePt: z.number().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(),
  color: z.string().optional(), background: z.string().optional(), alignment: z.string().optional(),
  spaceBeforePt: z.number().optional(), spaceAfterPt: z.number().optional(), lineSpacing: z.string().optional(),
  fill: z.string().optional(), borderColor: z.string().optional(), borderWidthPt: z.number().optional(),
});
export const ReferenceDesignSchema = z.object({
  schemaVersion: z.literal(1), format: z.string(), method: z.literal("local-rules"),
  availability: z.enum(["extracted", "declared", "structure-only", "unavailable"]),
  summary: z.array(z.string()), limitations: z.array(z.string()), omittedElements: size,
  typography: z.array(z.object({ fontFamily: z.string().optional(), fontSizePt: z.number().optional(), role: z.string(), count: size })),
  palette: z.array(z.object({ color: z.string(), role: z.string(), count: size })),
  structure: z.record(z.string(), z.union([z.string(), z.number()])),
  pages: z.array(z.object({ sourcePart: z.string(), page: size.optional(), widthPt: z.number().optional(), heightPt: z.number().optional(), background: z.string().optional(),
    elements: z.array(DesignElementSchema),
  })),
});
export type ReferenceDesign = z.infer<typeof ReferenceDesignSchema>;
export type ReferenceDesignElement = z.infer<typeof DesignElementSchema>;
/** Compact index, not a replacement for the lossless reference evidence. */
export const CreativeContextSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("creative-context"),
  extraction: z.object({ mode: z.literal("local"), modelUsed: z.literal(false) }),
  evidence: CreativeFileSchema,
  brief: z.object({ user: BriefSchema.nullable(), inferred: BriefSchema, inference: z.literal("rules") }),
  sources: z.array(z.object({
    id: z.string(), name: z.string(), evidencePointer: z.string(), quality: z.string(),
    warnings: z.array(z.string()), textCoverage: z.string(), original: CreativeFileSchema.nullable(),
  })),
  content: z.object({ sections: z.array(z.object({
    id: z.string(), sourceId: z.string(), evidencePointer: z.string(), page: size.optional(),
    heading: z.string().nullable(), excerpt: z.string(), excerptTruncated: z.boolean(),
  })), omittedSections: size, order: z.literal("source-order") }),
  designSystem: z.object({
    direction: z.string().nullable(), directionOrigin: z.enum(["user", "unknown"]),
    observations: z.array(z.object({ sourceId: z.string(), evidencePointer: z.string(),
      fonts: z.array(z.string()), colors: z.array(z.string()), backgrounds: z.array(z.string()), fontSizesPt: z.array(z.number()),
      design: ReferenceDesignSchema.optional(),
    })),
    interpretation: z.literal("extracted-values-only"),
  }),
  layoutLanguage: z.object({ elements: z.array(z.object({
    sourceId: z.string(), evidencePointer: z.string(), page: size.optional(), kind: z.string(),
    text: z.string(), geometryPointer: z.string().nullable(), coordinateSpace: z.literal("source-local"),
  })), omittedElements: size, composition: z.null() }),
  assets: z.array(z.object({
    id: z.string(), sourceId: z.string(), evidencePointer: z.string(), kind: z.string(),
    file: CreativeFileSchema.nullable(), page: size.optional(), description: z.string().nullable(),
    availability: z.enum(["local", "external-not-fetched", "metadata-only"]), semanticRole: z.null(),
  })),
  omittedAssets: size,
  motionLanguage: z.object({ status: z.literal("not-analyzed") }),
});
export type CreativeContext = z.infer<typeof CreativeContextSchema>;

export function bindCreativeContextFiles(context: CreativeContext, uploaded: { name: string; workspacePath: string }[]): CreativeContext {
  const paths = new Map(uploaded.map((item) => [item.name, item.workspacePath]));
  const bind = (file: z.infer<typeof CreativeFileSchema>) => {
    const workspacePath = paths.get(file.attachmentName);
    if (!workspacePath) throw new Error(`参考上下文缺少已上传文件：${file.attachmentName}`);
    return { ...file, workspacePath };
  };
  return { ...context, evidence: bind(context.evidence),
    sources: context.sources.map((source) => ({ ...source, original: source.original ? bind(source.original) : null })),
    assets: context.assets.map((asset) => ({ ...asset, file: asset.file ? bind(asset.file) : null })),
  };
}
