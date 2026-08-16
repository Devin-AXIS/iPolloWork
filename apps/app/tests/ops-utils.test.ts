import { describe, expect, test } from "bun:test";

import { normalizeSshTarget } from "../src/react-app/domains/session/ops/ops-utils";

describe("normalizeSshTarget", () => {
  test("returns empty for blank input", () => {
    expect(normalizeSshTarget("")).toBe("");
    expect(normalizeSshTarget("   ")).toBe("");
  });

  test("strips a leading ssh command", () => {
    expect(normalizeSshTarget("ssh user@host")).toBe("user@host");
  });

  test("strips a leading -t flag", () => {
    expect(normalizeSshTarget("-t user@host")).toBe("user@host");
  });

  test("strips ssh then -t in order", () => {
    expect(normalizeSshTarget("ssh -t user@host")).toBe("user@host");
  });

  test("keeps a plain alias unchanged", () => {
    expect(normalizeSshTarget("web-01")).toBe("web-01");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeSshTarget("  ssh  user@host  ")).toBe("user@host");
  });
});
