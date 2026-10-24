/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) helpers.
 *
 * The flow:
 *   1. Generate a high-entropy `code_verifier` (43–128 URL-safe chars).
 *   2. Send `code_challenge = base64url(SHA-256(code_verifier))` to
 *      `/v1/oauth/authorize`.
 *   3. After the user consents, exchange the returned `code` + the
 *      original `code_verifier` at `/v1/oauth/token`. The server hashes
 *      the verifier and rejects the exchange if it doesn't match the
 *      challenge that opened the flow.
 *
 * PKCE removes the need for a client secret — perfect for a CLI that
 * can't keep one.
 */

import { createHash, randomBytes } from "node:crypto";

const VERIFIER_BYTES = 64; // 64 random bytes → 86 base64url chars (well within 43-128)

export interface PkcePair {
  /** Sent on the exchange; kept secret by the CLI between the two HTTP hops. */
  verifier: string;
  /** Sent on the authorize URL. */
  challenge: string;
  /** Always "S256" for HeyGen's backend (`code_challenge_method`). */
  method: "S256";
}

export function generatePkcePair(): PkcePair {
  const verifier = base64UrlEncode(randomBytes(VERIFIER_BYTES));
  const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** OAuth `state` parameter — a CSRF token bound to this flow. */
export function generateState(): string {
  return base64UrlEncode(randomBytes(32));
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
