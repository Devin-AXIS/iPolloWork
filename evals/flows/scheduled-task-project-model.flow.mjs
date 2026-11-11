import { setTimeout } from "node:timers/promises";
import { click, request } from "./native-agent-results.flow.mjs";

const composerModel = 'button:is([aria-label^="切换模型"], [aria-label^="Change model"])';
const modelId = "qwen3.7-max";
const providerId = "alibaba-cn";
const reply = "定时模型验证通过";

export default {
  id: "scheduled-task-project-model",
  title: "Scheduled tasks use the model shown in the project composer",
  kind: "user-facing",
  preserveTheme: true,
  steps: [{
    name: "Run a scheduled task that follows the project model",
    async run(ctx) {
      await ctx.waitFor("Boolean(window.__ipolloworkControl) && !document.querySelector('[data-testid=startup-logo-animation]')");
      const originalHash = await ctx.eval("location.hash");
      const source = process.env.IPOLLOWORK_AUTOMATION_SOURCE_ROUTE ?? originalHash;
      const workspaceId = source.match(/\/workspace\/([^/]+)\/session\/[^/]+/)?.[1];
      ctx.assert(workspaceId, "Open a project conversation with Alibaba Qwen3.7 Max selected.");
      const workspacePath = `/workspace/${encodeURIComponent(workspaceId)}`;
      const itemsPath = `/work-items?workspaceId=${encodeURIComponent(workspaceId)}`;
      const title = `定时任务模型验证 ${Date.now().toString(36)}`;
      const findTask = async () => (await request(ctx, itemsPath)).items.find(
        item => item.title === title && !item.execution,
      );
      let snapshot;
      try {
        await ctx.prove("Follow project model dispatches to Alibaba Qwen3.7 Max", {
          voiceover: "项目输入框显示 Qwen3.7 Max，选择跟随项目智能体的定时任务也用这个模型完成回复。",
          action: async () => {
            await ctx.navigateHash(source);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=session-header-work-conversation]'))");
            await click(ctx, "[data-testid=session-header-work-conversation]");
            await ctx.waitFor(
              `/qwen3\\.7 max/i.test(document.querySelector(${JSON.stringify(composerModel)})?.textContent ?? "")`,
              { label: "Qwen3.7 Max is displayed in the project composer" },
            );
            const selection = await ctx.eval("JSON.parse(localStorage.getItem('ipollowork.preferences') || '{}').enginePreferences?.opencode?.model");
            ctx.assert(selection?.providerID === providerId && selection?.modelID === modelId, "The project uses the Alibaba route for Qwen3.7 Max.");
            const task = await request(ctx, `${workspacePath}/work-items`, "POST", {
              title,
              description: `只回复“${reply}”，不需要使用任何工具。`,
              startAt: Date.now() - 1_000,
              automation: { enabled: true, recurrence: "once", model: null },
            });
            ctx.assert(task.automation?.model === null, "The scheduled task has no explicit model override.");
            const deadline = Date.now() + 65_000;
            while (Date.now() < deadline) {
              const item = await findTask();
              if (item?.status === "failed") throw new Error(item.automationLastError || "Scheduled task failed");
              if (item?.status === "review" && item.automationLastSessionId) {
                const sessionId = item.automationLastSessionId;
                snapshot = (await request(ctx, `${workspacePath}/sessions/${sessionId}/snapshot`)).item;
                await ctx.navigateHash(`${workspacePath}/session/${sessionId}`);
                break;
              }
              await setTimeout(1_500);
            }
            ctx.assert(snapshot, "The scheduled task completed and created a conversation.");
            await ctx.expectText(reply);
          },
          assert: async () => {
            const assistant = snapshot.messages.find(({ info }) => info.role === "assistant");
            ctx.assert(assistant?.info.providerID === providerId && assistant?.info.modelID === modelId,
              "The actual scheduled assistant response used the same provider and model as the composer.");
            ctx.assert(assistant.parts.some(part => part.type === "text" && part.text.includes(reply)), "The model returned the expected reply.");
            ctx.output("Actual scheduled model", `${assistant.info.providerID}/${assistant.info.modelID}`);
          },
          screenshot: { name: "scheduled-task-project-model", requireText: [title, reply] },
        });
      } finally {
        await ctx.navigateHash(originalHash);
        const item = await findTask();
        if (item) await request(ctx, `${workspacePath}/work-items/${item.id}?version=${item.version}`, "DELETE");
        if (item?.automationLastSessionId) {
          try {
            await request(ctx, `${workspacePath}/sessions/${item.automationLastSessionId}?deleteFiles=true`, "DELETE");
          } catch (error) {
            if (!/timed out|TimeoutError/i.test(String(error))) throw error;
            const { items } = await request(ctx, `${workspacePath}/sessions?limit=200`);
            if (items.some(session => session.id === item.automationLastSessionId)) throw error;
          }
        }
      }
    },
  }],
};
