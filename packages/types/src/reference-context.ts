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
