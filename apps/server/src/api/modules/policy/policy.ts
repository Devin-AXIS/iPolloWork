import { ApiError } from "../../../errors.js";
import type { ApiEffect } from "../../module.js";

/**
 * Per-token policy: the fine-grained counterpart to the three global token scopes.
 *
 * A scope answers "how much may this token do at all"; a policy answers "where may it
 * do it, and what may it do without a human in the loop". Everything in this file is
 * pure: no clock, no filesystem, no request context. The module wires it to storage.
 */

export type ApiTokenApprovalMode = "inherit" | "auto" | "manual";

export interface ApiTokenApprovalPolicy {
  /**
   * `inherit` defers to the server-wide `IPOLLOWORK_APPROVAL_MODE`.
   * `auto` approves without asking. `manual` always asks, even when the server runs
   * in global auto mode (see `overridesGlobalAutoApproval`).
   */
  mode: ApiTokenApprovalMode;
  /** Effect or action patterns approved without asking. See `matchesApprovalPattern`. */
  autoApprove?: string[];
  /** When true, a `destructive` effect is denied outright and no pattern can re-allow it. */
  denyDestructive?: boolean;
}

export interface ApiTokenPolicy {
  /** `null` or absent means every workspace. An array is an exact-match allowlist. */
  workspaces?: string[] | null;
  approvals?: ApiTokenApprovalPolicy;
  /** Epoch milliseconds. `null` or absent means the token never expires. */
  expiresAt?: number | null;
}

export interface WorkspaceAccessResult {
  allowed: boolean;
  reason?: string;
}

export interface ApprovalEvaluationInput {
  effect: ApiEffect;
  action: string;
}

export type ApprovalDecision = "auto-approve" | "auto-deny" | "ask";

/** A policy that constrains nothing. Used whenever a token has no stored policy. */
export const EMPTY_TOKEN_POLICY: ApiTokenPolicy = Object.freeze({});

const APPROVAL_MODES: readonly ApiTokenApprovalMode[] = ["inherit", "auto", "manual"];

const MAX_WORKSPACE_ENTRIES = 256;
const MAX_AUTO_APPROVE_ENTRIES = 128;
const MAX_PATTERN_LENGTH = 200;

/**
 * Workspace allowlist check.
 *
 * - absent / `null` allowlist -> every workspace is allowed
 * - empty array -> nothing is allowed (a deliberate lockout, not a synonym for "all")
 * - otherwise -> exact, case-sensitive, trimmed match. No globs here: a workspace id is
 *   an identifier, and a prefix wildcard over identifiers is an easy way to leak access.
 */
export function evaluateWorkspaceAccess(
  policy: ApiTokenPolicy | null | undefined,
  workspaceId: string,
): WorkspaceAccessResult {
  const allowlist = policy?.workspaces;
  if (allowlist === undefined || allowlist === null) {
    return { allowed: true };
  }

  const id = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (!id) {
    return { allowed: false, reason: "workspace_required" };
  }
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return { allowed: false, reason: "workspace_allowlist_empty" };
  }
  const hit = allowlist.some((entry) => typeof entry === "string" && entry.trim() === id);
  return hit ? { allowed: true } : { allowed: false, reason: "workspace_not_allowed" };
}

/** Filters a set of workspace ids down to the ones the policy allows. */
export function accessibleWorkspaces(
  policy: ApiTokenPolicy | null | undefined,
  workspaceIds: readonly string[],
): string[] {
  return workspaceIds.filter((id) => evaluateWorkspaceAccess(policy, id).allowed);
}

/**
 * Approval-pattern matching.
 *
 * The grammar is deliberately tiny and implemented with string operations only, so a
 * stored pattern can never become a regular expression:
 *   - `*`            matches everything
 *   - `session.prompt` exact match
 *   - `session.*`    prefix match (a single `*`, only ever as the last character)
 * Anything else - a `*` in the middle, two stars, an empty pattern - matches nothing.
 * A regex-looking string such as `.*` is treated as the literal prefix `.`, and
 * `^(.*)$` matches nothing at all.
 */
export function matchesApprovalPattern(pattern: string, candidate: string): boolean {
  if (typeof pattern !== "string" || typeof candidate !== "string") return false;
  const p = pattern.trim();
  const c = candidate.trim();
  if (!p || !c) return false;

  const star = p.indexOf("*");
  if (star === -1) return p === c;
  // Only a single trailing `*` is a wildcard; every other placement is inert.
  if (star !== p.length - 1) return false;

  const prefix = p.slice(0, -1);
  if (!prefix) return true;
  return c.startsWith(prefix);
}

/** The strings an autoApprove pattern is tested against. */
export function approvalCandidates(request: ApprovalEvaluationInput): string[] {
  const action = typeof request.action === "string" ? request.action.trim() : "";
  const effect = request.effect;
  const candidates = [action, effect, `effect:${effect}`];
  return candidates.filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Decides what happens to an approval request for this token.
 *
 * Order matters:
 *   1. `denyDestructive` wins over everything, including an `autoApprove` pattern and
 *      `mode: "auto"`. A destructive call on such a token is never silently allowed.
 *   2. an `autoApprove` match approves, which is what makes carve-outs on top of
 *      `mode: "manual"` possible.
 *   3. otherwise the mode decides: `auto` approves, `manual` and `inherit` ask.
 *
 * `manual` and `inherit` both return `"ask"`; they differ in what the caller may do
 * with the ambient global approval mode - see `overridesGlobalAutoApproval`.
 */
export function evaluateApproval(
  policy: ApiTokenPolicy | null | undefined,
  request: ApprovalEvaluationInput,
): ApprovalDecision {
  const approvals = policy?.approvals;

  if (approvals?.denyDestructive === true && request.effect === "destructive") {
    return "auto-deny";
  }

  const patterns = approvals?.autoApprove ?? [];
  if (patterns.length > 0) {
    const candidates = approvalCandidates(request);
    const approved = patterns.some((pattern) =>
      candidates.some((candidate) => matchesApprovalPattern(pattern, candidate)),
    );
    if (approved) return "auto-approve";
  }

  const mode = approvals?.mode ?? "inherit";
  if (mode === "auto") return "auto-approve";
  return "ask";
}

/**
 * True when an `"ask"` decision must reach a human even though the server runs with
 * `IPOLLOWORK_APPROVAL_MODE=auto`. Only `mode: "manual"` does that.
 */
export function overridesGlobalAutoApproval(policy: ApiTokenPolicy | null | undefined): boolean {
  return (policy?.approvals?.mode ?? "inherit") === "manual";
}

/** Expiry check. Absent, `null` and non-finite values all mean "never expires". */
export function isTokenExpired(policy: ApiTokenPolicy | null | undefined, now: number): boolean {
  const expiresAt = policy?.expiresAt;
  if (expiresAt === undefined || expiresAt === null) return false;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return false;
  if (typeof now !== "number" || !Number.isFinite(now)) return false;
  return now >= expiresAt;
}

/** True when the policy constrains nothing, so storing it would be pure noise. */
export function isEmptyTokenPolicy(policy: ApiTokenPolicy): boolean {
  if (policy.workspaces !== undefined) return false;
  if (policy.expiresAt !== undefined) return false;
  const approvals = policy.approvals;
  if (!approvals) return true;
  if (approvals.mode !== "inherit") return false;
  if (approvals.autoApprove && approvals.autoApprove.length > 0) return false;
  if (approvals.denyDestructive) return false;
  return true;
}

function invalid(message: string, field: string): ApiError {
  return new ApiError(400, "invalid_token_policy", message, { field });
}

function parsePatternList(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value)) {
    throw invalid(`${field} must be an array of strings`, field);
  }
  if (value.length > max) {
    throw invalid(`${field} accepts at most ${max} entries`, field);
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw invalid(`${field} must contain only strings`, field);
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw invalid(`${field} must not contain empty entries`, field);
    }
    if (trimmed.length > MAX_PATTERN_LENGTH) {
      throw invalid(`${field} entries must be at most ${MAX_PATTERN_LENGTH} characters`, field);
    }
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Validates and normalizes untrusted policy input.
 *
 * Unknown fields are rejected rather than ignored: a typo in a security policy that
 * silently does nothing is worse than a 400.
 */
export function parseTokenPolicy(input: unknown): ApiTokenPolicy {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw invalid("Policy must be an object", "policy");
  }

  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "workspaces" && key !== "approvals" && key !== "expiresAt") {
      throw invalid(`Unknown policy field: ${key}`, key);
    }
  }

  const policy: ApiTokenPolicy = {};

  if ("workspaces" in raw) {
    const value = raw.workspaces;
    if (value === null) {
      policy.workspaces = null;
    } else if (Array.isArray(value)) {
      if (value.length > MAX_WORKSPACE_ENTRIES) {
        throw invalid(`workspaces accepts at most ${MAX_WORKSPACE_ENTRIES} entries`, "workspaces");
      }
      const ids: string[] = [];
      for (const entry of value) {
        if (typeof entry !== "string") {
          throw invalid("workspaces must contain only strings", "workspaces");
        }
        const trimmed = entry.trim();
        if (!trimmed) {
          throw invalid("workspaces must not contain empty entries", "workspaces");
        }
        if (!ids.includes(trimmed)) ids.push(trimmed);
      }
      policy.workspaces = ids;
    } else if (value !== undefined) {
      throw invalid("workspaces must be an array of workspace ids or null", "workspaces");
    }
  }

  if ("approvals" in raw && raw.approvals !== undefined && raw.approvals !== null) {
    const value = raw.approvals;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw invalid("approvals must be an object", "approvals");
    }
    const approvalsRaw = value as Record<string, unknown>;
    for (const key of Object.keys(approvalsRaw)) {
      if (key !== "mode" && key !== "autoApprove" && key !== "denyDestructive") {
        throw invalid(`Unknown approvals field: ${key}`, `approvals.${key}`);
      }
    }

    const modeRaw = approvalsRaw.mode;
    let mode: ApiTokenApprovalMode = "inherit";
    if (modeRaw !== undefined && modeRaw !== null) {
      if (typeof modeRaw !== "string" || !APPROVAL_MODES.includes(modeRaw as ApiTokenApprovalMode)) {
        throw invalid("approvals.mode must be inherit, auto, or manual", "approvals.mode");
      }
      mode = modeRaw as ApiTokenApprovalMode;
    }

    const approvals: ApiTokenApprovalPolicy = { mode };

    if (approvalsRaw.autoApprove !== undefined && approvalsRaw.autoApprove !== null) {
      approvals.autoApprove = parsePatternList(
        approvalsRaw.autoApprove,
        "approvals.autoApprove",
        MAX_AUTO_APPROVE_ENTRIES,
      );
    }

    if (approvalsRaw.denyDestructive !== undefined && approvalsRaw.denyDestructive !== null) {
      if (typeof approvalsRaw.denyDestructive !== "boolean") {
        throw invalid("approvals.denyDestructive must be a boolean", "approvals.denyDestructive");
      }
      approvals.denyDestructive = approvalsRaw.denyDestructive;
    }

    policy.approvals = approvals;
  }

  if ("expiresAt" in raw) {
    const value = raw.expiresAt;
    if (value === null) {
      policy.expiresAt = null;
    } else if (value !== undefined) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalid("expiresAt must be epoch milliseconds or null", "expiresAt");
      }
      if (value <= 0) {
        throw invalid("expiresAt must be a positive epoch timestamp", "expiresAt");
      }
      policy.expiresAt = Math.floor(value);
    }
  }

  return policy;
}

/** Serializable view of a policy, with every default made explicit. */
export function describeTokenPolicy(policy: ApiTokenPolicy | null | undefined, now: number) {
  const resolved = policy ?? EMPTY_TOKEN_POLICY;
  return {
    workspaces: resolved.workspaces ?? null,
    approvals: {
      mode: resolved.approvals?.mode ?? "inherit",
      autoApprove: resolved.approvals?.autoApprove ?? [],
      denyDestructive: resolved.approvals?.denyDestructive ?? false,
    },
    expiresAt: resolved.expiresAt ?? null,
    expired: isTokenExpired(resolved, now),
  };
}
