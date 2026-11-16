/** Native HTTP speech authentication and terminal statuses over the shared provider key. */
import { z } from "zod";
import { ServiceError } from "./errors.js";

const object = z.record(z.string(), z.unknown());

/** Move the catalog model selector into the provider's required resource header. */
export function speechRequest(body: Buffer | undefined, requestId: string, model: string, path: string) {
  const payload = object.parse(JSON.parse(body?.toString("utf8") ?? "{}"));
  const headers: Record<string, string> = { "X-Api-Request-Id": requestId };
  if (path !== "/api/v3/tts/create") {
    headers["X-Api-Resource-Id"] = model;
    delete payload.model;
  }
  if (path.endsWith("/query")) delete payload.task_id;
  if (path.includes("/auc/")) headers["X-Api-Sequence"] = "-1";
  if (path.includes("/tts/unidirectional")) headers["X-Control-Require-Usage-Tokens-Return"] = "text_words";
  return { body: Buffer.from(JSON.stringify(payload)), headers };
}

/** Translate speech error headers before HTTP 200 can be mistaken for a successful call. */
export async function speechResponse(response: Response, path: string, requestId: string): Promise<Response> {
  if (!path.includes("/auc/") || !response.ok) return response;
  const text = await response.text();
  const raw = text ? object.parse(JSON.parse(text)) : {};
  const headers = object.parse(raw.headers ?? {});
  const status = response.headers.get("X-Api-Status-Code") ?? String(raw["X-Api-Status-Code"] ?? headers["X-Api-Status-Code"] ?? "");
  const body = raw.body === undefined ? raw : object.parse(raw.body);
  if (["20000001", "20000002"].includes(status)) return Response.json({ ...body, status: "running" });
  if (status.startsWith("4")) return path.endsWith("/query") ? Response.json({status:"failed"}) : Response.json({ error: { code: status } }, { status: 422 });
  if (status !== "20000000") throw new ServiceError("SERVICE_OUTCOME_UNKNOWN", 503);
  return Response.json(path.endsWith("/submit") ? { ...body, task_id: body.task_id ?? requestId } : body);
}
