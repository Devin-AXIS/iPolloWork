// Isolated, no-charge integration fixture. Production plugin service and image
// actions run unchanged; only the external image provider is simulated.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink, lstat, readlink, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { callOpenAiImageGenerationExtensionAction, openAiImageGenerationStatus } from "../../apps/server/dist/extensions/openai-image-generation.js";
import { PROVIDER_FETCH_SYMBOL } from "../../apps/server/dist/provider-fetch.js";
import { listSessionArtifacts, recordSessionArtifact } from "../../apps/server/dist/session-artifacts.js";
import createService from "../../examples/plugin-packages/image-studio/service/image-studio.mjs";
import { resolveWithinRoot } from "../../apps/server/dist/paths.js";

const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const sharp = require("sharp");
const root = await mkdtemp(join(tmpdir(), "ipollowork-selection-fixture-"));
const videoMode = process.argv.includes("--video");
const fixturePort = videoMode ? 5274 : 5190;
const authorization = { read: async () => ({ OPENAI_API_KEY: "fixture", ARK_API_KEY: "fixture" }), openAiBrowserSession: async () => ({ accessToken: "fixture", accountId: "fixture" }) };
const config = { configPath: join(root, "server.json"), workspaces: [{ id: "selection-proof", path: root }] };
const context = { workspaceId: "selection-proof", sessionId: "selection-proof" };
const source = await sharp(Buffer.from('<svg width="800" height="500"><rect width="800" height="500" fill="#edcfa5"/><circle cx="400" cy="230" r="155" fill="#ee7837"/><path d="M0 420 L240 295 L510 430 L670 320 L800 390 V500 H0" fill="#34485d"/></svg>')).png().toBuffer();
await writeFile(join(root, "source.png"), source);
let videoProjectPath = null;
if (videoMode) {
  videoProjectPath = join(root, "video", context.sessionId);
  await mkdir(join(videoProjectPath, "assets"), { recursive: true });
  await writeFile(join(videoProjectPath, "assets", "source.png"), source);
  await writeFile(join(videoProjectPath, "assets", "gsap.min.js"), await readFile(new URL("../../vendor/hyperframes/packages/studio/node_modules/gsap/dist/gsap.min.js", import.meta.url)));
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x183042:s=960x600:d=6:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(videoProjectPath, "assets", "background.mp4")]);
  await writeFile(join(videoProjectPath, "index.html"), `<!doctype html><html><head><style>html,body{margin:0;width:960px;height:600px;overflow:hidden} #root{position:relative;width:960px;height:600px;color:white;font-family:Arial} .clip{position:absolute;object-fit:cover} h1{margin:0;font-size:26px} </style></head><body><div id="root" data-composition-id="proof" data-width="960" data-height="600" data-start="0" data-duration="6">
    <video id="video-background" data-hf-id="video-background" class="clip" src="assets/background.mp4" data-start="0" data-duration="6" data-track-index="0" style="inset:0;width:960px;height:600px" muted></video>
    <h1 id="title" class="clip" data-start="0" data-duration="6" data-track-index="1" style="left:40px;top:30px">Video Studio · 图片联动验证</h1>
    <img id="hero-image" data-hf-id="hero-image" class="clip" src="assets/source.png" data-start="0" data-duration="6" data-track-index="2" style="left:40px;top:100px;width:540px;height:338px;border-radius:16px">
    <img id="other-image" data-hf-id="other-image" class="clip" src="assets/source.png" data-start="0" data-duration="6" data-track-index="3" style="left:630px;top:100px;width:260px;height:160px">
    <div id="image-background" data-hf-id="image-background" class="clip" data-start="0" data-duration="6" data-track-index="4" style="left:630px;top:300px;width:260px;height:160px;background-image:url('assets/source.png');background-size:cover"></div>
  </div><script src="assets/gsap.min.js"></script><script>const timeline=gsap.timeline({paused:true});timeline.to('#hero-image',{opacity:0.95,duration:6});window.__timelines=window.__timelines||{};window.__timelines['proof']=timeline;</script></body></html>`);
  const projectLink = fileURLToPath(new URL(`../../vendor/hyperframes/packages/studio/data/projects/${context.sessionId}`, import.meta.url));
  await mkdir(fileURLToPath(new URL("../../vendor/hyperframes/packages/studio/data/projects/", import.meta.url)), { recursive: true });
  const prior = await lstat(projectLink).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (prior) {
    if (!prior.isSymbolicLink()) throw new Error("Refusing to replace a non-fixture video project");
    const priorTarget = resolve(await readlink(projectLink));
    if (!/^ipollowork-selection-fixture-[^\\/]+[\\/]video[\\/]selection-proof$/.test(relative(tmpdir(), priorTarget))) throw new Error("Refusing to replace an unrelated project link");
    await unlink(projectLink); // only the verified test junction, never its files
  }
  await symlink(videoProjectPath, projectLink, "junction");
}
await recordSessionArtifact(config, config.workspaces[0], context.sessionId, "source.png");
const generated = await sharp({ create: { width: 800, height: 500, channels: 4, background: "#319cce" } }).png().toBuffer();
const requests = [];
const actions = [];
Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async (_url, init) => {
  requests.push(init.body instanceof FormData ? { nativeMask: Boolean(init.body.get("mask")), prompt: init.body.get("prompt") } : JSON.parse(init.body));
  return Response.json({ data: [{ b64_json: generated.toString("base64") }] });
});
const service = await createService({ workspace: { root }, plugin: { version: "0.1.13" }, host: { callAction: (reference, args) => callOpenAiImageGenerationExtensionAction(config, authorization, reference.split("/")[1], args, context) } });
const manifest = JSON.parse(await readFile(new URL("../../examples/plugin-packages/image-studio/ipollowork.plugin.json", import.meta.url), "utf8"));
const html = await readFile(new URL("../../examples/plugin-packages/image-studio/ui/image-studio.html", import.meta.url), "utf8");
const modulePath = fileURLToPath(new URL(videoMode ? "./video-image-fixture-ui.jsx" : "./image-selection-fixture-ui.jsx", import.meta.url)).replaceAll("\\", "/");
let saved = null;
const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5188");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.end(); return; }
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Image selection proof</title></head><body><div id="root"></div><script type="module">
        import RefreshRuntime from "http://127.0.0.1:5188/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import("http://127.0.0.1:5188/@fs/${modulePath}");
      </script></body></html>`);
      return;
    }
    if (req.url === "/setup") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ html, manifest, root, resource: manifest.resources.find(item => item.type === "ui"), catalog: await openAiImageGenerationStatus(authorization) }));
      return;
    }
    if (req.url === "/artifacts") { res.end(JSON.stringify(await listSessionArtifacts(config, context.workspaceId, context.sessionId))); return; }
    if (req.url === "/witness") {
      res.end(JSON.stringify({ requests, saved, actions, artifacts: (await listSessionArtifacts(config, context.workspaceId, context.sessionId)).items,
        ...(videoMode ? { videoHtml: await readFile(join(videoProjectPath, "index.html"), "utf8"), videoAssets: await readdir(join(videoProjectPath, "assets")) } : {}),
        files: ["source.png", ...(await readdir(join(root, "artifacts")).catch(() => [])).map(name => "artifacts/" + name)] }));
      return;
    }
    if (videoMode && req.url.startsWith("/raw?")) {
      const path = new URL(req.url, "http://localhost").searchParams.get("path");
      res.setHeader("Content-Type", "image/png");
      res.end(await readFile(await resolveWithinRoot(root, path))); return;
    }
    if (req.url !== "/action" || req.method !== "POST") { res.statusCode = 404; res.end(); return; }
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 70 * 1024 * 1024) throw new Error("Too large"); }
    const { action, args, direct } = JSON.parse(body);
    actions.push({ action, sourcePath: args.sourcePath, selectionBlend: args.selectionBlend, mode: args.mode });
    const result = direct
      ? (await callOpenAiImageGenerationExtensionAction(config, authorization, action, args, context)).result
      : await service.actions[action](args);
    if (action === "edit-image" || action === "image_edit" || action === "save-edit") {
      const bytes = await readFile(join(root, result.path));
      const output = await sharp(bytes).ensureAlpha().raw().toBuffer();
      const input = await sharp(source).ensureAlpha().raw().toBuffer();
      let changed = 0;
      for (let index = 0; index < output.length; index += 4) if (!output.subarray(index, index + 4).equals(input.subarray(index, index + 4))) changed++;
      saved = { path: result.path, changedPixels: changed, totalPixels: output.length / 4, originalPreserved: (await readFile(join(root, "source.png"))).equals(source) };
      result.dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, result }));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: error.message })); }
});
server.listen(fixturePort, "127.0.0.1", () => console.log(`Isolated image-selection fixture: http://127.0.0.1:${fixturePort}`));
