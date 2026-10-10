import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI_ENTRY = join(REPO_ROOT, "vendor/hyperframes/packages/cli/bin/hyperframes.mjs");

const PROJECT_SOURCE = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <style>
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #f2eee4; }
      #background { position: absolute; inset: 0; display: grid; place-items: center; font: 72px sans-serif; color: #24221e; }
    </style>
  </head>
  <body>
    <main data-composition-id="main" data-duration="20" data-width="1920" data-height="1080" data-fps="30">
      <section id="background" class="clip" data-hf-id="background" data-start="0" data-duration="20" data-track-index="0">
        Independent animation tracks
      </section>
    </main>
  </body>
</html>`;

const PROJECT_CONFIG = `${JSON.stringify(
  {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  },
  null,
  2,
)}\n`;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startPreview(projectDir) {
  const port = await availablePort();
  if (!port) throw new Error("Could not reserve a preview port.");
  const output = [];
  const child = spawn(
    process.execPath,
    [CLI_ENTRY, "preview", projectDir, "--port", String(port), "--no-open"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `HyperFrames preview exited early (${child.exitCode}): ${output.join("").slice(-2000)}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return { child, port };
    } catch {
      // The isolated preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for HyperFrames preview: ${output.join("").slice(-2000)}`);
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function openMapCatalog(ctx) {
  const componentsVisible = await ctx.eval(
    'Boolean(document.querySelector("button[aria-label=\\"组件\\"]"))',
  );
  if (!componentsVisible) {
    await ctx.trustedClick('button[aria-label="属性"]');
    await ctx.waitFor(
      'Boolean(document.querySelector("button[aria-label=\\"组件\\"]"))',
      { timeoutMs: 20_000, label: "open Studio inspector" },
    );
  }
  await ctx.eval(`document.querySelector('button[aria-label="组件"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })`);
  await ctx.trustedClick('button[aria-label="组件"]');
  await ctx.waitFor('Boolean(document.querySelector(\'select[aria-label="组件分类"]\'))', {
    timeoutMs: 20_000,
    label: "component category selector",
  });
  await ctx.eval(`(() => {
    const select = document.querySelector('select[aria-label="组件分类"]');
    select.value = 'maps';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await ctx.waitFor(
    'Boolean(document.querySelector(\'[data-block-name="route-map"] button[title*="当前播放位置"]\'))',
    { timeoutMs: 20_000, label: "Route Map insert action" },
  );
}

const routeMapInsertSelector =
  '[data-block-name="route-map"] button[title*="当前播放位置"]';

export default {
  id: "video-animation-independent-tracks",
  title: "Each inserted catalog animation gets an independent timeline track",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "iPolloWork control API",
    });
    ctx.appUrl = await ctx.eval("location.href");
    return null;
  },
  steps: [
    {
      name: "Repeated animation inserts stay on independent tracks",
      run: async (ctx) => {
        const projectDir = await mkdtemp(join(tmpdir(), "ipw-animation-track-proof-"));
        let preview = null;
        let flowError = null;

        try {
          await writeFile(join(projectDir, "index.html"), PROJECT_SOURCE);
          await writeFile(join(projectDir, "hyperframes.json"), PROJECT_CONFIG);
          preview = await startPreview(projectDir);
          const studioUrl = `http://127.0.0.1:${preview.port}/#project/${encodeURIComponent(basename(projectDir))}?v=1&t=2&locale=zh&ipolloworkTheme=light`;
          await ctx.eval(`location.assign(${JSON.stringify(studioUrl)})`);
          await ctx.waitFor('document.title === "HyperFrames Studio"', {
            timeoutMs: 60_000,
            label: "isolated Video Studio",
          });
          await ctx.waitFor('Boolean(document.querySelector(".hf-timeline-root"))', {
            timeoutMs: 60_000,
            label: "Video Studio timeline",
          });
          await openMapCatalog(ctx);

          await ctx.prove("Two animation inserts create two one-clip effect tracks", {
            claim: "Each Route Map insertion creates a new timeline row at the playhead, and neither row contains a second effect clip.",
            voiceover: "连续插入两次动画后，时间轴会新增两条独立特效轨道，每条轨道只保留自己的一个片段。",
            action: async () => {
              await ctx.trustedClick(routeMapInsertSelector);
              await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="block-params-panel"]\'))', {
                timeoutMs: 30_000,
                label: "first Route Map insertion",
              });
              await ctx.trustedClick('button[aria-label="关闭参数"]');
              await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(routeMapInsertSelector)}))`, {
                timeoutMs: 30_000,
                label: "Route Map catalog after first insertion",
              });
              await ctx.trustedClick(routeMapInsertSelector);
              await ctx.waitFor(`(() => {
                const rows = [...document.querySelectorAll('.hf-timeline-lane')]
                  .filter((row) => row.querySelector('[data-layer-dom-id^="route-map"]'));
                return rows.length === 2 && rows.every((row) => row.querySelectorAll('[data-clip="true"]').length === 1);
              })()`, { timeoutMs: 30_000, label: "two independent Route Map tracks" });
            },
            assert: async () => {
              const source = await readFile(join(projectDir, "index.html"), "utf8");
              const trackMatches = [...source.matchAll(
                /id="route-map(?:_2)?"[\s\S]*?data-track-index="(\d+)"/g,
              )];
              const tracks = trackMatches.map((match) => match[1]);
              ctx.assert(trackMatches.length === 2, `Expected two Route Map clips, received ${trackMatches.length}.`);
              ctx.assert(new Set(tracks).size === 2, `Inserted animations reused a track: ${JSON.stringify(tracks)}.`);

              const visibleRows = await ctx.eval(`[...document.querySelectorAll('.hf-timeline-lane')]
                .filter((row) => row.querySelector('[data-layer-dom-id^="route-map"]'))
                .map((row) => row.querySelectorAll('[data-clip="true"]').length)`);
              ctx.assert(
                visibleRows.length === 2 && visibleRows.every((count) => count === 1),
                `Timeline rows did not remain one clip each: ${JSON.stringify(visibleRows)}.`,
              );
            },
            screenshot: {
              name: "inserted-animations-use-independent-tracks",
              requireText: ["Route Map", "组件变量"],
              rejectText: ["Something went wrong", "Console errors in preview", "插入失败"],
            },
          });
        } catch (error) {
          flowError = error;
          throw error;
        } finally {
          if (ctx.appUrl) {
            await ctx.eval(`location.assign(${JSON.stringify(ctx.appUrl)})`).catch(() => undefined);
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 60_000,
              label: "iPolloWork after isolated Studio proof",
            }).catch((restoreError) => {
              if (!flowError) throw restoreError;
            });
          }
          await stopPreview(preview?.child);
          await rm(projectDir, { recursive: true, force: true });
        }
      },
    },
  ],
};
