export default {
  id: "new-conversation-saved-templates-hidden",
  title: "New conversation starter hides saved templates",
  kind: "user-facing",
  preserveTheme: true,
  steps: [
    {
      name: "Open the website template starter",
      run: async (ctx) => {
        await ctx.prove("The website template recommendations remain available without the saved-templates block", {
          voiceover: "进入创作首页后，网站模板推荐仍然显示，但已保存模板区域不再占用输入框上方的空间。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 60_000,
              label: "control API",
            });
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 980,
              height: 820,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.eval(`(() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              const action = window.__ipolloworkControl.listActions()
                .find((candidate) => candidate.id === 'session.create_task' && !candidate.disabled);
              if (action) return true;
              const project = document.querySelector('[data-testid="project-row"]');
              project?.click();
              return Boolean(project);
            })()`);
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions()
                .some((action) => action.id === 'session.create_task' && !action.disabled)`,
              { timeoutMs: 60_000, label: "enabled new-task action" },
            );
            await ctx.control("session.create_task");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-conversation-starter-layout]'))", {
              timeoutMs: 60_000,
              label: "new-conversation starter",
            });
            await ctx.eval(`(() => {
              const tabs = [...document.querySelectorAll('[role=tab]')];
              tabs[2]?.click();
              return tabs.length;
            })()`);
            await ctx.waitFor(`(() => {
              const actions = document.querySelector('[data-testid=new-conversation-quick-actions]');
              const firstAction = actions?.querySelector('button');
              if (!firstAction) return false;
              firstAction.click();
              return true;
            })()`, {
              timeoutMs: 15_000,
              label: "website template action",
            });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-conversation-template-strip]'))", {
              timeoutMs: 45_000,
              label: "website template recommendations",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              hasTemplateStrip: Boolean(document.querySelector('[data-testid=new-conversation-template-strip]')),
              hasComposer: Boolean(document.querySelector('[data-testid=new-conversation-starter-composer-shell]')),
              hasSavedTemplates: document.body.innerText.includes('已保存模板')
                || document.body.innerText.includes('Saved templates'),
            }))()`);
            ctx.assert(state.hasTemplateStrip, "Website template recommendations disappeared.");
            ctx.assert(state.hasComposer, "The new-conversation composer disappeared.");
            ctx.assert(!state.hasSavedTemplates, "The saved-templates block is still visible.");
          },
          screenshot: {
            name: "website-templates-without-saved-block",
            rejectText: ["已保存模板", "Saved templates", "Something went wrong"],
          },
        });
      },
    },
  ],
};
