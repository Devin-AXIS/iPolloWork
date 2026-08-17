/**
 * A webhook receiver that verifies signatures before trusting a delivery.
 *
 * The signature check is the whole point: the endpoint is public, so anyone can POST to
 * it. Without verification a forged "task done" payload is indistinguishable from a real
 * one.
 *
 * Run:
 *   export IPOLLOWORK_WEBHOOK_SECRET=<the secret you registered>
 *   node --experimental-strip-types examples/public-api/05-webhook-receiver.ts
 *
 * Then register it (from a machine the server can reach):
 *   curl -X POST "$IPOLLOWORK_BASE_URL/api/v1/workspaces/$WS/webhooks" \
 *     -H "Authorization: Bearer $IPOLLOWORK_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"url":"https://your-host/hooks/ipollowork","events":["task.completed","task.failed"],"secret":"'"$IPOLLOWORK_WEBHOOK_SECRET"'"}'
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const SECRET = process.env.IPOLLOWORK_WEBHOOK_SECRET;
if (!SECRET) throw new Error("IPOLLOWORK_WEBHOOK_SECRET is required");

const PORT = Number(process.env.PORT ?? 8790);

/** Deliveries older than this are rejected, so a captured payload cannot be replayed later. */
const MAX_SKEW_SECONDS = 300;

function verify(signatureHeader: string | undefined, body: string): boolean {
  if (!signatureHeader) return false;

  let timestamp = "";
  const provided: string[] = [];
  for (const segment of signatureHeader.split(",")) {
    const index = segment.indexOf("=");
    if (index === -1) continue;
    const key = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) provided.push(value);
  }
  if (!timestamp || provided.length === 0) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", SECRET!).update(`${timestamp}.${body}`, "utf8").digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");

  // Compare in constant time; a fast-exit compare leaks the signature one byte at a time.
  return provided.some((candidate) => {
    const candidateBytes = Buffer.from(candidate, "hex");
    return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
  });
}

const server = createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }

  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const signature = request.headers["x-ipollowork-signature"];

    if (!verify(Array.isArray(signature) ? signature[0] : signature, body)) {
      console.warn("rejected an unsigned or invalid delivery");
      response.writeHead(401).end();
      return;
    }

    const eventType = request.headers["x-ipollowork-event"];
    const deliveryId = request.headers["x-ipollowork-delivery"];

    // Deliveries retry on failure, so the same id can arrive more than once. Real
    // receivers should record handled ids and skip duplicates.
    console.log(`[${String(eventType)}] delivery=${String(deliveryId)}`);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }

    // Answer immediately; do the slow work out of band, or the sender will time out and retry.
    response.writeHead(204).end();
  });
});

server.listen(PORT, () => {
  console.log(`listening for iPolloWork webhooks on http://127.0.0.1:${PORT}`);
});
