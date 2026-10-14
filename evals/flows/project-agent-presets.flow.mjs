import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("project-agent-presets");
const ids = ["content-operations", "data-analysis", "presentation-assistant", "product-planning", "knowledge-organizer"];
const names = ["内容运营", "数据分析", "PPT 助手", "产品策划", "资料整理"];
const editedName = "内容运营 · 项目专用";
const marker = "本次只交付一周选题和内容日历，保留来源。";
const wid = process.env.IPOLLOWORK_AGENT_PRESETS_WORKSPACE_ID;
const sid = process.env.IPOLLOWORK_AGENT_PRESETS_SESSION_ID;

async function request(ctx, path, method = "GET", body) {
  return ctx.eval(`(async () => {
    const connection = window.__agentPresetProof?.connection ?? await (await import('/src/app/lib/desktop.ts')).ipolloworkServerInfo();
    const response = await fetch(connection.baseUrl + ${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, ${body === undefined ? "" : `body: JSON.stringify(${JSON.stringify(body)}),`} headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + (connection.ownerToken || connection.clientToken), 'x-ipollowork-host-token': connection.hostToken } });
    if (!response.ok) throw new Error('Proof API read failed: ' + response.status);
    return response.json();
  })()`, { awaitPromise: true });
}

async function click(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: selector });
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

async function confirmAdd(ctx) {
  await ctx.waitFor("[...document.querySelectorAll('[data-slot=popover-content][data-open] button')].some(button => button.textContent.trim() === '添加' && !button.disabled)", { label: "enabled add confirmation in the open picker" });
  await ctx.eval("[...document.querySelectorAll('[data-slot=popover-content][data-open] button')].find(button => button.textContent.trim() === '添加' && !button.disabled).click()");
  await ctx.waitFor("!document.querySelector('[data-slot=popover-content][data-open]')", { label: "picker confirmation has closed" });
}

export default {
  id: "project-agent-presets",
  title: "Add, edit and reopen conversation agent presets",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_AGENT_PRESETS_WORKSPACE_ID", "IPOLLOWORK_AGENT_PRESETS_SESSION_ID"],
  steps: [{
    name: "Find and add the five new presets",
    run: async (ctx) => {
      await ctx.prove("The overview offers five new presets through the existing agent area", {
        voiceover: vo[0],
        action: async () => {
          if (process.env.IPOLLOWORK_AGENT_PRESETS_PROOF_URL) {
            await ctx.client.send("Page.navigate", { url: process.env.IPOLLOWORK_AGENT_PRESETS_PROOF_URL });
            await ctx.waitFor("Boolean(window.__agentPresetProof)", { label: "isolated view fixture" });
            const current = (await request(ctx, `/workspace/${wid}/sessions/${sid}/workflow`)).item;
            ctx.assert(wid === "preset-proof" && sid === "preset-proof-session" && current.status !== "running", "Reset is limited to the idle synthetic fixture");
            await request(ctx, `/workspace/${wid}/sessions/${sid}/workflow`, "PUT", { expectedVersion: current.version, runtime: current.execution.runtime, templateId: "general", source: "auto" });
            await ctx.client.send("Page.reload");
            await ctx.waitFor("!document.querySelector('[data-testid=project-agent-tab]') && Boolean(document.querySelector('[data-testid=project-primary-agent]'))", { label: "clean synthetic overview rendered" });
          }
          else {
            await ctx.navigateHash(`/workspace/${wid}/session/${sid}`);
            await click(ctx, "[data-testid=session-header-project-overview]");
          }
          await click(ctx, "[data-testid=project-agent-add-preset]");
          await ctx.waitFor(`${JSON.stringify(names)}.every(name => document.body.innerText.includes(name))`, { label: "all five role options" });
        },
        assert: async () => {
          const library = await request(ctx, `/workspace/${wid}/work-templates`);
          ctx.assert(ids.every(id => library.agentPresets.some(preset => preset.id === id)), "All five real server presets are available");
          ctx.assert(library.agentPresets.some(preset => preset.id === "video-plan"), "Existing professional roles remain available");
          ctx.assert(await ctx.eval("!document.querySelector('[data-testid=work-template-picker]')"), "No work-method selector is required");
        },
        screenshot: { name: "preset-library", requireText: names },
      });
      for (const name of names) await ctx.clickText(name, { selector: "[data-slot=popover-content][data-open] [role=option]" });
      await confirmAdd(ctx);
      await ctx.waitFor(`${JSON.stringify(ids)}.every(id => document.querySelector('[data-testid=project-agent-tab][data-agent-id="' + id + '"]'))`, { label: "saved role rows" });
    },
  }, {
    name: "Edit the added role and bind a real Skill",
    run: async (ctx) => {
      await ctx.prove("An added role can edit its instructions and bind an installed Skill", {
        voiceover: vo[1],
        action: async () => {
          await click(ctx, '[data-testid=project-agent-tab][data-agent-id=content-operations]');
          await click(ctx, '[data-testid=project-agent-edit]');
          await ctx.fill("#project-agent-name", editedName);
          await ctx.fill("#project-agent-prompt", marker);
          await click(ctx, '[data-testid=project-agent-add-skill]');
          await ctx.clickText("PPT 演示文稿", { selector: "[data-slot=popover-content][data-open] [role=option]" });
          await confirmAdd(ctx);
          await ctx.waitFor("[...document.querySelectorAll('[data-testid=project-agent-skill-row]')].some(row => row.textContent.includes('PPT 演示文稿')) && document.querySelector('[data-testid=project-agent-plugin-row]')?.textContent.includes('iPollo Design')", { label: "selected Skill and its owning plugin have rendered" });
          await click(ctx, '[data-testid=project-agent-save]');
          await ctx.waitFor(`!document.querySelector('[data-testid=project-agent-inspector]') && document.body.innerText.includes(${JSON.stringify(editedName)})`, { label: "edited role saved" });
          await click(ctx, '[data-testid=project-agent-tab][data-agent-id=content-operations]');
          await ctx.eval("const content = document.querySelector('[data-testid=project-agent-inspector-content]'); content.scrollTop = content.scrollHeight;");
        },
        assert: async () => {
          const work = (await request(ctx, `/workspace/${wid}/sessions/${sid}/workflow`)).item;
          const role = work.execution.workflow.config.agents.find(agent => agent.id === "content-operations");
          ctx.assert(role.name === editedName && role.prompt === marker, "The edited name and instructions are persisted by the real API");
          ctx.assert(role.skillIds.includes("design-agent:ipollowork-presentations") && role.pluginIds.includes("design-agent"), "Binding a Skill retains its owning plugin");
        },
        screenshot: { name: "edited-role", requireText: [editedName, marker, "PPT 演示文稿"] },
      });
    },
  }, {
    name: "Reopen and verify isolation",
    run: async (ctx) => {
      await ctx.prove("Role edits survive reload without modifying the reusable preset library", {
        voiceover: vo[2],
        action: async () => {
          await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 900, deviceScaleFactor: 1, mobile: false });
          const beforeReload = await ctx.eval("performance.timeOrigin");
          await ctx.client.send("Page.reload");
          await ctx.waitFor(`performance.timeOrigin !== ${beforeReload}`, { label: "a new document has loaded" });
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid=project-agent-tab][data-agent-id=content-operations]')) && document.body.innerText.includes(${JSON.stringify(editedName)})`, { label: "persisted roles after reopening" });
          await ctx.eval("document.querySelector('[data-testid=project-agent-list]').scrollIntoView({block:'center'})");
        },
        assert: async () => {
          const work = (await request(ctx, `/workspace/${wid}/sessions/${sid}/workflow`)).item;
          ctx.assert(work.execution.workflow.source === "custom" && ids.every(id => work.execution.workflow.config.agents.some(agent => agent.id === id)), "The custom team retains all five roles");
          const library = await request(ctx, `/workspace/${wid}/work-templates`);
          ctx.assert(library.agentPresets.find(preset => preset.id === "content-operations").name === names[0], "The original preset has not been overwritten");
          ctx.assert(await ctx.eval("document.documentElement.scrollWidth <= innerWidth"), "The 520px overview has no horizontal overflow");
        },
        screenshot: { name: "reopened-narrow-overview", requireText: [editedName, "PPT 助手", "资料整理"] },
      });
      await ctx.client.send("Emulation.clearDeviceMetricsOverride");
    },
  }],
};
