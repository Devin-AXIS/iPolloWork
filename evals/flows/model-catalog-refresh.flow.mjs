const dialog = '[role="dialog"]:has(input[type="text"])';
const expectedFreeModels = [
  "Big Pickle", "MiMo-V2.6-Flash Free", "DeepSeek V4.1 Flash Free",
  "GLM-5.3-Flash Free", "LongCat 2.5 Free", "Iceman Free",
  "Inkling 2 Small Free", "Beam Free", "Flint 40B Free",
  "Nemotron 3.5 Super VL Free", "Nemotron 3.5 Lightning Free", "MiniMax M3.1 Flash Free",
];
const retiredFreeModels = [
  "Space Bunny Free", "Cat Jam Free", "LongCat 2.5 Preview Free",
  "Step 5 Preview Free", "Muse Spark 1.3 Contributor Free",
];

export default {
  id: "model-catalog-refresh",
  title: "Current GPT and OpenCode models appear in the model picker",
  kind: "user-facing",
  steps: [{ name: "Updated model directories", run: async ctx => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    await ctx.waitFor("window.__ipolloworkControl.listActions().some(action => action.id === 'session.model_picker.open' && !action.disabled)");
    await ctx.control("session.model_picker.open");
    await ctx.waitFor(`Boolean(document.querySelector('${dialog}'))`);
    try {
      await ctx.prove("OpenCode lists all twelve current free models and hides retired entries", {
        voiceover: "OpenCode 免费模型列表已更新为当前的十二个模型，退役模型不再出现。",
        action: async () => {
          await ctx.fill(`${dialog} input[type=text]`, "OpenCode");
          await ctx.waitFor(`document.querySelector('${dialog}').innerText.includes('OpenCode')`);
          await ctx.eval(`(() => {
            const picker = document.querySelector('${dialog}');
            if (!picker.innerText.includes('Iceman Free')) {
              [...picker.querySelectorAll('button')].find(button => button.textContent.includes('OpenCode'))?.click();
            }
          })()`);
        },
        assert: async () => {
          await ctx.waitFor(`(${JSON.stringify(expectedFreeModels)}).every(name => document.querySelector('${dialog}').innerText.includes(name))`);
          const text = await ctx.eval(`document.querySelector('${dialog}').innerText`);
          ctx.assert(retiredFreeModels.every(name => !text.includes(name)), "Retired free models remain excluded");
          ctx.assert(await ctx.eval(`document.querySelector('${dialog}').querySelectorAll('button span.font-mono').length === 12`), "Exactly twelve selectable model rows are rendered");
        },
        screenshot: { name: "opencode-current-models", requireText: ["OpenCode", "Iceman Free", "Inkling 2 Small Free"], rejectText: retiredFreeModels },
      });
      await ctx.prove("GPT-6.1 Terra and the latest GPT-6.1 variants are available", {
        voiceover: "GPT 模型列表已同步，新增 GPT-6.1 Terra、Terra Fast 和 Sol Ultrafast。",
        action: async () => {
          await ctx.fill(`${dialog} input[type=text]`, "gpt-6.1");
        },
        assert: async () => {
          await ctx.waitFor(`['gpt-6.1-terra', 'gpt-6.1-terra-fast', 'gpt-6.1-sol-ultrafast'].every(id => [...document.querySelectorAll('${dialog} button')].some(button => !button.disabled && [...button.querySelectorAll('span')].some(span => span.textContent === id)))`);
        },
        screenshot: { name: "gpt-current-models", requireText: ["GPT-6.1 Terra", "gpt-6.1-terra-fast", "gpt-6.1-sol-ultrafast"] },
      });
    } finally {
      if (await ctx.eval(`Boolean(document.querySelector('${dialog}'))`)) {
        await ctx.fill(`${dialog} input[type=text]`, "");
        await ctx.eval(`document.querySelector('${dialog} [data-slot="dialog-close"]')?.click()`);
      }
    }
  } }],
};
