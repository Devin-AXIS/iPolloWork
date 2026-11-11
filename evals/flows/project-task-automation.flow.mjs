import { click, request } from "./native-agent-results.flow.mjs";

const tasksTab = '[data-testid="session-header-work-tasks"]';
const sheet = '[data-testid="work-item-sheet"]';
const automationSwitch = '[data-testid="work-item-automation"] [role="switch"]';

export default {
  id: "project-task-automation",
  title: "Schedule automatic execution from the project task board",
  kind: "user-facing",
  preserveTheme: true,
  steps: [
    {
      name: "Create and reopen a scheduled project task",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl) && !document.querySelector('[data-testid=startup-logo-animation]')");
        const [workspaceId, sessionId] = await ctx.eval(
          "location.hash.match(/\\/workspace\\/([^/]+)\\/session\\/([^/?]+)/)?.slice(1) ?? []",
        );
        ctx.assert(workspaceId && sessionId, "Open a project conversation before running this flow.");
        ctx.assert(await ctx.eval("!document.querySelector('[role=dialog]')"), "Close any open editor before running this flow.");
        const originalTab = await ctx.eval("document.querySelector('[data-testid^=session-header-][aria-current=page]')?.dataset.testid");
        const title = `自动执行验证 ${Date.now().toString(36)}`;
        const startDate = await ctx.eval(`(() => {
          const date = new Date();
          date.setDate(date.getDate() + 2);
          return new Intl.DateTimeFormat("sv-SE").format(date);
        })()`);
        const path = `/work-items?workspaceId=${encodeURIComponent(workspaceId)}&sessionId=${encodeURIComponent(sessionId)}`;
        const findTask = async () => (await request(ctx, path)).items.find(item => item.title === title);

        try {
          await ctx.prove("A new project task can save automatic execution", {
            voiceover: "我在项目看板新建任务，设置开始时间并开启自动执行，保存后再打开确认设置已生效。",
            action: async () => {
              await ctx.waitFor(`(() => {
                const tab = document.querySelector(${JSON.stringify(tasksTab)});
                if (tab?.getAttribute("aria-current") === "page") return true;
                tab?.click();
                return false;
              })()`, { label: "project Tasks tab selected" });
              await ctx.clickText("新建任务", { selector: '[data-testid="work-center"] > header button:not(:disabled)' });
              await ctx.fill("#work-item-title", title);
              await ctx.fill("#work-item-start-date", startDate);
              await click(ctx, automationSwitch);
              await ctx.clickText("保存", { selector: `${sheet} button` });
              await ctx.waitFor(`!document.querySelector(${JSON.stringify(sheet)})`, { label: "saved task editor closed" });
              await ctx.clickText(title, { selector: '[data-testid="project-board"] article > button' });
              await ctx.waitFor(`document.querySelector(${JSON.stringify(automationSwitch)})?.getAttribute("aria-checked") === "true"`, {
                label: "saved automatic execution switch is on",
              });
            },
            assert: async () => {
              const item = await findTask();
              ctx.assert(item?.startAt > Date.now(), "The saved task starts in the future.");
              ctx.assert(item.automation?.enabled && item.automation.recurrence === "once", "Automatic execution is saved on the conversation's task.");
              ctx.assert(await ctx.eval(`document.querySelector("#work-item-start-date").value === ${JSON.stringify(startDate)}`), "The chosen start date is restored.");
            },
            screenshot: { name: "project-task-automatic-execution", requireText: [title, "自动执行", "重复方式"] },
          });
        } finally {
          const item = await findTask();
          if (item) {
            await request(ctx, `/workspace/${workspaceId}/work-items/${item.id}?version=${item.version}`, "DELETE");
          }
          await ctx.eval(`document.querySelector('${sheet} [data-slot="sheet-close"]')?.click(); true`);
          if (originalTab) await click(ctx, `[data-testid="${originalTab}"]`);
        }
      },
    },
  ],
};
