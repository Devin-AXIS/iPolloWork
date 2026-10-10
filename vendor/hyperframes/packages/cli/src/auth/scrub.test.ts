import { describe, expect, it } from "vitest";
import { scrubCredentials } from "./scrub.js";

describe("auth/scrub", () => {
  it("redacts HeyGen API keys", () => {
    const out = scrubCredentials("rejected key hg_supersecret_abc123 from header");
    expect(out).not.toContain("hg_supersecret_abc123");
    expect(out).toContain("hg_<redacted>");
  });

  it("redacts sk_V2_ keys echoed inline (not just after Authorization:)", () => {
    // Real HeyGen keys are `sk_V2_…`. A token echoed in a stack trace or
    // JSON payload — without a header-name anchor — must still be
    // redacted, per the threat model the scrubber is written for.
    const out = scrubCredentials(
      "error: token sk_V2_hgu_supersecret_real999 was rejected upstream",
    );
    expect(out).not.toContain("sk_V2_hgu_supersecret_real999");
    expect(out).toContain("sk_<redacted>");
  });

  it("redacts authorization / x-api-key header lines", () => {
    const out = scrubCredentials("x-api-key: hg_zzz999\nauthorization: Bearer abc");
    expect(out).not.toContain("hg_zzz999");
    expect(out).not.toContain("Bearer abc");
    expect(out).toContain("x-api-key: <redacted>");
    expect(out).toContain("authorization: <redacted>");
  });

  it("redacts the full Authorization: Bearer value, not just the scheme", () => {
    const out = scrubCredentials("echoed Authorization: Bearer at_opaque_secret_999\nnext line");
    // The opaque token after `Bearer` must be gone.
    expect(out).not.toContain("at_opaque_secret_999");
    expect(out).not.toContain("Bearer at_opaque_secret_999");
    expect(out).toContain("Authorization: <redacted>");
    // Redaction stops at the line break — unrelated following lines survive.
    expect(out).toContain("next line");
  });

  it("redacts JWT-shaped tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF_123-xyz";
    const out = scrubCredentials(`token was ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("<jwt-redacted>");
  });

  it("redacts form-encoded OAuth secrets (refresh_token, code, code_verifier)", () => {
    const body =
      "error: grant_type=refresh_token&refresh_token=rt_secret_abc&code=auth_code_xyz&code_verifier=verif_123";
    const out = scrubCredentials(body);
    expect(out).not.toContain("rt_secret_abc");
    expect(out).not.toContain("auth_code_xyz");
    expect(out).not.toContain("verif_123");
    expect(out).toContain("refresh_token=<redacted>");
    expect(out).toContain("code=<redacted>");
    expect(out).toContain("code_verifier=<redacted>");
    // grant_type is not a secret — keep it for debuggability.
    expect(out).toContain("grant_type=refresh_token");
  });

  it("redacts JSON-encoded OAuth secrets", () => {
    const body = '{"error":"invalid","access_token":"at_leak","refresh_token":"rt_leak"}';
    const out = scrubCredentials(body);
    expect(out).not.toContain("at_leak");
    expect(out).not.toContain("rt_leak");
    expect(out).toContain('"access_token":"<redacted>"');
    expect(out).toContain('"refresh_token":"<redacted>"');
  });

  it("does not over-redact unrelated text", () => {
    const out = scrubCredentials("error_code=42 the request failed validation");
    expect(out).toBe("error_code=42 the request failed validation");
  });
});
