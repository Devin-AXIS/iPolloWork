const FILES_TRIGGER = 'button[aria-label="查看任务文件"], button[aria-label="Show task files"]';

async function createLocalTask(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
    timeoutMs: 60_000,
    label: "iPolloWork control API",
  });
  await ctx.control("route.session");
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 45_000,
    label: "available local project",
  });
  await ctx.control("session.create_task");
  await ctx.waitFor(`location.hash.includes("/session/")`, {
    timeoutMs: 45_000,
    label: "new task route",
  });
  await ctx.eval(`(() => {
    const sessionId = (location.hash.split("/session/")[1] ?? "")
      .split("?")[0]
      .split("/")[0];
    sessionStorage.setItem("fraimz-conversation-files-session-id", sessionId);
    return sessionId;
  })()`);
  const sessionId = await ctx.eval(`sessionStorage.getItem("fraimz-conversation-files-session-id") ?? ""`);
  await ctx.control("session.rename", { sessionId, title: "今日 AI 热点分析的 PPT" });
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "eval.design.seed_html" && !action.disabled)`, {
    timeoutMs: 45_000,
    label: "design fixture action",
  });
}

export default {
  id: "conversation-files-dual-view",
  title: "Task files switch between key outputs and the full workspace directory",
  kind: "user-facing",
  steps: [
    {
      name: "Show the generated output view",
      run: async (ctx) => {
        await createLocalTask(ctx);
        try {
          await ctx.prove("Generated HTML uses a task-specific name in a compact output card", {
            voiceover: "产出文件现在以清晰的任务名称呈现，卡片更紧凑，仍可直接打开继续编辑。",
            action: async () => {
              await ctx.control("eval.design.seed_html");
              await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(FILES_TRIGGER)}))`, {
                timeoutMs: 30_000,
                label: "task files trigger",
              });
              await ctx.eval(`document.querySelector(${JSON.stringify(FILES_TRIGGER)})?.click()`);
              await ctx.waitFor(`Boolean(document.querySelector('[data-testid="conversation-files-outputs-view"]'))`, {
                timeoutMs: 30_000,
                label: "generated outputs view",
              });
            },
            assert: async () => {
              await ctx.waitFor(`document.body.innerText.includes("今日-AI-热点分析.html")`, {
                timeoutMs: 30_000,
                label: "task-specific HTML output name",
              });
              const card = await ctx.eval(`(() => {
                const item = document.querySelector('[data-testid="conversation-files-outputs-view"] > div');
                const button = item?.querySelector('button');
                if (!button) return null;
                const rect = button.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
              })()`);
              ctx.assert(card && card.width >= 200, "The output card is too narrow to scan.");
              ctx.assert(card && card.height <= 90, "The output card did not use the compact horizontal layout.");
            },
            screenshot: {
              name: "task-files-key-outputs",
              requireText: ["今日-AI-热点分析.html"],
              rejectText: ["entry.html", "Could not read workspace files", "无法读取工作区文件"],
            },
          });
        } catch (error) {
          await ctx.control("session.archive", {
            sessionId: await ctx.eval(`sessionStorage.getItem("fraimz-conversation-files-session-id") ?? ""`),
            archived: true,
          }).catch(() => undefined);
          throw error;
        }
      },
    },
    {
      name: "Switch to and filter the full workspace directory",
      run: async (ctx) => {
        try {
          await ctx.prove("The same panel switches to a searchable full workspace directory", {
            voiceover: "切换到目录后，我可以展开整个工作区并筛选文件，同时仍然可以一键回到主要产出。",
            action: async () => {
              await ctx.trustedClick('[data-testid="conversation-files-mode-directory"]');
              await ctx.waitFor(`Boolean(document.querySelector('[data-testid="conversation-files-directory-view"]'))`, {
                timeoutMs: 45_000,
                label: "workspace directory view",
              });
              const input = 'input[placeholder="筛选文件…"], input[placeholder="Filter files…"]';
              await ctx.fill(input, "entry.html");
              await ctx.waitFor(`document.body.innerText.includes("entry.html")`, {
                timeoutMs: 15_000,
                label: "filtered workspace file",
              });
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
                directory: Boolean(document.querySelector('[data-testid="conversation-files-directory-view"]')),
                outputsToggle: Boolean(document.querySelector('[data-testid="conversation-files-mode-outputs"]')),
                file: document.body.innerText.includes("entry.html"),
              }))()`);
              ctx.assert(state.directory, "The workspace directory did not render.");
              ctx.assert(state.outputsToggle, "The outputs switch is missing.");
              ctx.assert(state.file, "The filtered generated file is missing from the directory.");
            },
            screenshot: {
              name: "task-files-full-directory",
              requireText: ["entry.html"],
              rejectText: ["Could not read workspace files", "无法读取工作区文件"],
            },
          });
        } finally {
          const sessionId = await ctx.eval(`sessionStorage.getItem("fraimz-conversation-files-session-id") ?? ""`);
          if (sessionId) {
            await ctx.control("session.archive", { sessionId, archived: true }).catch(() => undefined);
          }
          await ctx.eval(`sessionStorage.removeItem("fraimz-conversation-files-session-id")`);
        }
      },
    },
  ],
};
