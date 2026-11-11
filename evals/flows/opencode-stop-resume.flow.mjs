import { open, request } from "./native-agent-results.flow.mjs";

const firstPrompt = "请只用纯文本逐行输出数字 1 到 500，不调用工具。";
const reply = "续跑验证成功";
const nextPrompt = `继续。请只回复「${reply}」，不调用工具。`;
const editor = '[contenteditable="true"][data-lexical-editor="true"]';
const sendButton = ':is(button[title="Run task"], button[title="运行任务"]):not(:disabled)';
const stopButton = 'button:is([aria-label="Stop"], [aria-label="停止"])';

async function send(ctx, surface, text) {
  const selector = JSON.stringify(`${surface} ${editor}`);
  await ctx.waitFor(`Boolean(document.querySelector(${selector}))`);
  await ctx.eval(`document.querySelector(${selector}).focus()`);
  await ctx.client.send("Input.insertText", { text });
  await ctx.trustedClick(`${surface} ${sendButton}`);
}

export default {
  id: "opencode-stop-resume",
  title: "A new OpenCode prompt shows its reply after Stop",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    const id = await ctx.eval("location.hash.split('/')[2]");
    const data = await request(ctx, "/workspaces");
    return (data.items ?? data.workspaces ?? []).some(project => project.id === id && project.engineId === "opencode")
      ? null : "Open a local OpenCode project with a working model before running this proof.";
  },
  steps: [{
    name: "Stop a running prompt and send a follow-up",
    async run(ctx) {
      const previousHash = await ctx.eval("location.hash");
      const wid = previousHash.split("/")[2];
      const { item: { id: sid } } = await request(ctx, `/workspace/${wid}/sessions`, "POST", {
        title: "停止后继续验证", engineId: "opencode",
      });
      const path = `/workspace/${wid}/sessions/${sid}`;
      const surface = `[data-session-surface-id=${JSON.stringify(sid)}]`;
      const stopped = `Array.from(document.querySelectorAll(${JSON.stringify(surface)})).some(el => /任务已中断|Run interrupted/.test(el.innerText))`;
      const response = `Array.from(document.querySelectorAll(${JSON.stringify(`${surface} [data-message-role="assistant"]`)})).some(el => el.innerText.includes(${JSON.stringify(reply)}))`;

      try {
        await open(ctx, { wid, sid });
        await ctx.prove("After stopping the previous turn, the next turn displays its own reply and settles", {
          voiceover: "停止正在输出的任务，再发送继续。新回复会显示在同一对话中，任务结束后输入框可以再次发送。",
          action: async () => {
            await send(ctx, surface, firstPrompt);
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(`${surface} ${stopButton}`)}))
              && window.__owReactQueryClient?.getQueryData(${JSON.stringify(["react-session-transcript", wid, sid])})
                ?.some(message => message.role === 'assistant')`, {
              label: "OpenCode created a running assistant message", timeoutMs: 25_000,
            });
            await ctx.trustedClick(`${surface} ${stopButton}`);
            await ctx.waitFor(`${stopped} && !document.querySelector(${JSON.stringify(`${surface} ${stopButton}`)})`, { label: "stop has settled" });
            await send(ctx, surface, nextPrompt);
            await ctx.waitFor(`${response} && !document.querySelector(${JSON.stringify(`${surface} ${stopButton}`)})`, {
              label: "resumed response is visible and idle", timeoutMs: 40_000,
            });
          },
          assert: async () => {
            const { item } = await request(ctx, `${path}/snapshot`);
            const [first, next] = item.messages.filter(message => message.info.role === "user");
            ctx.assert(item.messages.some(message => message.info.parentID === first?.info.id && message.info.error?.name === "MessageAbortedError"),
              "OpenCode recorded the first turn as interrupted");
            ctx.assert(item.status.type === "idle" && item.messages.some(message => message.info.parentID === next?.info.id
              && message.info.time.completed && !message.info.error && message.parts.some(part => part.type === "text" && part.text.includes(reply))),
            "The visible reply belongs to the completed follow-up turn");
          },
          screenshot: { name: "resumed-response", requireText: [reply], hashIncludes: `/session/${sid}` },
        });
      } finally {
        const { item } = await request(ctx, `${path}/snapshot`);
        const view = await ctx.eval(`({
          selected: location.hash.endsWith(${JSON.stringify(`/session/${sid}`)}),
          status: window.__owReactQueryClient?.getQueryData(${JSON.stringify(["react-session-status", wid, sid])})?.type,
          visibleReply: ${response},
          visibleStop: Boolean(document.querySelector(${JSON.stringify(`${surface} ${stopButton}`)})),
        })`);
        const native = item.messages.map(message => ({ role: message.info.role, error: message.info.error?.name,
          reply: message.parts.some(part => part.type === "text" && part.text.includes(reply)) }));
        ctx.log(`Proof session ${JSON.stringify({ nativeStatus: item.status.type, native, view })}`);
        if (view.selected) await ctx.navigateHash(previousHash);
        const prompts = item.messages.filter(message => message.info.role === "user")
          .map(message => message.parts.filter(part => part.type === "text").map(part => part.text).join("\n"));
        if (item.status.type === "idle" && prompts.length <= 2 && prompts.every((text, index) => text === [firstPrompt, nextPrompt][index])) {
          await request(ctx, path, "DELETE");
        }
      }
    },
  }],
};
