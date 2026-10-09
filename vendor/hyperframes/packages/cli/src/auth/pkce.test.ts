import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generatePkcePair, generateState } from "./pkce.js";

describe("auth/pkce", () => {
  it("generates a verifier within RFC 7636 length bounds (43-128 chars)", () => {
    const { verifier } = generatePkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("uses only URL-safe base64 characters", () => {
    const { verifier, challenge } = generatePkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("challenge is the SHA-256 hash of the verifier, base64url-encoded", () => {
    const { verifier, challenge } = generatePkcePair();
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("always uses S256 method", () => {
    expect(generatePkcePair().method).toBe("S256");
  });

  it("generates distinct verifiers on each call", () => {
    const a = generatePkcePair().verifier;
    const b = generatePkcePair().verifier;
    expect(a).not.toBe(b);
  });

  it("generates state values with sufficient entropy", () => {
    const state = generateState();
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state).not.toBe(generateState());
  });
});
