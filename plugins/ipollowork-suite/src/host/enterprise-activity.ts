/** Metadata-only reporting for skill loads and tool calls in enterprise projects. */
import type {} from "@deepseek-ai/dsh-agent";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { AccountService } from "./account.ts";
import { SuiteError } from "./errors.ts";
import { matchesProjectAccount } from "./project-account.ts";
import { readProjectLink } from "./project-context.ts";

type ActivitySession = { id: string; header: { cwd?: string } };
type ToolResultListener = (exec: { name: string; arguments: unknown; callId: string; agent?: { session: ActivitySession } },
  result: { isError: boolean }) => undefined;
type SessionListener = (session: Session, event: SessionEvent) => undefined;

/** Minimal observer and lifecycle services required for usage reporting. */
export interface ActivityScope {
  on(event: "tools/result", listener: ToolResultListener): unknown;
  on(event: "session/event", listener: SessionListener): unknown;
  agents: { get(id: Session["id"]): { session: Session } | undefined };
  effect(setup: () => () => Promise<void>): unknown;
  logger: { warn(message: string): void };
}

/** A bounded queue submits metadata without blocking the agent or sharing message content. */
export function mountEnterpriseActivity(scope: ActivityScope, account: AccountService, options: {
  origin: string; queueLimit: number; signal: AbortSignal; cloudProjectId?: string;
}): void {
  const { origin, queueLimit, signal, cloudProjectId } = options;
  let active = true;
  let pending = 0;
  let tail = Promise.resolve();
  function report(session: ActivitySession, callId: string, kind: "skill" | "tool", name: string, succeeded: boolean) {
    const cwd = session.header.cwd;
    if ((!cloudProjectId && !cwd) || !active || pending >= queueLimit || !name || name.length > 200) return;
    const generation = account.generation;
    const event = { sessionId: String(session.id), callId, kind, name, succeeded };
    pending++;
    tail = tail.then(async () => {
      if (!active || generation !== account.generation) return;
      const link = !cloudProjectId && cwd ? await readProjectLink(cwd, signal) : null;
      const projectId = cloudProjectId || (link && matchesProjectAccount(link.origin, origin) ? link.projectId : null);
      if (!projectId || !active || generation !== account.generation) return;
      await account.request("/api/v1/projects/" + encodeURIComponent(projectId) + "/activity", event);
    }).catch((error: unknown) => {
      if (active && !signal.aborted && !(error instanceof SuiteError && [401, 403, 404].includes(error.status)))
        scope.logger.warn("Enterprise usage report failed; aggregate counts may be incomplete");
    }).finally(() => { pending--; });
  }
  scope.on("tools/result", (exec, result) => {
    if (!exec.agent) return;
    const args = exec.arguments;
    const skill = exec.name === "skill" && args !== null && typeof args === "object" && "name" in args && typeof args.name === "string" ? args.name : null;
    report(exec.agent.session, String(exec.callId), skill === null ? "tool" : "skill", skill ?? exec.name, !result.isError);
  });
  scope.on("session/event", (session, event) => {
    if (event.type !== "user/message" || event.data.source.kind !== "skill-invocation" || scope.agents.get(session.id)?.session !== session) return;
    report(session, "user-skill:" + event.seq, "skill", event.data.source.name, true);
  });
  scope.effect(() => async () => { active = false; await tail; });
}
