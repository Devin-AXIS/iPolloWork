const ENGINE_ID = "deepseek-harness";
const PROJECT_NAME = "缺失引擎恢复验证";

export default {
  id: "missing-project-engine-download",
  title: "A project with a missing engine offers a real download action",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "desktop control bridge",
    });
    const engine = await ctx.eval(`window.__IPOLLOWORK_ELECTRON__?.invokeDesktop?.("enginePackagesList")
      .then((items) => items.find((item) => item.id === ${JSON.stringify(ENGINE_ID)}))`, { awaitPromise: true });
    return engine?.installed ? "This proof requires an isolated profile without DeepSeek Harness installed." : null;
  },
  steps: [
    {
      name: "Open a project whose engine is missing",
      run: async (ctx) => {
        await ctx.prove("A project with a missing engine waits for the user to start a real download", {
          voiceover: "打开缺少 DeepSeek Harness 的项目时，页面会明确提示需要安装并显示下载引擎按钮，不会在用户操作前伪装成正在下载。",
          action: async () => {
            await ctx.navigateHash("/");
            await ctx.eval(`document.querySelector('[data-testid="create-project-dialog"] [data-slot="dialog-close"]')?.click()`);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-project-button]'))", {
              timeoutMs: 30_000,
              label: "new project action",
            });
            const opened = await ctx.eval(`(() => {
              const button = [...document.querySelectorAll('[data-testid="new-project-button"]')]
                .find((entry) => entry.getClientRects().length > 0);
              if (!button) return false;
              const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
              const onClick = propsKey ? button[propsKey]?.onClick : null;
              if (typeof onClick === 'function') {
                onClick({ currentTarget: button, target: button, preventDefault() {}, stopPropagation() {} });
              } else {
                button.click();
              }
              return true;
            })()`);
            ctx.assert(opened, "The visible new-project action was not available.");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=create-project-dialog]'))", {
              timeoutMs: 10_000,
              label: "create project dialog",
            });
            await ctx.fill("#create-project-name", PROJECT_NAME);
            await ctx.eval(`document.querySelector('[data-testid="project-engine-option"][data-engine-id="${ENGINE_ID}"] input')?.click()`);
            const created = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="create-project-dialog"]');
              const button = [...(dialog?.querySelectorAll('button') ?? [])]
                .find((entry) => ['新建项目', 'New project'].includes(entry.textContent?.trim() ?? ''));
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(created, "The DeepSeek Harness project could not be created.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="engine-install-gate"][data-engine-id="${ENGINE_ID}"]'))`, {
              timeoutMs: 60_000,
              label: "missing engine download gate",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const gate = document.querySelector('[data-testid="engine-install-gate"][data-engine-id="${ENGINE_ID}"]');
              const button = [...(gate?.querySelectorAll('button') ?? [])]
                .find((entry) => /下载引擎|Download engine/.test(entry.textContent ?? ''));
              return {
                gateVisible: Boolean(gate && gate.getClientRects().length > 0),
                buttonVisible: Boolean(button && button.getClientRects().length > 0 && !button.disabled),
                progressVisible: Boolean(gate?.querySelector('[data-testid="engine-download-progress"]')),
                ariaBusy: gate?.getAttribute('aria-busy'),
              };
            })()`);
            ctx.assert(state.gateVisible, "The missing-engine page should be visible.");
            ctx.assert(state.buttonVisible, "The missing-engine page should offer an enabled download button.");
            ctx.assert(!state.progressVisible, "Download progress must stay hidden until the user starts the download.");
            ctx.assert(state.ariaBusy === "false", "The page must not report a busy download before the user clicks.");
          },
          screenshot: {
            name: "missing-dsh-engine-download-action",
            requireText: ["DeepSeek Harness"],
            rejectText: ["正在下载", "Downloading"],
          },
        });
      },
    },
  ],
};
