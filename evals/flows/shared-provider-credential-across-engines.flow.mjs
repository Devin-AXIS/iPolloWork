/**
 * Standard-lane proof: one account OpenAI connection remains selectable in
 * both Codex Harness and OpenCode without an engine-specific login.
 */
export default {
  id: "shared-provider-credential-across-engines",
  title: "One provider credential works across agent engines",
  kind: "user-facing",
  steps: [
    {
      name: "Use the shared OpenAI connection in Codex Harness",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("The account OpenAI connection is selectable in Codex", {
          voiceover: "官方 Codex 已经登录后，iPolloWork 会把这份有效凭证纳入统一账户连接。Codex 项目可以直接选择 GPT 模型，不需要再次配置 Key。",
          action: async () => {
            await ctx.eval(`(() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              const project = Array.from(document.querySelectorAll('button, a'))
                .find((element) => element.textContent?.trim().toLowerCase() === 'codex');
              project?.click();
              return Boolean(project);
            })()`);
            await ctx.waitFor(`!document.body.innerText.includes('正在启动 Codex Harness')
              && Boolean(document.querySelector('[aria-label^="Codex Harness"]'))
              && Array.from(document.querySelectorAll('button'))
                .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))`, {
              timeoutMs: 30_000,
              label: "ready Codex composer",
            });
            await ctx.eval(`(() => {
              const trigger = Array.from(document.querySelectorAll('button'))
                .find((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''));
              trigger?.click();
              return Boolean(trigger);
            })()`);
            await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
            await ctx.eval(`(() => {
              const candidates = Array.from(document.querySelectorAll('button'))
                .filter((button) => button.textContent?.includes('切换模型')
                  && !/切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''));
              candidates.at(-1)?.click();
              return candidates.length > 0;
            })()`);
            await ctx.waitForText("GPT-5.3 Codex Spark", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const text = document.body.innerText;
              const models = Array.from(document.querySelectorAll('button'))
                .filter((button) => /GPT-/i.test(button.textContent ?? ''));
              return {
                hasOpenAI: text.includes('OpenAI'),
                enabledModel: models.some((button) => !button.disabled
                  && button.getAttribute('aria-disabled') !== 'true'),
                asksToReconnect: text.includes('连接此提供商以浏览和保存模型'),
              };
            })()`);
            ctx.assert(state.hasOpenAI, "OpenAI is missing from the Codex provider directory.");
            ctx.assert(state.enabledModel, "The shared GPT model is still disabled in Codex.");
            ctx.assert(!state.asksToReconnect, "Codex still asks for an engine-specific provider login.");
          },
          screenshot: {
            name: "codex-uses-account-openai",
            requireText: ["OpenAI", "GPT-5.3 Codex Spark"],
          },
        });
      },
    },
    {
      name: "Keep the same OpenAI connection in OpenCode",
      run: async (ctx) => {
        await ctx.prove("The same account connection remains available in OpenCode", {
          voiceover: "切换回 OpenCode 后，同一份 OpenAI 账户连接仍然可用。凭证属于 iPolloWork 账户，而不是某一个 Harness 或某一个项目。",
          action: async () => {
            await ctx.eval(`(async () => {
              window.__fraimzPreviousProjectHash = location.hash;
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 80));
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 80));
              const project = Array.from(document.querySelectorAll('button, a'))
                .find((element) => element.textContent?.trim().toLowerCase() === 'opencode');
              project?.click();
              return Boolean(project);
            })()`);
            await ctx.waitFor(`location.hash !== window.__fraimzPreviousProjectHash
              && Boolean(document.querySelector('[aria-label^="OpenCode"]'))
              && Array.from(document.querySelectorAll('button'))
                .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))`, {
              timeoutMs: 30_000,
              label: "ready OpenCode composer",
            });
            await ctx.eval(`(() => {
              const trigger = Array.from(document.querySelectorAll('button'))
                .find((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''));
              trigger?.click();
              return Boolean(trigger);
            })()`);
            await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
            await ctx.eval(`(() => {
              const candidates = Array.from(document.querySelectorAll('button'))
                .filter((button) => button.textContent?.includes('切换模型')
                  && !/切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''));
              candidates.at(-1)?.click();
              return candidates.length > 0;
            })()`);
            await ctx.waitForText("OpenAI", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const text = document.body.innerText;
              const models = Array.from(document.querySelectorAll('button'))
                .filter((button) => /GPT-/i.test(button.textContent ?? ''));
              return {
                hasOpenAI: text.includes('OpenAI'),
                enabledGpt: models.some((button) => !button.disabled
                  && button.getAttribute('aria-disabled') !== 'true'),
                asksToReconnect: text.includes('连接此提供商以浏览和保存模型'),
              };
            })()`);
            ctx.assert(state.hasOpenAI, "OpenAI is missing after switching engines.");
            ctx.assert(state.enabledGpt, "The shared GPT connection is disabled in OpenCode.");
            ctx.assert(!state.asksToReconnect, "OpenCode asks to reconnect the already shared provider.");
          },
          screenshot: {
            name: "opencode-keeps-account-openai",
            requireText: ["OpenAI"],
          },
        });
      },
    },
  ],
};
