import { request, RequestError } from "./api.ts";

export type DeletionReceipt = { deletionId: string; status: "pending" | "completed" };
export type DeletionEntry = DeletionReceipt & { kind: string };

export async function waitForDeletion(receipt: unknown, legacyCompletes = false): Promise<void> {
  const result = receipt as Partial<DeletionReceipt> | undefined;
  if (result?.status === "completed" || (legacyCompletes && !result?.deletionId)) return;
  if (result?.status !== "pending" || !result.deletionId) throw new RequestError("IPW_DELETION_STATUS_UNAVAILABLE");
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise(resolve => window.setTimeout(resolve, 1000));
    const next = await request<DeletionReceipt>("/deletions/" + encodeURIComponent(result.deletionId));
    if (next.status === "completed") return;
  }
  throw new RequestError("IPW_DELETION_PENDING");
}
