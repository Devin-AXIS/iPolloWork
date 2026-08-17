import { describe, expect, test } from "bun:test";

import { isApiError } from "../../../errors.js";
import type { ApiEffect } from "../../module.js";
import {
  accessibleWorkspaces,
  describeTokenPolicy,
  evaluateApproval,
  evaluateWorkspaceAccess,
  isEmptyTokenPolicy,
  isTokenExpired,
  matchesApprovalPattern,
  overridesGlobalAutoApproval,
  parseTokenPolicy,
  type ApiTokenPolicy,
} from "./policy.js";

describe("evaluateWorkspaceAccess", () => {
  const cases: Array<{
    name: string;
    policy: ApiTokenPolicy | null | undefined;
    workspaceId: string;
    allowed: boolean;
    reason?: string;
  }> = [
    { name: "no policy at all allows everything", policy: undefined, workspaceId: "w1", allowed: true },
    { name: "null policy allows everything", policy: null, workspaceId: "w1", allowed: true },
    { name: "absent allowlist allows everything", policy: {}, workspaceId: "w1", allowed: true },
    { name: "explicit null allowlist allows everything", policy: { workspaces: null }, workspaceId: "w1", allowed: true },
    { name: "allowlist hit", policy: { workspaces: ["w1", "w2"] }, workspaceId: "w2", allowed: true },
    {
      name: "allowlist miss",
      policy: { workspaces: ["w1", "w2"] },
      workspaceId: "w3",
      allowed: false,
      reason: "workspace_not_allowed",
    },
    {
      name: "empty allowlist denies everything",
      policy: { workspaces: [] },
      workspaceId: "w1",
      allowed: false,
      reason: "workspace_allowlist_empty",
    },
    {
      name: "an empty workspace id is never allowed under an allowlist",
      policy: { workspaces: ["w1"] },
      workspaceId: "",
      allowed: false,
      reason: "workspace_required",
    },
    {
      name: "a whitespace-only workspace id is never allowed under an allowlist",
      policy: { workspaces: ["w1"] },
      workspaceId: "   ",
      allowed: false,
      reason: "workspace_required",
    },
    { name: "entries and inputs are trimmed", policy: { workspaces: [" w1 "] }, workspaceId: " w1 ", allowed: true },
    {
      name: "matching is case-sensitive",
      policy: { workspaces: ["w1"] },
      workspaceId: "W1",
      allowed: false,
      reason: "workspace_not_allowed",
    },
    {
      name: "a wildcard is not a workspace glob",
      policy: { workspaces: ["*"] },
      workspaceId: "w1",
      allowed: false,
      reason: "workspace_not_allowed",
    },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      const result = evaluateWorkspaceAccess(testCase.policy, testCase.workspaceId);
      expect(result.allowed).toBe(testCase.allowed);
      expect(result.reason).toBe(testCase.reason as string | undefined);
    });
  }

  test("an empty workspace id is still allowed when the policy has no allowlist", () => {
    expect(evaluateWorkspaceAccess({}, "").allowed).toBe(true);
  });
});

describe("accessibleWorkspaces", () => {
  test("returns every id when unconstrained", () => {
    expect(accessibleWorkspaces({}, ["a", "b"])).toEqual(["a", "b"]);
  });

  test("filters by the allowlist and preserves input order", () => {
    expect(accessibleWorkspaces({ workspaces: ["b", "c"] }, ["a", "b", "c"])).toEqual(["b", "c"]);
  });

  test("an empty allowlist yields nothing", () => {
    expect(accessibleWorkspaces({ workspaces: [] }, ["a", "b"])).toEqual([]);
  });
});

describe("matchesApprovalPattern", () => {
  const cases: Array<{ pattern: string; candidate: string; expected: boolean; note: string }> = [
    { pattern: "session.prompt", candidate: "session.prompt", expected: true, note: "exact" },
    { pattern: "session.prompt", candidate: "session.promptx", expected: false, note: "exact is not a prefix" },
    { pattern: "*", candidate: "anything", expected: true, note: "bare star" },
    { pattern: "session.*", candidate: "session.prompt", expected: true, note: "trailing glob" },
    { pattern: "session.*", candidate: "session.", expected: true, note: "glob allows an empty tail" },
    { pattern: "session.*", candidate: "sessions.prompt", expected: false, note: "prefix must match exactly" },
    { pattern: "session.*", candidate: "file.edit", expected: false, note: "no match" },
    { pattern: "", candidate: "anything", expected: false, note: "empty pattern matches nothing" },
    { pattern: "   ", candidate: "anything", expected: false, note: "blank pattern matches nothing" },
    { pattern: "read", candidate: "", expected: false, note: "empty candidate matches nothing" },
    { pattern: " read ", candidate: "read", expected: true, note: "patterns are trimmed" },
    { pattern: "se*ion", candidate: "session", expected: false, note: "a mid-string star is inert" },
    { pattern: "**", candidate: "anything", expected: false, note: "a double star is inert" },
    { pattern: "*.prompt", candidate: "session.prompt", expected: false, note: "leading star is not supported" },
    // Regex-looking input is treated as literal text, never compiled.
    { pattern: ".*", candidate: "session.prompt", expected: false, note: "regex any is a literal dot prefix" },
    { pattern: ".*", candidate: ".danger", expected: true, note: "regex any only matches a literal leading dot" },
    { pattern: "^(.*)$", candidate: "session.prompt", expected: false, note: "anchored regex matches nothing" },
    { pattern: "(a|b)*", candidate: "a", expected: false, note: "alternation is literal" },
    { pattern: "[a-z]+", candidate: "session", expected: false, note: "character class is literal" },
    { pattern: ".*", candidate: "anything", expected: false, note: "regex any does not become a wildcard" },
  ];

  for (const testCase of cases) {
    test(`${testCase.note}: "${testCase.pattern}" vs "${testCase.candidate}"`, () => {
      expect(matchesApprovalPattern(testCase.pattern, testCase.candidate)).toBe(testCase.expected);
    });
  }
});

describe("evaluateApproval", () => {
  const request = (effect: ApiEffect, action: string) => ({ effect, action });

  const cases: Array<{
    name: string;
    policy: ApiTokenPolicy | null | undefined;
    effect: ApiEffect;
    action: string;
    expected: "auto-approve" | "auto-deny" | "ask";
  }> = [
    { name: "no policy asks", policy: undefined, effect: "write", action: "session.prompt", expected: "ask" },
    { name: "empty policy asks", policy: {}, effect: "write", action: "session.prompt", expected: "ask" },
    {
      name: "inherit asks so the global mode decides",
      policy: { approvals: { mode: "inherit" } },
      effect: "write",
      action: "session.prompt",
      expected: "ask",
    },
    {
      name: "auto approves",
      policy: { approvals: { mode: "auto" } },
      effect: "write",
      action: "session.prompt",
      expected: "auto-approve",
    },
    {
      name: "auto approves destructive too when denyDestructive is off",
      policy: { approvals: { mode: "auto" } },
      effect: "destructive",
      action: "workspace.delete",
      expected: "auto-approve",
    },
    {
      name: "manual asks",
      policy: { approvals: { mode: "manual" } },
      effect: "write",
      action: "session.prompt",
      expected: "ask",
    },
    {
      name: "an exact autoApprove entry carves out of manual",
      policy: { approvals: { mode: "manual", autoApprove: ["session.prompt"] } },
      effect: "write",
      action: "session.prompt",
      expected: "auto-approve",
    },
    {
      name: "a non-matching autoApprove entry leaves manual asking",
      policy: { approvals: { mode: "manual", autoApprove: ["file.edit"] } },
      effect: "write",
      action: "session.prompt",
      expected: "ask",
    },
    {
      name: "an empty autoApprove list changes nothing",
      policy: { approvals: { mode: "manual", autoApprove: [] } },
      effect: "write",
      action: "session.prompt",
      expected: "ask",
    },
    {
      name: "a glob entry matches by action prefix",
      policy: { approvals: { mode: "manual", autoApprove: ["session.*"] } },
      effect: "write",
      action: "session.prompt",
      expected: "auto-approve",
    },
    {
      name: "an effect name is a valid pattern",
      policy: { approvals: { mode: "manual", autoApprove: ["write"] } },
      effect: "write",
      action: "session.prompt",
      expected: "auto-approve",
    },
    {
      name: "the effect: prefix form is also accepted",
      policy: { approvals: { mode: "manual", autoApprove: ["effect:read"] } },
      effect: "read",
      action: "session.list",
      expected: "auto-approve",
    },
    {
      name: "an effect pattern does not leak across effects",
      policy: { approvals: { mode: "manual", autoApprove: ["read"] } },
      effect: "write",
      action: "session.prompt",
      expected: "ask",
    },
    {
      name: "denyDestructive overrides an exact autoApprove entry",
      policy: { approvals: { mode: "manual", autoApprove: ["workspace.delete"], denyDestructive: true } },
      effect: "destructive",
      action: "workspace.delete",
      expected: "auto-deny",
    },
    {
      name: "denyDestructive overrides a star pattern",
      policy: { approvals: { mode: "manual", autoApprove: ["*"], denyDestructive: true } },
      effect: "destructive",
      action: "workspace.delete",
      expected: "auto-deny",
    },
    {
      name: "denyDestructive overrides mode auto",
      policy: { approvals: { mode: "auto", denyDestructive: true } },
      effect: "destructive",
      action: "workspace.delete",
      expected: "auto-deny",
    },
    {
      name: "denyDestructive leaves non-destructive effects alone",
      policy: { approvals: { mode: "auto", denyDestructive: true } },
      effect: "write",
      action: "session.prompt",
      expected: "auto-approve",
    },
    {
      name: "a regex-looking pattern does not auto-approve",
      policy: { approvals: { mode: "manual", autoApprove: [".*"] } },
      effect: "destructive",
      action: "workspace.delete",
      expected: "ask",
    },
    {
      name: "a mid-string star pattern does not auto-approve",
      policy: { approvals: { mode: "manual", autoApprove: ["work*delete"] } },
      effect: "destructive",
      action: "workspace.delete",
      expected: "ask",
    },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      expect(evaluateApproval(testCase.policy, request(testCase.effect, testCase.action))).toBe(testCase.expected);
    });
  }

  test("an empty action still matches on effect", () => {
    expect(evaluateApproval({ approvals: { mode: "manual", autoApprove: ["write"] } }, request("write", "")))
      .toBe("auto-approve");
  });

  test("an empty action never matches an action pattern", () => {
    expect(evaluateApproval({ approvals: { mode: "manual", autoApprove: ["session.prompt"] } }, request("write", "")))
      .toBe("ask");
  });
});

describe("overridesGlobalAutoApproval", () => {
  test("only manual overrides the global auto mode", () => {
    expect(overridesGlobalAutoApproval({ approvals: { mode: "manual" } })).toBe(true);
    expect(overridesGlobalAutoApproval({ approvals: { mode: "inherit" } })).toBe(false);
    expect(overridesGlobalAutoApproval({ approvals: { mode: "auto" } })).toBe(false);
    expect(overridesGlobalAutoApproval({})).toBe(false);
    expect(overridesGlobalAutoApproval(null)).toBe(false);
  });
});

describe("isTokenExpired", () => {
  const now = 1_700_000_000_000;
  const cases: Array<{ name: string; policy: ApiTokenPolicy | null | undefined; now: number; expected: boolean }> = [
    { name: "no policy never expires", policy: undefined, now, expected: false },
    { name: "null policy never expires", policy: null, now, expected: false },
    { name: "absent expiresAt never expires", policy: {}, now, expected: false },
    { name: "null expiresAt never expires", policy: { expiresAt: null }, now, expected: false },
    { name: "future expiry is live", policy: { expiresAt: now + 1 }, now, expected: false },
    { name: "past expiry is expired", policy: { expiresAt: now - 1 }, now, expected: true },
    { name: "expiry exactly at now is expired", policy: { expiresAt: now }, now, expected: true },
    { name: "NaN expiry is treated as no expiry", policy: { expiresAt: Number.NaN }, now, expected: false },
    { name: "Infinity expiry is treated as no expiry", policy: { expiresAt: Number.POSITIVE_INFINITY }, now, expected: false },
    { name: "a NaN clock never expires a token", policy: { expiresAt: now - 1 }, now: Number.NaN, expected: false },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      expect(isTokenExpired(testCase.policy, testCase.now)).toBe(testCase.expected);
    });
  }
});

describe("parseTokenPolicy", () => {
  test("accepts an empty object", () => {
    expect(parseTokenPolicy({})).toEqual({});
  });

  test("treats null and undefined as an empty policy", () => {
    expect(parseTokenPolicy(null)).toEqual({});
    expect(parseTokenPolicy(undefined)).toEqual({});
  });

  test("normalizes a full policy", () => {
    expect(parseTokenPolicy({
      workspaces: [" w1 ", "w2", "w1"],
      approvals: { mode: "manual", autoApprove: [" session.* ", "session.*"], denyDestructive: true },
      expiresAt: 1_700_000_000_000.7,
    })).toEqual({
      workspaces: ["w1", "w2"],
      approvals: { mode: "manual", autoApprove: ["session.*"], denyDestructive: true },
      expiresAt: 1_700_000_000_000,
    });
  });

  test("defaults approvals.mode to inherit", () => {
    expect(parseTokenPolicy({ approvals: { autoApprove: ["read"] } }))
      .toEqual({ approvals: { mode: "inherit", autoApprove: ["read"] } });
  });

  test("keeps an explicit null workspaces allowlist distinguishable from absent", () => {
    expect(parseTokenPolicy({ workspaces: null })).toEqual({ workspaces: null });
    expect(parseTokenPolicy({})).toEqual({});
  });

  test("keeps an empty workspaces allowlist as a real lockout", () => {
    expect(parseTokenPolicy({ workspaces: [] })).toEqual({ workspaces: [] });
  });

  const rejections: Array<{ name: string; input: unknown; field: string }> = [
    { name: "an array body", input: ["w1"], field: "policy" },
    { name: "a string body", input: "everything", field: "policy" },
    { name: "an unknown top-level field", input: { scopes: ["owner"] }, field: "scopes" },
    { name: "an unknown approvals field", input: { approvals: { allowAll: true } }, field: "approvals.allowAll" },
    { name: "a bad approvals mode", input: { approvals: { mode: "always" } }, field: "approvals.mode" },
    { name: "a non-object approvals", input: { approvals: "auto" }, field: "approvals" },
    { name: "a non-array workspaces", input: { workspaces: "w1" }, field: "workspaces" },
    { name: "a non-string workspace entry", input: { workspaces: [1] }, field: "workspaces" },
    { name: "an empty workspace entry", input: { workspaces: [" "] }, field: "workspaces" },
    { name: "a non-array autoApprove", input: { approvals: { autoApprove: "*" } }, field: "approvals.autoApprove" },
    { name: "a non-string autoApprove entry", input: { approvals: { autoApprove: [{}] } }, field: "approvals.autoApprove" },
    { name: "an empty autoApprove entry", input: { approvals: { autoApprove: [""] } }, field: "approvals.autoApprove" },
    {
      name: "an over-long autoApprove entry",
      input: { approvals: { autoApprove: ["a".repeat(201)] } },
      field: "approvals.autoApprove",
    },
    {
      name: "a non-boolean denyDestructive",
      input: { approvals: { denyDestructive: "yes" } },
      field: "approvals.denyDestructive",
    },
    { name: "a string expiresAt", input: { expiresAt: "2026-01-01" }, field: "expiresAt" },
    { name: "a NaN expiresAt", input: { expiresAt: Number.NaN }, field: "expiresAt" },
    { name: "a zero expiresAt", input: { expiresAt: 0 }, field: "expiresAt" },
    { name: "a negative expiresAt", input: { expiresAt: -1 }, field: "expiresAt" },
    { name: "too many workspaces", input: { workspaces: Array.from({ length: 257 }, (_, i) => `w${i}`) }, field: "workspaces" },
    {
      name: "too many autoApprove entries",
      input: { approvals: { autoApprove: Array.from({ length: 129 }, (_, i) => `a${i}`) } },
      field: "approvals.autoApprove",
    },
  ];

  for (const rejection of rejections) {
    test(`rejects ${rejection.name}`, () => {
      try {
        parseTokenPolicy(rejection.input);
        throw new Error("expected a throw");
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        expect((error as { status: number }).status).toBe(400);
        expect((error as { code: string }).code).toBe("invalid_token_policy");
        expect((error as { details: { field: string } }).details.field).toBe(rejection.field);
      }
    });
  }

  test("a regex-shaped autoApprove entry is stored verbatim, not compiled", () => {
    const policy = parseTokenPolicy({ approvals: { autoApprove: ["^(.*)$"] } });
    expect(policy.approvals?.autoApprove).toEqual(["^(.*)$"]);
    expect(evaluateApproval(policy, { effect: "destructive", action: "workspace.delete" })).toBe("ask");
  });
});

describe("isEmptyTokenPolicy", () => {
  test("recognizes policies that constrain nothing", () => {
    expect(isEmptyTokenPolicy({})).toBe(true);
    expect(isEmptyTokenPolicy({ approvals: { mode: "inherit" } })).toBe(true);
    expect(isEmptyTokenPolicy({ approvals: { mode: "inherit", autoApprove: [], denyDestructive: false } })).toBe(true);
  });

  test("recognizes policies that do constrain something", () => {
    expect(isEmptyTokenPolicy({ workspaces: null })).toBe(false);
    expect(isEmptyTokenPolicy({ workspaces: [] })).toBe(false);
    expect(isEmptyTokenPolicy({ expiresAt: null })).toBe(false);
    expect(isEmptyTokenPolicy({ approvals: { mode: "auto" } })).toBe(false);
    expect(isEmptyTokenPolicy({ approvals: { mode: "inherit", autoApprove: ["read"] } })).toBe(false);
    expect(isEmptyTokenPolicy({ approvals: { mode: "inherit", denyDestructive: true } })).toBe(false);
  });
});

describe("describeTokenPolicy", () => {
  test("resolves every default", () => {
    expect(describeTokenPolicy({}, 1_000)).toEqual({
      workspaces: null,
      approvals: { mode: "inherit", autoApprove: [], denyDestructive: false },
      expiresAt: null,
      expired: false,
    });
  });

  test("reports expiry against the supplied clock", () => {
    expect(describeTokenPolicy({ expiresAt: 500 }, 1_000).expired).toBe(true);
    expect(describeTokenPolicy({ expiresAt: 5_000 }, 1_000).expired).toBe(false);
  });
});
