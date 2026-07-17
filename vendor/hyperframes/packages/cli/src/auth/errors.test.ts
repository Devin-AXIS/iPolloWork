import { describe, expect, it } from "vitest";
import {
  AuthError,
  ErrApi,
  ErrInvalidStore,
  ErrNotConfigured,
  ErrUnauthenticated,
  isAuthError,
} from "./errors.js";

describe("auth/errors", () => {
  it("ErrNotConfigured carries the right code + hint", () => {
    const err = ErrNotConfigured();
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe("NOT_CONFIGURED");
    expect(err.hint).toContain("hyperframes auth login");
  });

  it("ErrInvalidStore wraps the detail", () => {
    const err = ErrInvalidStore("malformed at line 3");
    expect(err.code).toBe("INVALID_STORE");
    expect(err.message).toContain("malformed at line 3");
  });

  it("ErrUnauthenticated includes detail when provided", () => {
    expect(ErrUnauthenticated().code).toBe("UNAUTHENTICATED");
    expect(ErrUnauthenticated("invalid token").message).toContain("invalid token");
  });

  it("ErrApi captures status + detail", () => {
    const err = ErrApi(503, "upstream timeout");
    expect(err.code).toBe("API_ERROR");
    expect(err.message).toContain("503");
    expect(err.message).toContain("upstream timeout");
  });

  it("isAuthError narrows properly", () => {
    expect(isAuthError(ErrNotConfigured())).toBe(true);
    expect(isAuthError(new Error("plain"))).toBe(false);
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError("string")).toBe(false);
  });
});
