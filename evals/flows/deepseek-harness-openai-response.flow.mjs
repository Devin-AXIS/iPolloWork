const RESPONSE_TOKEN = "DSH_GPT_OK_825";

export default {
  id: "deepseek-harness-openai-response",
  title: "DeepSeek Harness sends a real GPT request with the shared OpenAI credential",
  kind: "user-facing",
  steps: [
    {
      name: "Send a GPT-5.5 message through DeepSeek Harness",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("DeepSeek Harness can use GPT-5.5 without another provider login", {
          voiceover: "在 DeepSeek Harness 项目中选择 GPT-5.5 后，用户可以直接发送消息并收到回复，不再出现 Provider 未配置错误。",
          action: async () => {
            await ctx.eval(`(async () => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 80));
              const project = Array.from(document.querySelectorAll('button, a'))
                .find((element) => element.textContent?.trim().toLowerCase() === 'dsh');
              project?.click();
              return Boolean(project);
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label^="DeepSeek Harness"]'))
              && window.__ipolloworkControl.listActions()
                .some((action) => action.id === 'session.create_task' && !action.disabled)`, {
              timeoutMs: 45_000,
              label: "ready DeepSeek Harness composer",
            });
            await ctx.control("session.create_task");
            await ctx.waitFor(`Array.from(document.querySelectorAll('button'))
              .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))`, {
              timeoutMs: 30_000,
              label: "DeepSeek Harness model trigger",
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
            await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
              .some((item) => item.textContent?.includes('GPT-5.5')
                && !item.textContent?.includes('Fast')
                && !item.hasAttribute('data-disabled'))`, {
              timeoutMs: 30_000,
              label: "enabled GPT-5.5 model",
            });
            await ctx.eval(`(() => {
              sessionStorage.setItem('fraimz-dsh-model-selected-at', String(Date.now()));
              const model = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
                .find((item) => item.textContent?.includes('GPT-5.5')
                  && !item.textContent?.includes('Fast')
                  && !item.hasAttribute('data-disabled'));
              model?.click();
              return Boolean(model);
            })()`);
            await ctx.waitFor(`Date.now() - Number(sessionStorage.getItem('fraimz-dsh-model-selected-at')) > 1500
              && Boolean(window.__ipolloworkControl)
              && !document.body.innerText.includes('Loading...')
              && Boolean(document.querySelector('[contenteditable="true"]'))
              && Array.from(document.querySelectorAll('button'))
                .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
                  && button.textContent?.includes('GPT-5.5'))`, {
              timeoutMs: 30_000,
              label: "stable GPT-5.5 composer",
            });
            await ctx.control("composer.set_text", {
              text: `只回复 ${RESPONSE_TOKEN}，不要添加其他内容。`,
            });
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === 'composer.send' && !action.disabled)`, {
              timeoutMs: 15_000,
              label: "enabled DeepSeek Harness send action",
            });
            const submitted = await ctx.eval(`(() => {
              const submit = Array.from(document.querySelectorAll('button'))
                .find((button) => /运行任务|Run task/i.test(button.getAttribute('title') ?? '')
                  && !button.disabled)
                || Array.from(document.querySelectorAll('button'))
                  .find((button) => button.querySelector('svg[class*="arrow-up"]')
                    && !button.disabled);
              submit?.click();
              return Boolean(submit);
            })()`);
            ctx.assert(submitted, "Could not submit the DeepSeek Harness message.");
          },
          assert: async () => {
            await ctx.waitFor(`(document.body.innerText.match(/${RESPONSE_TOKEN}/g) ?? []).length >= 2`, {
              timeoutMs: 120_000,
              label: "GPT response token",
            });
            await ctx.expectNoText("Provider is not configured");
          },
          screenshot: {
            name: "deepseek-harness-gpt-response",
            requireText: [RESPONSE_TOKEN, "DeepSeek Harness"],
            rejectText: ["Provider is not configured"],
          },
        });
      },
    },
  ],
};
