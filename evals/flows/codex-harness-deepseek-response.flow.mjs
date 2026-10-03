const RESPONSE_TOKEN = "CODEX_DEEPSEEK_OK_825";

export default {
  id: "codex-harness-deepseek-response",
  title: "Codex Harness sends a real DeepSeek request with the shared provider credential",
  kind: "user-facing",
  steps: [
    {
      name: "Send a DeepSeek message through Codex Harness",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("Codex Harness can use a shared DeepSeek provider connection", {
          voiceover: "在 Codex Harness 项目中选择 DeepSeek 模型后，用户可以直接发送消息并收到回复，证明供应商凭证能够跨引擎统一使用。",
          action: async () => {
            await ctx.eval(`(async () => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 80));
              const project = document.querySelector('[data-testid="project-row"][title="codex"]');
              const projectId = project?.getAttribute('data-project-id');
              if (projectId) sessionStorage.setItem('fraimz-codex-project-id', projectId);
              project?.click();
              return Boolean(project);
            })()`);
            await ctx.waitFor(`location.hash.includes('/workspace/' + sessionStorage.getItem('fraimz-codex-project-id') + '/')
              && Boolean(document.querySelector('[aria-label^="Codex Harness"]'))
              && window.__ipolloworkControl.listActions()
                .some((action) => action.id === 'session.create_task' && !action.disabled)`, {
              timeoutMs: 45_000,
              label: "ready Codex Harness composer",
            });
            const opened = await ctx.eval(`(() => {
              const target = Array.from(document.querySelectorAll('a'))
                .find((element) => element.getClientRects().length > 0
                  && element.textContent?.trim() === '只回复 CODEX_DEEPSEEK_DEBUG_825');
              target?.click();
              return Boolean(target);
            })()`);
            ctx.assert(opened, "Could not open a saved Codex Harness session.");
            await ctx.waitFor(`Array.from(document.querySelectorAll('button'))
                .some((button) => button.getClientRects().length > 0
                  && /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
                  && /DeepSeek[ -]?V4[ -]?Flash/i.test(button.textContent ?? ''))
              && Boolean(document.querySelector('[contenteditable="true"]'))
              && window.__ipolloworkControl.listActions()
                .some((action) => action.id === 'composer.set_text' && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "saved DeepSeek V4 Flash session",
            });
            await ctx.control("composer.set_text", {
              text: `只回复 ${RESPONSE_TOKEN}，不要添加其他内容。`,
            });
            await ctx.waitFor(`document.body.innerText.includes('${RESPONSE_TOKEN}')
              && window.__ipolloworkControl.listActions()
                .some((action) => action.id === 'composer.send' && !action.disabled)`, {
              timeoutMs: 15_000,
              label: "enabled Codex Harness send action",
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
            ctx.assert(submitted, "Could not submit the Codex Harness message.");
          },
          assert: async () => {
            await ctx.waitFor(`(document.body.innerText.match(/${RESPONSE_TOKEN}/g) ?? []).length >= 2
              && !((document.querySelector('[contenteditable="true"]')?.textContent ?? '')
                .includes('${RESPONSE_TOKEN}'))
              && !document.body.innerText.includes('正在思考')
              && Array.from(document.querySelectorAll('button'))
                .some((button) => button.getClientRects().length > 0
                  && /运行任务|Run task/i.test(button.getAttribute('title') ?? '')
                  && !button.disabled)`, {
              timeoutMs: 120_000,
              label: "DeepSeek response token",
            });
            await ctx.expectNoText("Provider is not configured");
          },
          screenshot: {
            name: "codex-harness-deepseek-response",
            requireText: [RESPONSE_TOKEN, "Codex Harness"],
            rejectText: ["Provider is not configured"],
          },
        });
      },
    },
  ],
};
