/** Metadata-only reporting for tool executions in explicitly linked enterprise projects. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AccountService } from "./account.ts";

/** Minimal observer and lifecycle services required for usage reporting. */
export interface ActivityScope {
  on(event: "tools/result", listener: (exec: { name: string; arguments: unknown; callId: string; agent?: { session: { id: string; header: { cwd?: string } } } }, result: { isError: boolean }) => undefined): unknown;
  effect(setup: () => () => Promise<void>): unknown;
  logger: { warn(message: string): void };
}

const linkSchema = z.object({ origin: z.string(), projectId: z.string().min(1).max(200) });

/** Record names and final outcomes without arguments, content or credentials. A bounded queue never delays tool execution.
 * @param scope Native Cordis scope owning the observer.
 * @param account Current account connection.
 * @param origin Account origin to match against project links.
 * @param queueLimit Maximum pending metadata reports.
 */
export function mountEnterpriseActivity(scope: ActivityScope, account: AccountService, origin: string, queueLimit: number): void {
  let active = true, pending = 0, tail = Promise.resolve();
  scope.on("tools/result", (exec, result) => {
    const cwd = exec.agent?.session.header.cwd;
    if (!cwd || !active || pending >= queueLimit) return;
    const generation = account.generation;
    const args = exec.arguments;
    const skill = exec.name === "skill" && args !== null && typeof args === "object" && "name" in args && typeof args.name === "string" ? args.name : null;
    const event = { sessionId: String(exec.agent!.session.id), callId: String(exec.callId),
      kind: skill === null ? "tool" : "skill", name: skill ?? exec.name, succeeded: !result.isError };
    pending++;
    tail = tail.then(async () => {
      if (!active || generation !== account.generation) return;
      const state = await account.state();
      if (state.status !== "signed-in") return;
      let link: z.infer<typeof linkSchema>;
      try { link = linkSchema.parse(JSON.parse(await readFile(join(cwd, ".ipollo", "project.json"), "utf8"))); }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
        throw error;
      }
      if (!active || generation !== account.generation || link.origin !== origin) return;
      await account.request("/api/v1/projects/" + encodeURIComponent(link.projectId) + "/activity", event);
    }).catch(() => {
      scope.logger.warn("Enterprise usage report failed; aggregate counts may be incomplete");
    }).finally(() => { pending--; });
  });
  scope.effect(() => async () => { active = false; await tail; });
}
