// Isolated services + the production host bridge. No model or platform writes.
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../../apps/app/node_modules/vite/dist/node/index.js";
import react from "../../apps/app/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "../../apps/app/node_modules/@tailwindcss/vite/dist/index.mjs";
import { buildPluginRuntime } from "../../packages/ui/build-plugin-runtime.mjs";
import { startServer as channelsServer } from "../../examples/plugin-packages/wechat-channels-ops/service/server.mjs";
import { startServer as douyinServer } from "../../examples/plugin-packages/douyin-ops/service/server.mjs";
const port = Number(process.env.SOCIAL_OPS_PROOF_PORT || 5198),
  proofOrigin = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(resolve(tmpdir(), "social-ops-proof-"));
const hosted = new Map();
for (const [id, start] of [
  ["wechat-channels-ops", channelsServer],
  ["douyin-ops", douyinServer],
]) {
  const service = await start({
    dataDir: resolve(directory, id),
    workspaceRoot: directory,
    token: `fixture-${id}`,
    executorToken: "fixture-executor",
  });
  const ops = service.operations;
  let account;
  if (id === "wechat-channels-ops") {
    account = ops.saveAccount({
      name: "演示视频号",
      positioning: "生活方式",
      audience: "内容创作者",
      tone: "自然简洁",
    }).account;
    ops.store.put("account", {
      ...account,
      status: "verified",
      channelId: "fixture-channel",
      verifiedAt: new Date().toISOString(),
      verifiedSessionId: "fixture-session",
    });
    ops.saveAccount({ name: "第二个视频号" });
    const videoId = randomUUID();
    ops.store.put("video", {
      id: videoId,
      accountId: account.id,
      remoteId: "fixture-video",
      title: "把日常拍成故事",
      status: "已发布",
      url: "https://channels.weixin.qq.com/platform/post/list",
      publishedAt: new Date().toISOString(),
      metrics: { plays: 1280, likes: 86, comments: 12, shares: null },
    });
    ops.store.put("comment", {
      id: randomUUID(),
      accountId: account.id,
      videoId,
      remoteId: "fixture-comment",
      author: "小林",
      body: "这段拍得很有生活感！",
      createdAt: new Date().toISOString(),
    });
    ops.saveDraft({
      accountId: account.id,
      title: "周末的慢生活",
      description: "把镜头留给生活里的小事。",
      topics: "#生活记录",
    });
  } else {
    account = (await ops.action("connect-browser", {})).account;
    ops.store.put("account", {
      ...account,
      nickname: "演示抖音号",
      webIdentity: "fixture_douyin",
    });
    ops.store.put("account", {
      ...account,
      id: randomUUID(),
      browserProfileId: randomUUID(),
      nickname: "第二个抖音号",
      webIdentity: "fixture_second",
    });
    ops.saveDraft({
      accountId: account.id,
      title: "周末的慢生活",
      text: "把镜头留给生活里的小事。",
    });
  }
  hosted.set(id, { service, url: `${service.origin}/#token=fixture-${id}` });
}
const hostRuntime = await buildPluginRuntime("host");
const bundled = await buildPluginRuntime("bundled");
const dev = await channelsServer({
  dataDir: resolve(directory, "bundled"),
  workspaceRoot: directory,
  token: "fixture-bundled",
  uiRuntime: bundled.script,
});
const videoPath = resolve(directory, "sample.mp4");
await writeFile(
  videoPath,
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom"),
    Buffer.alloc(96),
  ]),
);
const fixture = {
  name: "social-ops-proof",
  enforce: "pre",
  resolveId(id) {
    if (id === "virtual:ipollowork-plugin-ui-runtime")
      return "\0social-ops-runtime";
  },
  load(id) {
    if (id === "\0social-ops-runtime")
      return `export default ${JSON.stringify(hostRuntime.script)}`;
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://127.0.0.1");
      // Keep CUA actions in one browser target. Proxy only loopback transport;
      // the production frame, AppBridge, service actions and component runtime remain real.
      const route =
        /^\/social-frame\/(wechat-channels-ops|douyin-ops)(\/.*)$/.exec(
          url.pathname,
        );
      if (route) {
        const [, id, path] = route,
          upstream = hosted.get(id).service.origin;
        const headers = { ...req.headers, host: new URL(upstream).host };
        delete headers.origin;
        delete headers.connection;
        delete headers["content-length"];
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await fetch(upstream + path + url.search, {
          method: req.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        for (const [key, value] of response.headers)
          if (
            ![
              "content-length",
              "content-encoding",
              "transfer-encoding",
            ].includes(key)
          )
            res.setHeader(key, value);
        res.statusCode = response.status;
        let body = Buffer.from(await response.arrayBuffer());
        if (path === "/app.js" || path === "/app.css")
          body = await readFile(
            resolve("examples/plugin-packages", id, "ui", path.slice(1)),
          );
        if (path === "/")
          body = Buffer.from(
            body
              .toString()
              .replaceAll(
                'href="/app.css"',
                `href="/social-frame/${id}/app.css"`,
              )
              .replaceAll('src="/app.js"', `src="/social-frame/${id}/app.js"`),
          );
        if (path === "/app.js")
          body = Buffer.from(
            body
              .toString()
              .replace(
                "async function request(path, options = {}) {",
                `async function request(path, options = {}) { path = '/social-frame/${id}' + path;`,
              ),
          );
        if (path === "/api/state") {
          const state = JSON.parse(body);
          state.assets = state.assets.map((asset) => ({
            ...asset,
            ...(asset.previewUrl
              ? { previewUrl: "/social-frame/" + id + asset.previewUrl }
              : {}),
          }));
          body = Buffer.from(JSON.stringify(state));
        }
        return res.end(body);
      }
      if (url.pathname === "/social-ops-proof") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(
          `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/evals/support/social-ops-fixture.jsx"></script></body></html>`,
        );
      }
      if (url.pathname === "/social-ops-fixture-state") {
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify({
            services: Object.fromEntries(
              [...hosted].map(([id]) => [
                id,
                `${proofOrigin}/social-frame/${id}/#token=fixture-${id}`,
              ]),
            ),
            bundled: `${dev.origin}/#token=fixture-bundled`,
            videoPath,
          }),
        );
      }
      if (
        url.pathname === "/social-ops-fixture-complete" &&
        req.method === "POST"
      ) {
        const id = url.searchParams.get("plugin"),
          { service } = hosted.get(id),
          ops = service.operations;
        const job = ops.store
          .list("job")
          .find(
            (item) =>
              item.status === "pending" &&
              [
                "list-videos",
                "list-comments",
                "search-videos",
                "video-data",
              ].includes(item.browserAction),
          );
        if (id === "douyin-ops" && job) {
          const list =
            job.browserAction === "list-comments"
              ? [
                  {
                    comment_id: "fixture-comment",
                    title: "这段拍得很有生活感！",
                    nickname: "小林",
                    content: "这段拍得很有生活感！",
                  },
                ]
              : [
                  {
                    item_id: "12345",
                    title: "把日常拍成故事",
                    link: "https://www.douyin.com/video/12345",
                    statistics: {
                      play_count: 1280,
                      digg_count: 86,
                      comment_count: 12,
                      share_count: 4,
                    },
                  },
                ];
          const account = ops.account(job.accountId),
            profileId = "douyin-ops:" + account.browserProfileId;
          const claimed = await ops.action("claim-browser-job", {
            jobId: job.id,
            actualProfileId: profileId,
            actualAccount: account.webIdentity,
          });
          if (!claimed.queued)
            await ops.action("finish-browser-job", {
              jobId: job.id,
              executionToken: claimed.executionToken,
              actualProfileId: profileId,
              actualAccount: account.webIdentity,
              outcome: "succeeded",
              evidence: "隔离验收数据，未访问平台。",
              items: list,
            });
        }
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ job }));
      }
      if (url.pathname === "/social-ops-fixture-assertions") {
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify(
            Object.fromEntries(
              [...hosted].map(([id, { service }]) => [
                id,
                service.operations.state(),
              ]),
            ),
          ),
        );
      }
      next();
    });
  },
};
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: {
    alias: {
      "@": resolve("apps/app/src"),
      react: resolve("apps/app/node_modules/react"),
      "react-dom": resolve("apps/app/node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  plugins: [fixture, tailwindcss(), react()],
  server: { host: "127.0.0.1", port, strictPort: true, open: false },
});
await vite.listen();
console.log(
  JSON.stringify({
    url: `${proofOrigin}/social-ops-proof`,
    directory,
    videoPath,
    bundled: `${dev.origin}/#token=fixture-bundled`,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await vite.close();
    await dev.close();
    for (const { service } of hosted.values()) await service.close();
    process.exit(0);
  });
