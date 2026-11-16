/** Continue truncated account-model responses through the native agent inbox. */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    /** Logged automatic continuation; readers retain the text when the suite is absent.
     * @persistenceAttribution
     */
    "ipollowork-output-continuation": {
      kind: "ipollowork-output-continuation";
      form: "notice";
      summary: string;
    };
  }
}

/** Resume only a committed, truncated response with no pending tool calls or user input.
 * @param ctx Native plugin lifetime, with the agent registry available.
 */
export function mountOutputContinuation(ctx: Context): void {
  const truncated = new WeakSet<Agent>();
  const pending = new Set<Agent>();
  ctx.on("agent/inbox/claimed", ({ agent, message }) => {
    if (message.source.kind === "ipollowork-output-continuation") pending.delete(agent);
  });
  ctx.on("agent/disposed", ({ agent }) => pending.delete(agent));
  ctx.effect(() => () => {
    for (const agent of pending) {
      for (let index = agent.inbox.nextStep.length - 1; index >= 0; index--) {
        if (agent.inbox.nextStep[index]?.source.kind === "ipollowork-output-continuation")
          agent.inbox.splice("next-step", index, 1, []);
      }
    }
    pending.clear();
  });
  ctx.on("session/event", (session, event) => {
    if (event.type !== "assistant/message") return;
    const agent = ctx.agents.get(session.id);
    if (!agent) return;
    truncated.delete(agent);
    const { message, stream } = event.data;
    if (!message.source.provider.startsWith("ipollo-")
      || message.content.some(block => block.type === "tool-call")) return;
    const finish = stream?.findLast(entry => entry.type === "chunk" && entry.chunk.type === "finish");
    if (finish?.type === "chunk" && finish.chunk.type === "finish" && finish.chunk.reason.kind === "max-tokens")
      truncated.add(agent);
  });
  ctx.on("agent/turn-stopping", ({ agent, signal }) => {
    if (!truncated.delete(agent) || signal.aborted
      || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) return;
    const message = createUserMessage({
      source: { kind: "ipollowork-output-continuation", form: "notice", summary: "继续处理" },
      content: [{ type: "text", text: "Continue the current task from its saved state. The preceding response ended before completion. Preserve completed work; if a tool call was incomplete, issue it again with complete arguments. Do not ask the user to send a continuation message." }],
    });
    pending.add(agent);
    try { agent.steer(message); }
    catch (error) { pending.delete(agent); throw error; }
  });
}
