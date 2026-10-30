export default {
  id: "project-agent-defaults",
  title: "Save project preset agents and inherit them in new conversations",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "project-agent-presets-proof.html" },
  steps: [{ name: "Project defaults persist and new conversations inherit", run: async (ctx) => {
    await ctx.prove("Project overview saves presets without a conversation, survives reload and passes them only to new conversations", {
      voiceover: "在项目概览添加预设，刷新后仍然保留；新对话继承项目智能体，已有对话保持原配置。",
      action: async () => {
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-agent-defaults-hint]'))");
        await ctx.eval("document.querySelector('[data-testid=project-agent-add-preset]').click()");
        await ctx.clickText("内容运营", { selector: "[data-slot=popover-content][data-open] [role=option]" });
        await ctx.clickText("添加", { selector: "[data-slot=popover-content][data-open] button" });
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-agent-tab][data-agent-id=content-operations]'))");
        await ctx.client.send("Page.reload");
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-agent-tab][data-agent-id=content-operations]'))");
        await ctx.clickText("已有对话", { selector: "nav button" });
        await ctx.waitFor("!document.querySelector('[data-testid=project-agent-defaults-hint]') && Boolean(document.querySelector('[data-testid=project-primary-agent]'))");
        ctx.assert(await ctx.eval("!document.querySelector('[data-testid=project-agent-tab][data-agent-id=content-operations]')"), "Existing conversation does not acquire the preset");
        await ctx.clickText("新建验证对话", { selector: "nav button" });
        await ctx.waitFor("document.querySelector('[data-testid=proof-scope]')?.textContent === '新对话' && Boolean(document.querySelector('[data-testid=project-agent-tab][data-agent-id=content-operations]'))");
      },
      assert: async () => {
        const witness = await ctx.eval(`(async () => {
          const read = async path => (await fetch('http://127.0.0.1:5297/workspace/preset-proof/' + path, { headers: { authorization: 'Bearer isolated-preset-proof' } })).json();
          return { project: await read('config'), old: await read('sessions/before-defaults/workflow'), fresh: await read('sessions/after-defaults/workflow') };
        })()`, { awaitPromise: true });
        const hasPreset = config => config.agents.some(agent => agent.id === "content-operations");
        ctx.assert(hasPreset(witness.project.ipollowork.project), "Real server stores the project preset");
        ctx.assert(!hasPreset(witness.old.item.execution.workflow.config), "Old conversation snapshot is unchanged");
        ctx.assert(hasPreset(witness.fresh.item.execution.workflow.config), "New conversation snapshot inherits the preset");
        await ctx.expectNoText("任务保存失败");
      },
      screenshot: { name: "inherited-project-presets", requireText: ["新对话", "内容运营"] },
    });
  } }],
};
