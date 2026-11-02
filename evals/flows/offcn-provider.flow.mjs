import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("offcn-provider");
const modelId = "deepseek-v4-pro-260425";

async function serverRequest(ctx, path) {
  return ctx.eval(`(async () => {
    const base = localStorage.getItem('ipollowork.server.urlOverride');
    const response = await fetch(base + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('ipollowork.server.token') },
    });
    if (!response.ok) throw new Error('Verification request failed: ' + response.status);
    return response.json();
  })()`, { awaitPromise: true });
}

export default {
  id: "offcn-provider",
  title: "Connect Offcn with a personal key and run a real DeepSeek tool task",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_OFFCN_KEY_FILE", "IPOLLOWORK_EVAL_OFFCN_WORKSPACE"],
  cdpTarget: { urlIncludes: "127.0.0.1:5277" },
  precondition: async (ctx) => {
    const workspaces = await serverRequest(ctx, "/workspaces");
    const workspace = workspaces.items.find((entry) =>
      resolve(entry.path) === resolve(ctx.env.IPOLLOWORK_EVAL_OFFCN_WORKSPACE));
    ctx.assert(Boolean(workspace), "This flow requires its isolated verification workspace.");
    ctx.workspaceId = workspace.id;
    ctx.key = (await readFile(ctx.env.IPOLLOWORK_EVAL_OFFCN_KEY_FILE, "utf8")).trim();
    ctx.assert(Boolean(ctx.key), "The personal key file is empty.");
  },
  steps: [
    {
      name: "Choose the Offcn provider",
      run: async (ctx) => {
        await ctx.prove("Offcn is available with a personal key form", {
          voiceover: vo[0],
          action: async () => {
            await ctx.eval(`(() => {
              location.href = '/workspace/' + ${JSON.stringify(ctx.workspaceId)} + '/settings/ai';
              return true;
            })()`);
            await ctx.waitForText("连接提供商", { timeoutMs: 30_000 });
            await ctx.clickText("连接提供商", { selector: "button" });
            await ctx.fill('input[placeholder="Filter providers by name or ID"]', "Offcn");
            await ctx.clickText("Offcn", { selector: '[role="dialog"] button' });
          },
          assert: async () => {
            await ctx.waitFor(`!document.querySelector('img[alt="iPolloWork Loading"]')`, {
              timeoutMs: 30_000, label: "boot overlay dismissed before capturing the key form",
            });
            await ctx.expectText("Offcn One API");
            await ctx.expectText("DeepSeek V4 Pro");
            ctx.assert(await ctx.eval(`Boolean(document.querySelector('input[type="password"]'))`),
              "The personal key must use a password input.");
          },
          screenshot: { name: "offcn-key-form", requireText: ["Offcn", "个人 Key", "DeepSeek V4 Pro"] },
        });
      },
    },
    {
      name: "Save the personal key",
      run: async (ctx) => {
        await ctx.prove("Offcn saves its Anthropic route separately from the key", {
          voiceover: vo[1],
          action: async () => {
            await ctx.fill('input[type="password"]', ctx.key);
            await ctx.clickText("Save key", { selector: '[role="dialog"] button' });
            await ctx.waitFor(`!document.querySelector('[role="dialog"]')`, {
              timeoutMs: 60_000, label: "personal key saved",
            });
          },
          assert: async () => {
            await ctx.expectText("Offcn");
            const config = await serverRequest(ctx, `/workspace/${ctx.workspaceId}/config`);
            const provider = config.opencode?.provider?.offcn;
            ctx.assert(provider?.npm === "@ai-sdk/anthropic", "Offcn must use the Anthropic SDK.");
            ctx.assert(provider?.options?.baseURL === "https://oneapi.eoffcn.com/v1", "Incorrect SDK base URL.");
            ctx.assert(Boolean(provider?.models?.[modelId]?.tool_call), "Tool calling is missing.");
            ctx.assert(!JSON.stringify(config).includes(ctx.key), "The key must stay outside runtime model configuration.");
          },
          screenshot: { name: "offcn-connected", requireText: ["Offcn", "断开连接"] },
        });
        ctx.key = null;
      },
    },
    {
      name: "Select the model and run a tool task",
      run: async (ctx) => {
        await ctx.prove("Offcn DeepSeek executes a tool and streams the result into the conversation", {
          voiceover: vo[2],
          action: async () => {
            await ctx.clickText("返回应用", { selector: "button" });
            await ctx.waitFor(`window.__ipolloworkControl?.listActions()
              .some((action) => action.id === 'session.create_task' && !action.disabled)`);
            await ctx.control("session.create_task");
            await ctx.control("session.model_picker.open");
            await ctx.waitForText("Offcn");
            await ctx.clickText("Offcn", { selector: '[role="dialog"] button' });
            await ctx.clickText("deepseek-v4-pro-260425", { selector: '[role="dialog"] button' });
            await ctx.waitFor(`!document.querySelector('[role="dialog"]')`);
            await ctx.waitFor(`Boolean(document.querySelector('[contenteditable="true"]'))`);
            await ctx.eval(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
              editor.focus();
              const data = new DataTransfer();
              data.setData('text/plain', '请必须使用 bash 工具执行 node -p "17*19" 来计算，工具完成后只回复计算结果。');
              editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
              return true;
            })()`);
            await ctx.trustedClick('button[title="运行任务"]');
          },
          assert: async () => {
            await ctx.waitFor(`Array.from(document.querySelectorAll('[data-message-role="assistant"]'))
              .some((message) => /323/.test(message.innerText))`, {
              timeoutMs: 120_000, label: "real Offcn assistant response",
            });
            const route = await ctx.eval("location.pathname");
            const sessionId = route.match(/ses_[A-Za-z0-9]+/)?.[0];
            ctx.assert(Boolean(sessionId), "The task has no persisted session.");
            const messages = await serverRequest(ctx, `/workspace/${ctx.workspaceId}/sessions/${sessionId}/messages`);
            const completedTools = messages.items.flatMap((message) => message.parts ?? [])
              .filter((part) => part.type === "tool" && part.state?.status === "completed");
            ctx.assert(completedTools.some((part) => part.tool === "bash" && /323/.test(part.state?.output ?? "")),
              "A completed bash tool call must witness the calculation.");
            ctx.assert(messages.items.some((message) => message.info?.role === "assistant"
              && message.info?.providerID === "offcn" && message.info?.modelID === modelId),
              "The assistant response must come from Offcn's configured model.");
            await ctx.waitFor(`Boolean(document.querySelector('button[title="运行任务"]'))`, {
              timeoutMs: 30_000, label: "tool task completed",
            });
          },
          screenshot: { name: "offcn-tool-result", requireText: ["323", "260425"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
