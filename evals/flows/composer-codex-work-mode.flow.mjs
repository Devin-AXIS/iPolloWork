const workModeTrigger = `Array.from(document.querySelectorAll('button'))
  .find((button) => button.getClientRects().length > 0
    && /^(工作模式|Work mode):/.test(button.getAttribute('aria-label') ?? ''))`;

export default {
  id: "composer-codex-work-mode",
  title: "Codex work mode switches between execute and plan",
  kind: "user-facing",
  steps: [
    {
      name: "Switch the Codex composer to plan mode",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("The Codex composer exposes Execute and Plan and switches to Plan", {
          voiceover: "Codex 对话框现在可以在执行和计划之间切换，选择计划后当前模式会立即更新。",
          action: async () => {
            const openedProject = await ctx.eval(`(() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              const project = document.querySelector('[data-testid="project-row"][title="codex"]')
                ?? Array.from(document.querySelectorAll('[data-testid="project-row"]'))
                  .find((row) => row.textContent?.trim().toLowerCase() === 'codex');
              const projectId = project?.getAttribute('data-project-id');
              if (projectId) sessionStorage.setItem('fraimz-codex-work-mode-project-id', projectId);
              project?.click();
              return Boolean(project);
            })()`);
            ctx.assert(openedProject, "Could not open the Codex project.");
            await ctx.waitFor(`location.hash.includes('/workspace/' + sessionStorage.getItem('fraimz-codex-work-mode-project-id') + '/')
              && window.__ipolloworkControl.listActions()
                .some((action) => action.id === 'session.create_task' && !action.disabled)`, {
              timeoutMs: 45_000,
              label: "ready Codex project",
            });
            await ctx.control("session.create_task");
            const retriedLaunch = await ctx.eval(`(() => {
              const retry = Array.from(document.querySelectorAll('button'))
                .find((button) => button.getClientRects().length > 0 && button.textContent?.trim() === 'Retry');
              retry?.click();
              return Boolean(retry);
            })()`);
            if (retriedLaunch) {
              await ctx.waitFor(`Boolean(${workModeTrigger})
                || !document.body.innerText.includes('OpenCode launch blocked')`, {
                timeoutMs: 15_000,
                label: "retry blocked OpenCode sidecar launch",
              });
            }
            await ctx.waitFor(`Boolean(${workModeTrigger})`, {
              timeoutMs: 45_000,
              label: "Codex work mode trigger",
            });
            await ctx.eval(`(${workModeTrigger})?.click()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-work-mode-option="default"]'))
              && Boolean(document.querySelector('[data-work-mode-option="plan"]'))`, {
              timeoutMs: 15_000,
              label: "Codex Execute and Plan options",
            });
            await ctx.trustedClick('button[data-work-mode-option="plan"]');
            await ctx.waitFor(`/(计划|Plan)$/.test((${workModeTrigger})?.getAttribute('aria-label') ?? '')`, {
              timeoutMs: 10_000,
              label: "Plan mode selected",
            });
            await ctx.eval(`(${workModeTrigger})?.click()`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              ids: Array.from(document.querySelectorAll('button[data-work-mode-option]'))
                .map((button) => button.getAttribute('data-work-mode-option')),
              planPressed: document.querySelector('button[data-work-mode-option="plan"]')?.getAttribute('aria-pressed'),
            }))()`);
            ctx.assert(JSON.stringify(state.ids) === JSON.stringify(["default", "plan"]), "Expected Execute and Plan only.");
            ctx.assert(state.planPressed === "true", "Plan mode is not selected.");
          },
          screenshot: {
            name: "composer-codex-work-mode-plan",
            rejectText: ["Could not open the Codex project", "Codex Harness request failed"],
          },
        });
      },
    },
  ],
};
