export default {
  id: "composer-context-health",
  title: "Composer shows context usage instead of the engine badge",
  kind: "user-facing",
  steps: [
    {
      name: "Inspect current context health",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "control API",
        });
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=composer-context-health]'))", {
          timeoutMs: 60_000,
          label: "context health control",
        });
        await ctx.prove("Every engine uses one compact context-usage control in the composer", {
          voiceover: "输入框右下角现在统一显示当前上下文、模型上限和占比，接近上限时还会提前提示压缩。",
          action: async () => {
            await ctx.eval(`document.querySelector('[data-testid=composer-context-health]')?.click()`);
            await ctx.waitFor(`(() => {
              const popover = document.querySelector('[data-slot=popover-content]');
              return Boolean(popover && /Current context|当前上下文/.test(popover.innerText || ''));
            })()`, {
              timeoutMs: 10_000,
              label: "context health popover",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const control = document.querySelector('[data-testid=composer-context-health]');
              const popover = document.querySelector('[data-slot=popover-content]');
              return {
                height: control?.getBoundingClientRect().height || 0,
                label: control?.getAttribute('aria-label') || '',
                summary: control?.innerText.trim() || '',
                detail: popover?.innerText || '',
                insideComposer: Boolean(control?.closest('[data-session-surface-id], [data-testid=initial-project-task-starter], [data-testid=new-conversation-starter-composer-shell]')),
                engineId: control?.getAttribute('data-engine-id') || '',
                oldBadgeCount: document.querySelectorAll('[data-testid=session-composer-engine-badge], [data-testid=initial-project-engine-badge]').length,
              };
            })()`);
            ctx.assert(state.height === 32, `Expected a 32px context control, found ${state.height}px.`);
            ctx.assert(state.insideComposer, "Context health should render inside the conversation composer.");
            ctx.assert(/Context health|上下文体检/.test(state.label), `Unexpected context label: ${state.label}`);
            ctx.assert(state.summary.includes("/"), `Context summary should compare used and maximum tokens: ${state.summary}`);
            ctx.assert(!/Unknown|未知/.test(`${state.summary}\n${state.detail}`), "The selected model context limit should be resolved.");
            ctx.assert(/Current context|当前上下文/.test(state.detail), "Context details should show the current usage.");
            ctx.assert(/Selected model limit|所选模型上限/.test(state.detail), "Context details should show the selected model limit.");
            ctx.assert(state.engineId === "", "The context control must not retain the old engine identity attribute.");
            ctx.assert(state.oldBadgeCount === 0, "The former composer engine badge should be removed.");
          },
          screenshot: {
            name: "composer-context-health",
            fromSurface: true,
            rejectText: ["Something went wrong", "Request timed out", "请求超时"],
          },
        });
      },
    },
  ],
};
