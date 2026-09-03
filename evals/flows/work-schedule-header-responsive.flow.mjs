export default {
  id: "work-schedule-header-responsive",
  title: "Schedule header actions stay separated in a narrow window",
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
      name: "Keep the schedule actions apart",
      run: async (ctx) => {
        await ctx.prove("The new-schedule and close actions align on one centerline in a narrow window", {
          voiceover: "窗口变窄时，新建日程按钮会给关闭按钮留出空间，两个操作保持同排，中心线也完全对齐。",
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
            ctx.assert(Boolean(sessionId), "Expected an existing session for the floating close action.");
            await ctx.control("session.open", { sessionId });
            await ctx.waitFor(`location.hash.includes("/session/${sessionId}")`, {
              timeoutMs: 30_000,
              label: "selected session",
            });
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
          },
          assert: async () => {
            const geometry = await ctx.eval(`(() => {
              const header = [...document.querySelectorAll("header")]
                .find((candidate) => candidate.querySelector("h1")?.textContent?.trim() === "日程");
              const create = header && [...header.querySelectorAll("button")]
                .find((button) => button.textContent?.trim() === "新建日程")
                ?.getBoundingClientRect();
              const close = [...document.querySelectorAll("button")]
                .find((button) => button.querySelector("svg.lucide-x") && getComputedStyle(button).position === "absolute")
                ?.getBoundingClientRect();
              if (!create || !close) return null;
              return {
                create: { right: create.right, centerY: create.top + create.height / 2 },
                close: { left: close.left, centerY: close.top + close.height / 2 },
                gap: close.left - create.right,
                centerDelta: Math.abs(
                  create.top + create.height / 2 - (close.top + close.height / 2)
                ),
              };
            })()`);
            ctx.assert(Boolean(geometry), "Expected both schedule header actions to be visible.");
            ctx.assert(geometry.centerDelta <= 1, `Expected both actions on the same centerline: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.gap >= 8, `Expected at least 8px between the actions: ${JSON.stringify(geometry)}`);
          },
          screenshot: {
            name: "schedule-header-actions-separated",
            requireText: ["日程", "新建日程"],
            rejectText: ["正在加载", "出了点问题"],
          },
        });
      },
    },
  ],
};
