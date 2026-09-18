export default {
  id: "work-schedule-header-responsive",
  title: "Schedule header restores the sidebar without a redundant close action",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    return null;
  },
  steps: [
    {
      name: "Restore the collapsed sidebar from Schedule",
      run: async (ctx) => {
        await ctx.prove("The Schedule header keeps the sidebar restore and new-schedule actions accessible without a close button", {
          voiceover: "左侧栏收起时，日程页在左上角提供展开侧栏入口；页面不再需要右上角关闭按钮，新建日程仍保持清晰可用。",
          action: async () => {
            await ctx.eval(`(() => {
              localStorage.setItem("ipollowork.language", "zh");
              location.reload();
              return true;
            })()`);
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 60_000,
              label: "control API after locale change",
            });
            await ctx.waitFor(`(() => {
              if (document.querySelector('[data-testid=startup-logo-animation]')) return false;
              return [...document.querySelectorAll("button")]
                .some((button) => button.textContent?.trim() === "日程");
            })()`, {
              timeoutMs: 120_000,
              label: "schedule navigation",
            });
            const sessions = await ctx.control("session.list_sessions");
            const sessionId = sessions[0]?.sessionId ?? null;
            ctx.assert(Boolean(sessionId), "Expected an existing session for schedule navigation.");
            await ctx.control("session.open", { sessionId });
            await ctx.waitFor(`location.hash.includes("/session/${sessionId}")`, {
              timeoutMs: 30_000,
              label: "selected session",
            });
            if (await ctx.eval(`Boolean(document.querySelector('[role="dialog"]'))`)) {
              await ctx.client.send("Input.dispatchKeyEvent", {
                type: "keyDown",
                key: "Escape",
                code: "Escape",
                windowsVirtualKeyCode: 27,
              });
              await ctx.client.send("Input.dispatchKeyEvent", {
                type: "keyUp",
                key: "Escape",
                code: "Escape",
                windowsVirtualKeyCode: 27,
              });
              await ctx.waitFor(`!document.querySelector('[role="dialog"]')`, {
                timeoutMs: 10_000,
                label: "dismissed unrelated session dialog",
              });
            }
            await ctx.waitFor(`(() => {
              if (document.querySelector('[data-testid=startup-logo-animation]')) return false;
              return [...document.querySelectorAll("button")]
                .some((button) => button.textContent?.trim() === "日程");
            })()`, {
              timeoutMs: 120_000,
              label: "schedule navigation with a selected session",
            });
            const viewportHeight = await ctx.eval("innerHeight");
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 960,
              height: viewportHeight,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.eval(`(() => {
              const button = [...document.querySelectorAll("button")]
                .find((candidate) => candidate.textContent?.trim() === "日程");
              if (!button) throw new Error("Schedule navigation was not found");
              button.click();
              return true;
            })()`);
            await ctx.waitFor(`(() => {
              const header = [...document.querySelectorAll("header")]
                .find((candidate) => candidate.querySelector("h1")?.textContent?.trim() === "日程");
              return Boolean(header && [...header.querySelectorAll("button")]
                .some((button) => button.textContent?.trim() === "新建日程"));
            })()`, {
              timeoutMs: 30_000,
              label: "global schedule header",
            });
            await ctx.eval(`(() => {
              const collapse = [...document.querySelectorAll('button')]
                .find((button) => button.getAttribute('aria-label') === '收起');
              if (!collapse) throw new Error('Sidebar collapse action was not found');
              collapse.click();
              return true;
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="work-center-sidebar-restore"]'))`, {
              timeoutMs: 10_000,
              label: "schedule sidebar restore action",
            });
          },
          assert: async () => {
            const geometry = await ctx.eval(`(() => {
              const header = [...document.querySelectorAll("header")]
                .find((candidate) => candidate.querySelector("h1")?.textContent?.trim() === "日程");
              const create = header && [...header.querySelectorAll("button")]
                .find((button) => button.textContent?.trim() === "新建日程")
                ?.getBoundingClientRect();
              const restore = header?.querySelector('[data-testid="work-center-sidebar-restore"]')
                ?.getBoundingClientRect();
              if (!create || !restore) return null;
              return {
                create: { right: create.right, centerY: create.top + create.height / 2 },
                restore: { right: restore.right, centerY: restore.top + restore.height / 2 },
                overlap: restore.right > create.left,
                centerDelta: Math.abs(
                  create.top + create.height / 2 - (restore.top + restore.height / 2)
                ),
                hasFloatingClose: [...document.querySelectorAll("button")]
                  .some((button) => button.querySelector("svg.lucide-x") && getComputedStyle(button).position === "absolute"),
              };
            })()`);
            ctx.assert(Boolean(geometry), "Expected the schedule restore and create actions to be visible.");
            ctx.assert(geometry.centerDelta <= 1, `Expected both actions on the same centerline: ${JSON.stringify(geometry)}`);
            ctx.assert(!geometry.overlap, `Expected schedule header actions not to overlap: ${JSON.stringify(geometry)}`);
            ctx.assert(!geometry.hasFloatingClose, "Schedule should not render a floating close action.");
          },
          screenshot: {
            name: "schedule-header-sidebar-restore",
            requireText: ["日程", "新建日程"],
            rejectText: ["正在加载", "出了点问题"],
          },
        });
      },
    },
  ],
};
