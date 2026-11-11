import { request } from "./native-agent-results.flow.mjs";

const modelButton = 'button:is([aria-label^="切换模型"], [aria-label^="Change model"])';
const modelId = "gpt-5.6-sol";
const savedSelection = `JSON.parse(localStorage.getItem('ipollowork.preferences') || '{}').enginePreferences?.opencode?.model`;
const isGptSelected = `document.querySelector(${JSON.stringify(modelButton)})?.innerText.includes('GPT 5.6')`;

export default {
  id: "opencode-model-persistence",
  title: "An explicit OpenCode model selection survives a window reload",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    const workspaceId = await ctx.eval("location.hash.split('/')[2]");
    const data = await request(ctx, "/workspaces");
    const openCodeProject = (data.items ?? data.workspaces ?? []).some(project => project.id === workspaceId && project.engineId === "opencode");
    const idle = await ctx.eval(`!document.querySelector('button:is([aria-label="停止"], [aria-label="Stop"])')
      && ![...document.querySelectorAll('[contenteditable=true][data-lexical-editor=true]')].some(editor => editor.innerText.trim())`);
    return openCodeProject && idle ? null : "Open an idle OpenCode conversation with GPT-5.6 Sol available.";
  },
  steps: [{
    name: "Select GPT-5.6 Sol and reload the desktop window",
    async run(ctx) {
      await ctx.prove("The chosen GPT-5.6 Sol remains selected after reloading OpenCode", {
        voiceover: "在 OpenCode 里选定 GPT-5.6 Sol，再刷新窗口，输入框仍显示选定的模型。",
        action: async () => {
          const directoryButton = `Array.from(document.querySelectorAll('[role="dialog"] button'))
            .find(button => /切换模型|Change model/.test(button.textContent.trim()))`;
          if (!await ctx.eval(`Boolean(${directoryButton})`)) {
            await ctx.trustedClick(modelButton);
          }
          await ctx.waitFor(`(() => {
            const button = ${directoryButton};
            if (!button) return false;
            button.click();
            return true;
          })()`, { label: "open the model directory" });
          await ctx.waitFor(`(() => {
            const option = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
              .find(item => item.textContent.includes('GPT-5.6 Sol') && !item.textContent.includes('Sol Fast') && !item.hasAttribute('data-disabled'));
            if (!option) return false;
            option.click();
            return true;
          })()`, { label: "GPT-5.6 Sol is available in the model picker" });
          await ctx.waitFor(`(${savedSelection})?.modelID === ${JSON.stringify(modelId)} && ${isGptSelected}`, { label: "explicit choice saved for OpenCode" });
          const documentStartedAt = await ctx.eval("performance.timeOrigin");
          await ctx.client.send("Page.reload", { ignoreCache: true });
          await ctx.waitFor(`performance.timeOrigin !== ${documentStartedAt} && Boolean(window.__ipolloworkControl) && ${isGptSelected}`, {
            label: "OpenCode loaded with its saved model", timeoutMs: 45_000,
          });
        },
        assert: async () => {
          const selection = await ctx.eval(savedSelection);
          ctx.assert(selection?.providerID === "openai" && selection?.modelID === modelId, "OpenCode rehydrated the exact provider and model choice");
          ctx.assert(await ctx.eval(isGptSelected), "The composer shows GPT-5.6 after reload");
        },
        screenshot: { name: "model-after-reload", requireText: ["GPT 5.6"] },
      });
    },
  }],
};
