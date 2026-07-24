import { ApiError } from "./errors.js";

export async function readLimitedRequestBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declaredBytes = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new ApiError(413, "template_package_too_large", "Template package exceeds 50 MB");
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "template_package_too_large", "Template package exceeds 50 MB");
    }
    chunks.push(next.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
