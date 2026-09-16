import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function workspaces(ctx) {
  return ctx.eval("(async () => { const response = await fetch(localStorage.getItem('ipollowork.server.urlOverride') + '/workspaces', { headers: { Authorization: 'Bearer ' + localStorage.getItem('ipollowork.server.token') } }); if (!response.ok) throw new Error('Workspace listing failed'); return (await response.json()).workspaces; })()", { awaitPromise: true });
}

function executionSteps(engineId, title) {
  let workspace;
  let sessionId;
  const token = engineId === "opencode" ? "OPENCODE_VERIFIED" : "DEEPSEEK_HARNESS_VERIFIED";
  const fileName = "engine-proof-" + Date.now() + "-" + engineId + ".txt";
  return [
    {
      name: title + " executes a real file task",
      run: async (ctx) => {
        await ctx.prove(title + " writes, reads and confirms a project file", {
          voiceover: title + " 实际创建项目文件并读取核对，任务完成后显示正确回复。",
          action: async () => {
            await ctx.client.send("Page.bringToFront");
            const items = await workspaces(ctx);
            const name = "发布检查 " + (engineId === "opencode" ? "OpenCode" : "DeepSeek");
            workspace = items.find((item) => item.name === name && item.engineId === engineId);
            if (!workspace) {
              ctx.assert(items.length > 0, "An onboarded profile is required.");
              await ctx.navigateHash("/workspace/" + items[0].id + "/session");
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-project-button]'))");
              await ctx.eval("document.querySelector('[data-testid=new-project-button]').click()");
              await ctx.fill("#create-project-name", name);
              await ctx.eval("document.querySelector('[data-engine-id=" + engineId + "] [role=radio]').click()");
              await ctx.clickText("新建项目", { selector: "[data-testid=create-project-dialog] button" });
              await ctx.waitFor("!document.querySelector('[data-testid=create-project-dialog][data-open]')", { timeoutMs: 45_000 });
              workspace = (await workspaces(ctx)).find((item) => item.name === name && item.engineId === engineId);
            }
            ctx.assert(Boolean(workspace), title + " project was not persisted.");
            await ctx.navigateHash("/workspace/" + workspace.id + "/session");
            await ctx.waitFor("window.__ipolloworkControl.listActions().some(a => a.id === 'session.create_task' && !a.disabled)");
            await ctx.control("session.create_task");
            await ctx.waitFor("window.__ipolloworkControl.listActions().some(a => a.id === 'composer.set_text')", { timeoutMs: 45_000 });
            await ctx.control("session.model_picker.open");
            await ctx.waitFor("document.querySelector('[role=dialog][data-open]')?.innerText.includes('OpenCode Zen')");
            if (!(await ctx.eval("document.querySelector('[role=dialog][data-open]')?.innerText.includes('Big Pickle')"))) {
              await ctx.clickText("OpenCode Zen", { selector: "[role=dialog][data-open] button" });
            }
            await ctx.clickText("Big Pickle", { selector: "[role=dialog][data-open] button" });
            await ctx.waitFor("!document.querySelector('[role=dialog][data-open]')");
            await ctx.control("composer.set_text", { text: "请在当前项目工作目录 " + workspace.path + " 内创建 " + fileName + "，内容只写 " + token + "，然后必须用工具读取它核对。最后只回复 " + token + "。" });
            await ctx.waitFor("window.__ipolloworkControl.listActions().some(a => a.id === 'composer.send' && !a.disabled)");
            await ctx.control("composer.send");
          },
          assert: async () => {
            await ctx.waitFor("[...document.querySelectorAll('[data-message-role=assistant]')].some(m => m.innerText.includes(" + JSON.stringify(token) + ")) && window.__ipolloworkControl.listActions().some(a => a.id === 'composer.stop' && a.disabled)", { timeoutMs: 120_000 });
            const transcript = await ctx.control("session.read_transcript", { count: 20 });
            ctx.assert(transcript.messages.some((message) => message.role === "assistant" && message.text.trim().endsWith(token)), "Completed assistant confirmation is missing.");
            ctx.assert(transcript.messages.some((message) => message.text.includes("[tool:read]")), "The engine must read back the created file.");
            ctx.assert((await readFile(join(workspace.path, fileName), "utf8")).trim() === token, "The real project file has the wrong contents.");
            sessionId = transcript.sessionId;
            ctx.log(title + " verified in " + sessionId);
          },
          screenshot: { name: engineId + "-real-tool-result", requireText: [token], rejectText: ["Something went wrong", "Provider is not configured"] },
        });
      },
    },
    {
      name: title + " restores task history",
      run: async (ctx) => {
        await ctx.prove(title + " preserves the completed task after reopening", {
          voiceover: "重新打开后，" + title + " 的任务记录和生成文件仍然完整保留。",
          action: async () => {
            await ctx.client.send("Page.bringToFront");
            await ctx.client.send("Page.reload");
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 45_000 });
            await ctx.waitFor("window.__ipolloworkControl.listActions().some(a => a.id === 'session.list_sessions')", { timeoutMs: 45_000 });
            await ctx.control("session.open", { sessionId });
          },
          assert: async () => {
            await ctx.waitFor("[...document.querySelectorAll('[data-message-role=assistant]')].some(m => m.innerText.includes(" + JSON.stringify(token) + "))", { timeoutMs: 45_000 });
            const sessions = await ctx.control("session.list_sessions");
            ctx.assert(sessions.some((session) => session.sessionId === sessionId), "The task is missing from saved history.");
            ctx.assert((await readFile(join(workspace.path, fileName), "utf8")).trim() === token, "The generated file did not survive reopening.");
          },
          screenshot: { name: engineId + "-restored-task", requireText: [token], rejectText: ["Something went wrong"] },
        });
      },
    },
  ];
}

export default {
  id: "data-label-engines",
  title: "Data labeling offers OpenCode and DeepSeek Harness",
  kind: "user-facing",
  steps: [
    {
      name: "Choose a project engine",
      run: async (ctx) => {
        await ctx.prove("New projects offer only OpenCode and DeepSeek Harness", {
          voiceover: "新建项目只显示 OpenCode 和 DeepSeek Harness，两种引擎都能正常选择。",
          action: async () => {
            await ctx.client.send("Page.bringToFront");
            await ctx.navigateHash("/workspace/" + (await workspaces(ctx))[0].id + "/session");
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
            await ctx.waitFor(`!document.querySelector('[data-testid=startup-logo-animation]')`, { timeoutMs: 30_000 });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid=new-project-button]'))`, { timeoutMs: 30_000 });
            await ctx.eval(`document.querySelector('[data-testid=new-project-button]').click()`);
            await ctx.waitFor(`document.querySelectorAll('[data-testid=project-engine-option]').length === 2`);
            await ctx.eval(`document.querySelector('[data-testid=project-engine-option][data-engine-id=deepseek-harness] [role=radio]').click()`);
            await ctx.waitFor(`document.querySelector('[data-testid=project-engine-option][data-engine-id=deepseek-harness]')?.dataset.state === 'selected'`);
            await ctx.eval(`document.querySelector('[data-testid=project-engine-option][data-engine-id=opencode] [role=radio]').click()`);
          },
          assert: async () => {
            const ids = await ctx.eval(`[...document.querySelectorAll('[data-testid=project-engine-option]')].map((card) => card.dataset.engineId)`);
            ctx.assert(JSON.stringify(ids) === JSON.stringify(["opencode", "deepseek-harness"]), "Only the supported engines should be selectable.");
            await ctx.waitFor(`document.querySelector('[data-testid=project-engine-option][data-engine-id=opencode]')?.dataset.state === 'selected'`);
          },
          screenshot: {
            name: "supported-project-engines",
            requireText: ["OpenCode", "DeepSeek Harness"],
            rejectText: ["Codex Harness", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Manage installed engines",
      run: async (ctx) => {
        await ctx.prove("Engine management retains OpenCode and DeepSeek without a Codex install option", {
          voiceover: "引擎管理保留 OpenCode 和 DeepSeek Harness，Codex 选项和安装入口已经移除。",
          action: async () => {
            await ctx.client.send("Page.bringToFront");
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await ctx.navigateHash("/settings/engines");
          },
          assert: async () => {
            await ctx.waitFor(`document.querySelectorAll('[data-testid=engine-package-row]').length === 2`, { timeoutMs: 30_000 });
            const ids = await ctx.eval(`[...document.querySelectorAll('[data-testid=engine-package-row]')].map((row) => row.dataset.engineId)`);
            ctx.assert(JSON.stringify(ids) === JSON.stringify(["opencode", "deepseek-harness"]), "The engine catalog must omit Codex.");
          },
          screenshot: {
            name: "supported-engine-packages",
            requireText: ["OpenCode", "DeepSeek Harness"],
            rejectText: ["Codex Harness", "Something went wrong"],
            hashIncludes: "/settings/engines",
          },
        });
      },
    },
    ...executionSteps("opencode", "OpenCode"),
    ...executionSteps("deepseek-harness", "DeepSeek Harness"),
  ],
};
