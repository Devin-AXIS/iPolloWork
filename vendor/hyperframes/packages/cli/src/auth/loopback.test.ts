import { afterEach, describe, expect, it } from "vitest";
import { startLoopback, type LoopbackHandle } from "./loopback.js";

describe("auth/loopback", () => {
  let active: LoopbackHandle | null = null;

  afterEach(async () => {
    if (active) {
      await active.close().catch(() => {});
      active = null;
    }
  });

  it("captures `code` when state matches", async () => {
    const handle = await startLoopback({ state: "expected_state", timeoutMs: 5_000 });
    active = handle;
    const redirect = new URL(handle.redirectUri);
    const callback = new URL(`${handle.redirectUri}?code=abc123&state=expected_state`);

    const fetchPromise = fetch(callback.toString());
    const result = await handle.result;
    const res = await fetchPromise;

    expect(result.code).toBe("abc123");
    expect(result.redirectUri).toContain(redirect.host);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Signed in");
  });

  async function expectRejection(args: {
    expectedState: string;
    query: string;
    pattern: RegExp;
  }): Promise<void> {
    const handle = await startLoopback({ state: args.expectedState, timeoutMs: 5_000 });
    active = handle;
    await fetch(`${handle.redirectUri}?${args.query}`).catch(() => {});
    await expect(handle.result).rejects.toThrow(args.pattern);
  }

  it("rejects when state does not match", async () => {
    await expectRejection({
      expectedState: "expected",
      query: "code=abc&state=wrong",
      pattern: /state mismatch/i,
    });
  });

  it("rejects when the IdP returns an error", async () => {
    await expectRejection({
      expectedState: "s",
      query: "error=access_denied&error_description=user+denied&state=s",
      pattern: /access_denied/,
    });
  });

  it("rejects when code is missing from the callback", async () => {
    await expectRejection({ expectedState: "s", query: "state=s", pattern: /code/ });
  });

  it("times out when no callback arrives", async () => {
    const handle = await startLoopback({ state: "s", timeoutMs: 200 });
    active = handle;
    await expect(handle.result).rejects.toThrow(/timed out/i);
  });

  it("404s non-callback paths and does not resolve the flow", async () => {
    const handle = await startLoopback({ state: "s", timeoutMs: 1_000 });
    active = handle;
    const res = await fetch(`${handle.redirectUri.replace("/oauth/callback", "/other")}`);
    expect(res.status).toBe(404);
    // Flow is still waiting — kill it via timeout.
    await expect(handle.result).rejects.toThrow(/timed out/i);
  });
});
