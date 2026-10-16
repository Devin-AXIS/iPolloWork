export default {
  id: "project-engine-card-responsive",
  title: "New-project engine cards adapt to the dialog width",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-project-button]'))", {
      timeoutMs: 30_000,
      label: "new project action",
    });
    return null;
  },
  steps: [
    {
      name: "Wrap engine cards without clipping their content",
      run: async (ctx) => {
        await ctx.prove("The engine cards wrap to fit a narrow project dialog without clipping content", {
          voiceover: "窗口变窄时，引擎卡片会自动换行，第三张卡片会以相同尺寸落在下一行；名称、安装状态和单选标记都不会跑出卡片边界。",
          action: async () => {
            await ctx.eval(`(() => {
              localStorage.setItem('ipollowork.react.settings.theme-mode', 'light');
              location.reload();
              return true;
            })()`);
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 60_000,
              label: "control API after theme change",
            });
            await ctx.waitFor(`(() => {
              if (document.querySelector('[data-testid=startup-logo-animation]')) return false;
              return ![...document.querySelectorAll('[role=status]')]
                .some((element) => /Loading|Installing required resources|正在加载|正在安装所需资源/.test(element.innerText || ''));
            })()`, {
              timeoutMs: 120_000,
              label: "app content without a startup overlay",
            });
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 720,
              height: 900,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.waitFor(`(() => {
              const button = document.querySelector('[data-testid=new-project-button]');
              if (!button) return false;
              button.click();
              return true;
            })()`, {
              timeoutMs: 10_000,
              label: "open new project dialog",
            });
            await ctx.waitFor(`(() => {
              const cards = [...document.querySelectorAll('[data-testid=project-engine-option]')];
              return cards.length === 3 && cards[2].getBoundingClientRect().top > cards[0].getBoundingClientRect().bottom;
            })()`, {
              timeoutMs: 10_000,
              label: "responsive engine card wrap",
            });
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const dialogRect = document.querySelector('[data-testid=create-project-dialog]').getBoundingClientRect();
              const cards = [...document.querySelectorAll('[data-testid=project-engine-option]')].map((card) => {
                const rect = card.getBoundingClientRect();
                const visibleChildren = [...card.children].filter((child) => child.tagName !== 'INPUT');
                return {
                  width: rect.width,
                  height: rect.height,
                  top: rect.top,
                  bottom: rect.bottom,
                  left: rect.left,
                  right: rect.right,
                  contentLeft: Math.min(...visibleChildren.map((child) => child.getBoundingClientRect().left)),
                  contentRight: Math.max(...visibleChildren.map((child) => child.getBoundingClientRect().right)),
                };
              });
              return {
                dialog: { left: dialogRect.left, right: dialogRect.right },
                cards,
                viewportWidth: innerWidth,
              };
            })()`);
            const { dialog, cards, viewportWidth } = result;
            ctx.assert(cards.length === 3, `Expected three engine cards, found ${cards.length}.`);
            ctx.assert(cards.every((card) => card.width >= 204 && card.height >= 119), "Every engine card should retain its minimum readable size.");
            ctx.assert(Math.abs(cards[0].width - cards[1].width) <= 1, "Cards on the first row should share the available width evenly.");
            ctx.assert(Math.abs(cards[2].width - cards[0].width) <= 1 && Math.abs(cards[2].height - cards[0].height) <= 1 && cards[2].top > cards[0].bottom, "The final card should wrap to the next row without changing size.");
            ctx.assert(cards.every((card) => card.contentLeft >= card.left && card.contentRight <= card.right), "Visible card content should remain inside every card boundary.");
            ctx.assert(dialog.left >= 16 && dialog.right <= viewportWidth - 16, "The project dialog should remain inside the narrow viewport.");
          },
          screenshot: {
            name: "new-project-engine-cards-responsive",
            requireText: ["OpenCode", "DeepSeek Harness", "Codex Harness"],
            rejectText: ["Loading...", "Something went wrong", "正在加载", "出了点问题"],
          },
        });
      },
    },
  ],
};
