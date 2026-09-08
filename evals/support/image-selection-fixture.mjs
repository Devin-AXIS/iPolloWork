// Isolated, no-charge integration fixture. Production plugin service and image
// actions run unchanged; only the external image provider is simulated.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { callOpenAiImageGenerationExtensionAction, openAiImageGenerationStatus } from "../../apps/server/dist/extensions/openai-image-generation.js";
import { PROVIDER_FETCH_SYMBOL } from "../../apps/server/dist/provider-fetch.js";
import { listSessionArtifacts, recordSessionArtifact } from "../../apps/server/dist/session-artifacts.js";
import createService from "../../examples/plugin-packages/image-studio/service/image-studio.mjs";

const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const sharp = require("sharp");
const root = await mkdtemp(join(tmpdir(), "ipollowork-selection-fixture-"));
const authorization = { read: async () => ({ OPENAI_API_KEY: "fixture", ARK_API_KEY: "fixture" }), openAiBrowserSession: async () => ({ accessToken: "fixture", accountId: "fixture" }) };
const config = { configPath: join(root, "server.json"), workspaces: [{ id: "selection-proof", path: root }] };
const context = { workspaceId: "selection-proof", sessionId: "selection-proof" };
const source = await sharp(Buffer.from('<svg width="800" height="500"><rect width="800" height="500" fill="#edcfa5"/><circle cx="400" cy="230" r="155" fill="#ee7837"/><path d="M0 420 L240 295 L510 430 L670 320 L800 390 V500 H0" fill="#34485d"/></svg>')).png().toBuffer();
await writeFile(join(root, "source.png"), source);
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
const modulePath = fileURLToPath(new URL("./image-selection-fixture-ui.jsx", import.meta.url)).replaceAll("\\", "/");
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
      res.end(JSON.stringify({ html, resource: manifest.resources.find(item => item.type === "ui"), catalog: await openAiImageGenerationStatus(authorization) }));
      return;
    }
    if (req.url === "/artifacts") { res.end(JSON.stringify(await listSessionArtifacts(config, context.workspaceId, context.sessionId))); return; }
    if (req.url === "/witness") {
      res.end(JSON.stringify({ requests, saved, actions, artifacts: (await listSessionArtifacts(config, context.workspaceId, context.sessionId)).items,
        files: ["source.png", ...(await readdir(join(root, "artifacts")).catch(() => [])).map(name => "artifacts/" + name)] }));
      return;
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
server.listen(5190, "127.0.0.1", () => console.log("Isolated image-selection fixture: http://127.0.0.1:5190"));
