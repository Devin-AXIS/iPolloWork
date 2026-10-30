import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { request, click, open, send, allowFixtureWorkflowAccess } from "./native-agent-results.flow.mjs";

const vo = await loadVoiceoverParagraphs("native-agent-handoff");
const wid = process.env.IPOLLOWORK_OPENCODE_RESULTS_WORKSPACE_ID;
const fixtures = new Map();
const prompt = "请用当前视频制作模板，为 iPolloWork 制作一个6秒、16:9的宣传短片：从一个想法开始，整理出清晰的任务，迈出下一步。用同一组原创可编辑图形连续演变，保持现代简约。不要外部图片或视频，不要旁白、字幕、音乐和音效。完成制作和必要检查后，把可编辑源文件和可播放的MP4一并给我。";

async function start(ctx, engineId) {
  const reuse = engineId === "codex-harness" ? process.env.IPOLLOWORK_CODEX_DELIVERY_SESSION_ID : process.env.IPOLLOWORK_OPENCODE_DELIVERY_SESSION_ID;
  const created = reuse ? null : await request(ctx, `/workspace/${wid}/sessions`, "POST", {
    title: `${engineId} 原生完整交付 ${Date.now().toString(36)}`, engineId,
    model: { providerID: "openai", modelID: "gpt-6.1-sol" },
  });
  const fixture = { wid, sid: reuse ?? created.item.id, engineId, reused: Boolean(reuse) };
  fixtures.set(engineId, fixture);
  ctx.log(`Native delivery root: ${JSON.stringify(fixture)}`);
  if (!reuse) {
    const work = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/workflow`)).item;
    await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/workflow`, "PUT", {
      expectedVersion: work.version, runtime: work.execution.runtime, templateId: "video", source: "manual",
    });
    await open(ctx, fixture);
    await send(ctx, fixture, prompt);
  }
}

async function finish(ctx, engineId, narration) {
  const fixture = fixtures.get(engineId);
  let entry, mp4;
  await ctx.prove(`${engineId} returns real editable source and a completed MP4 through native execution`, {
    voiceover: narration,
    action: async () => {
      await open(ctx, fixture);
      const deadline = Date.now() + 18 * 60_000;
      let settled = false;
      while (Date.now() < deadline) {
        await allowFixtureWorkflowAccess(ctx, fixtures.get("codex-harness"), "codex-harness");
        const snapshot = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/snapshot`)).item;
        const work = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/workflow`)).item;
        if (work.status === "failed") throw Error(`${engineId}: ${work.lastError}`);
        if (snapshot.status.type === "idle" && work.status === "review") { settled = true; break; }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      ctx.assert(settled, "Native execution returned within the deadline");
      const template = await request(ctx, `/workspace/${wid}/template-sessions/${fixture.sid}-artifact-video`);
      entry = template.state.entry;
      const catalog = await request(ctx, `/workspace/${wid}/artifacts`);
      const artifacts = catalog.items ?? catalog.artifacts ?? [];
      const snapshot = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/snapshot`)).item;
      const returned = snapshot.messages.filter(m => m.info.role === "assistant").flatMap(m => m.parts ?? []).filter(p => p.type === "text").map(p => p.text).join("\n");
      mp4 = artifacts.filter(item => item.path?.startsWith(entry.replace(/index.html$/, "")) && item.path.endsWith(".mp4") && returned.includes(item.path))
        .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.path;
      ctx.assert(mp4, "A real MP4 exists in this conversation's project");
      await open(ctx, fixture);
      for (const path of [entry, mp4]) {
        await ctx.waitFor(`Boolean(document.querySelector('[data-chat-transcript] [data-artifact-path="${path}"]'))`, { label: `main result card: ${path}`, timeoutMs: 30000 });
      }
      await ctx.eval(`document.querySelector('[data-chat-transcript] [data-artifact-path="${mp4}"]').scrollIntoView({block:'center'})`);
    },
    assert: async () => {
      const snapshot = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/snapshot`)).item;
      const work = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/workflow`)).item;
      ctx.assert(work.execution.workflow.templateVersion === 5, "Current example template is applied");
      const userTexts = snapshot.messages.filter(m => m.info.role === "user").flatMap(m => m.parts.filter(p => p.type === "text").map(p => p.text));
      ctx.assert(userTexts.length === 1 && userTexts[0] === prompt, "No application repair or continuation prompt was injected");
      const output = snapshot.messages.flatMap(m => m.parts ?? []).filter(p => p.type === "text" && p.text).map(p => p.text).join("\n");
      ctx.assert(output.includes(mp4), "The native main Agent returns the actual MP4 path");
      const parts = snapshot.messages.flatMap(m => m.parts ?? []);
      ctx.assert(parts.some(p => p.type === "tool" && JSON.stringify(p.state?.input).includes("video_render_start")), "The native main Agent starts export itself");
      ctx.assert(parts.some(p => p.type === "tool" && JSON.stringify(p.state?.input).includes("video_render_status") && JSON.stringify(p.state?.output).includes("complete") && JSON.stringify(p.state?.output).includes(mp4)), "Native execution collects the completed render receipt");
      const source = (await request(ctx, `/workspace/${wid}/files/content?path=${encodeURIComponent(entry)}`)).content;
      ctx.assert(source.includes("data-composition-id"), "The editable composition is saved");
      ctx.log(`Delivered ${engineId}: ${entry}, ${mp4}`);
      await click(ctx, `[data-chat-transcript] [data-artifact-path="${mp4}"]`);
    },
    screenshot: { name: `${engineId}-native-mp4-returned`, requireText: ["MP4"], hashIncludes: fixture.sid },
  });
}

export default {
  id: "native-agent-handoff", title: "Native engines create and deliver video without a client workflow controller", kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_OPENCODE_RESULTS_WORKSPACE_ID"],
  precondition: async ctx => { await start(ctx, "codex-harness"); await start(ctx, "opencode"); },
  steps: [
    { name: "Codex completes and returns the video", run: ctx => finish(ctx, "codex-harness", vo[0]) },
    { name: "OpenCode completes and returns the video", run: ctx => finish(ctx, "opencode", vo[1]) },
  ],
};
