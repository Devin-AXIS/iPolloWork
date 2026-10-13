import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { createJevActions } from "../../examples/plugin-packages/jev-decision-model/service/jev.mjs";

const voiceover = await loadVoiceoverParagraphs("video-live-generation");
const project = fileURLToPath(new URL("../../vendor/hyperframes/packages/studio/data/projects/live-proof/", import.meta.url));
let fixture;
const publications = [];
const jevCalls = [];
let jevEnabled = true;
function composition(count, complete, cases) {
  const scenes = Array.from({ length: count }, (_, index) => {
    const title = index === 0 ? "让创意开始流动" : index === 1 ? "从一个想法，到一个视频" : cases ? "使用案例 · 产品发布" : "更多产品功能";
    return `<section id="scene-${index + 1}" class="clip" data-start="${index * 4}" data-duration="4"><small>IPOLLOWORK / ${String(index + 1).padStart(2, "0")}</small><h1 class="headline">${title}</h1><p>${index > 1 && cases ? "你的新指令，正在改变后续内容。" : "每一个完成的场景，都立即成为可以播放的内容。"}</p><div class="bar"></div></section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Live video proof</title><script src="assets/gsap.min.js"></script><style>body{margin:0;background:#10181f;color:#f2f5f7;font-family:Arial,sans-serif}main{width:1280px;height:720px;position:relative;overflow:hidden}.clip{position:absolute;inset:0;box-sizing:border-box;padding:120px 90px;background:#10181f}small{color:#65c8ca;letter-spacing:5px;font-size:24px}h1{font-size:68px;line-height:1.4;margin:65px 0 32px}p{font-size:28px;color:#adc1ce}.bar{position:absolute;bottom:90px;left:90px;height:6px;width:1100px;background:#65c8ca}</style></head><body><main data-composition-id="live" data-width="1280" data-height="720" data-duration="${count * 4 || 1}" ${count ? `data-ipw-live-id="proof-run" data-ipw-live-status="${complete ? "complete" : "generating"}"` : ""}>${scenes.join("")}</main><script>const timeline=gsap.timeline({paused:true});${scenes.map((_, index) => `timeline.fromTo("#scene-${index + 1} .headline",{opacity:0,y:36},{opacity:1,y:0,duration:.7},${index * 4});timeline.fromTo("#scene-${index + 1} .bar",{scaleX:0,transformOrigin:"left"},{scaleX:1,duration:4,ease:"none"},${index * 4});`).join("")}timeline.to({}, {duration:.001},${count * 4 || 1}-.001);window.__timelines=window.__timelines||{};window.__timelines.live=timeline;</script></body></html>`;
}
export async function startFixture() {
  publications.length = 0;
  jevCalls.length = 0;
  jevEnabled = true;
  const jev = createJevActions({ getApiKey: async () => jevEnabled ? "isolated-proof-key" : null,
    fetcher: async (_url, init) => {
      const input = JSON.parse(init.body);
      const route = input.state.phase === "opening" ? "typography" : /节奏|慢|颜色|蓝色/.test(input.state.request) ? "parameters" : "structure";
      const answers = Object.fromEntries(Object.entries(input.questions).map(([id, question]) => {
        const selected = id === "route" ? route : "supplement";
        return [id, { type: "choice", choice: selected, confidence: .96,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0])) }];
      }));
      return Response.json({ model: "jev-proof-simulated", answers, usage: { input_tokens: 0, output_tokens: 0 } });
    },
  });
  await mkdir(join(project, "assets"), { recursive: true });
  await copyFile(fileURLToPath(new URL("../../vendor/hyperframes/packages/studio/node_modules/gsap/dist/gsap.min.js", import.meta.url)), join(project, "assets/gsap.min.js"));
  await writeFile(join(project, "index.html"), composition(0, false, false));
  fixture = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5178");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") { response.end(); return; }
    try {
      if (request.url === "/source" && request.method === "GET") { response.end(await readFile(join(project, "index.html"))); return; }
      if (request.url === "/evidence" && request.method === "GET") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ jevCalls, publications: publications.length })); return; }
      if (!["/publish", "/jev-mode", "/experimental/extensions/call"].includes(request.url) || request.method !== "POST") { response.writeHead(404).end(); return; }
      let body = "";
      for await (const chunk of request) { body += chunk; if (body.length > 16000) throw new Error("Fixture request too large"); }
      const input = JSON.parse(body);
      if (request.url === "/jev-mode") { jevEnabled = input.enabled === true; response.end(JSON.stringify({ ok: true })); return; }
      if (request.url === "/experimental/extensions/call") {
        if (input.extensionId !== "jev-decision-model" || !["status", "evaluate"].includes(input.action)
          || input.context?.workspaceId !== "proof" || input.context?.sessionId !== "live-proof") throw new Error("Unexpected decision call");
        const result = await jev.actions[input.action](input.args ?? {});
        jevCalls.push({ action: input.action, args: input.args ?? {}, result });
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ok: true, extensionId: input.extensionId, action: input.action, result })); return;
      }
      if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4 || input.count !== publications.length + 1) throw new Error("Invalid publication");
      const source = composition(input.count, input.complete === true, input.cases === true);
      await writeFile(join(project, ".publication.html"), source);
      await rename(join(project, ".publication.html"), join(project, "index.html"));
      publications.push({ ...input, source });
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ok: true }));
    } catch (error) { response.writeHead(400).end(String(error)); }
  });
  fixture.on("close", () => jev.dispose());
  await new Promise((resolve, reject) => { fixture.once("error", reject); fixture.listen(5397, "127.0.0.1", resolve); });
  fixture.unref();
  return fixture;
}
async function studio(ctx, expression) {
  const { frameTree } = await ctx.client.send("Page.getFrameTree");
  const frame = frameTree.childFrames?.find(child => child.frame.url.includes(":5197/"));
  if (!frame) throw new Error("Embedded Studio frame not found");
  const { executionContextId } = await ctx.client.send("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "live-proof-observer" });
  const result = await ctx.client.send("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
export default {
  id: "video-live-generation", title: "Play generated scenes continuously and guide the unfinished video (simulated model)", kind: "user-facing",
  cdpTarget: { urlIncludes: "video-live-proof.html" }, preserveTheme: true,
  steps: [
    { name: "First publication starts playback", run: async ctx => {
      await ctx.prove("The first complete scene plays while production is still active", { voiceover: voiceover[0],
        action: async () => {
          await startFixture();
          await ctx.client.send("Page.reload", { ignoreCache: true });
          await ctx.waitFor("document.querySelector('iframe')?.dataset.loaded === 'true'", { timeoutMs: 60000 });
          await ctx.trustedClick('[data-testid="publish-scene"]');
          await ctx.waitFor("window.liveVideoProof.preview?.generation?.readyDuration === 4 && window.liveVideoProof.preview.playhead > .2 && window.liveVideoProof.preview.playhead < 4", { timeoutMs: 30000 });
        }, assert: async () => {
          ctx.assert(await ctx.eval("window.liveVideoProof.preview.generation.status === 'generating' && window.liveVideoProof.publications === 1 && window.liveVideoProof.openingAdvice.includes('editable typography')"), "Jev selects a component-based opening and four seconds play without a complete film");
        }, screenshot: { name: "first-scene-playing", requireText: ["边生成边播放", "已生成 4 秒"] } });
    } },
    { name: "Buffer then resume at the previous boundary", run: async ctx => {
      await ctx.prove("The preview waits at four seconds and resumes the appended scene without restarting", { voiceover: voiceover[1],
        action: async () => {
          await ctx.waitFor("window.liveVideoProof.preview?.playhead === 4");
          ctx.assert(await studio(ctx, "document.body.innerText.includes('等待下一段生成')"), "Buffering is visible");
          await ctx.trustedClick('[data-testid="publish-scene"]');
          await ctx.waitFor("window.liveVideoProof.preview?.generation?.readyDuration === 8 && window.liveVideoProof.preview.playhead > 4 && window.liveVideoProof.preview.playhead < 8");
        }, assert: async () => {
          ctx.assert(await ctx.eval("window.liveVideoProof.preview.playhead >= 4"), "Playback continues from the published prefix");
        }, screenshot: { name: "second-scene-resumed", requireText: ["已生成 8 秒"] } });
    } },
    { name: "Guide the current native generation task", run: async ctx => {
      await ctx.prove("A typed direction reaches turn/steer with the frozen prefix and changes the next scene", { voiceover: voiceover[2],
        action: async () => {
          await ctx.fill('[contenteditable="true"]', "后面改成使用案例");
          await ctx.trustedClick('[aria-label="引导后续视频"]');
          await ctx.waitFor("window.liveVideoProof.requests.some(request => request.method === 'turn/steer')");
          ctx.assert(await ctx.eval("!document.querySelector('[data-testid=publish-scene]').disabled"), "Clicking guidance does not accidentally stop production after clearing the composer");
          await ctx.waitFor("window.liveVideoProof.preview?.playhead === 8");
          await ctx.trustedClick('[data-testid="publish-scene"]');
          await ctx.waitFor("window.liveVideoProof.preview?.generation?.readyDuration === 12 && window.liveVideoProof.preview.playhead > 8");
        }, assert: async () => {
          const request = await ctx.eval("window.liveVideoProof.requests.find(request => request.method === 'turn/steer')");
          ctx.assert(request.payload.expectedTurnId === "live-turn" && JSON.stringify(request).includes("published through 8.00s"), "Direction steers the same task and preserves its complete prefix");
          ctx.assert(JSON.stringify(request).includes("Jev production advice") && JSON.stringify(request).includes("Replan only the unpublished scenes"), "Jev selects a scoped scene replan before native steering");
          ctx.assert(publications[2].source.includes("使用案例 · 产品发布"), "The simulated generator applies the new direction");
          const firstScene = publications[0].source.match(/<section[\s\S]*?<\/section>/)[0];
          ctx.assert(publications[2].source.includes(firstScene), "Previously published scene remains identical");
        }, screenshot: { name: "guided-next-scene", requireText: ["已引导后续内容：后面改成使用案例", "已生成 12 秒"] } });
    } },
    { name: "Continue guiding when Jev is unavailable", run: async ctx => {
      await ctx.prove("An unconfigured Jev skips inference and the original direction still reaches the same task", { voiceover: voiceover[3],
        action: async () => {
          await ctx.trustedClick('[data-testid="jev-enabled"]');
          await ctx.waitFor("!document.querySelector('[data-testid=jev-enabled]').checked");
          await ctx.fill('[contenteditable="true"]', "结尾保留案例，再慢一点");
          await ctx.trustedClick('[aria-label="引导后续视频"]');
          await ctx.waitFor("window.liveVideoProof.direction === '结尾保留案例，再慢一点'");
        }, assert: async () => {
          const request = await ctx.eval("window.liveVideoProof.requests.filter(request => request.method === 'turn/steer').at(-1)");
          ctx.assert(request.payload.expectedTurnId === "live-turn" && JSON.stringify(request).includes("published through 12.00s") && !JSON.stringify(request).includes("Jev production advice"), "Fallback preserves raw direction and current published boundary");
          ctx.assert(jevCalls.filter(call => call.action === "evaluate").length === 2 && jevCalls.at(-1).result.configured === false, "Unconfigured Jev never calls inference");
        }, screenshot: { name: "jev-unavailable-steering", requireText: ["已引导后续内容：结尾保留案例，再慢一点", "已生成 12 秒"] } });
    } },
    { name: "Preserve manual pause through the final publication", run: async ctx => {
      await ctx.prove("Manual Pause survives appended content and completion; Play resumes normally", { voiceover: voiceover[4],
        action: async () => {
          await studio(ctx, "document.querySelector('.hf-studio-play-control').click()");
          ctx.assert(await studio(ctx, "document.querySelector('.hf-studio-play-control').getAttribute('aria-label') === '播放'"), "User pause is active");
          await ctx.trustedClick('[data-testid="finish-generation"]');
          await ctx.waitFor("window.liveVideoProof.preview?.generation?.status === 'complete' && window.liveVideoProof.preview.generation.readyDuration === 16 && window.liveVideoProof.publications === 4");
        }, assert: async () => {
          ctx.assert(await studio(ctx, "document.querySelector('.hf-studio-play-control').getAttribute('aria-label') === '播放'"), "Final source does not override Pause");
          await studio(ctx, "document.querySelector('.hf-studio-play-control').click()");
          await ctx.waitFor("window.liveVideoProof.preview?.playhead > 9 && window.liveVideoProof.preview.playhead < 16");
          ctx.assert(publications[3].complete && publications[3].source.includes('data-duration="16"'), "Final video is complete and remains playable");
          fixture.close();
        }, screenshot: { name: "complete-video-playing", requireText: ["已生成 16 秒"] } });
    } },
  ],
};
