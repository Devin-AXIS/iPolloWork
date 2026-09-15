import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #f2eee4; }
      body { display: grid; place-items: center; font-family: Arial, sans-serif; color: #24221e; }
      #card { width: 1440px; padding: 120px; border: 2px solid #282722; background: #faf7ee; }
      #title { margin: 0 0 80px; font-size: 112px; letter-spacing: -5px; }
      #track { height: 28px; overflow: hidden; background: #d8d2c5; }
      #probe { width: 180px; height: 28px; background: #1fbac0; animation: travel 6s linear both; }
      #caption { margin-top: 40px; font-size: 54px; font-variant-numeric: tabular-nums; }
      @keyframes travel { from { transform: translateX(0); } to { transform: translateX(1260px); } }
    </style>
  </head>
  <body data-no-timeline>
    <main id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="1920" data-height="1080" data-fps="30">
      <section id="card" class="clip" data-hf-id="handoff-proof" data-start="0" data-duration="6" data-track-index="1">
        <h1 id="title">Runtime handoff</h1>
        <div id="track"><div id="probe"></div></div>
        <div id="caption">Continuous playback proof</div>
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
      throw new Error(`HyperFrames preview exited early (${child.exitCode}): ${output.join("").slice(-2000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return { child, port };
    } catch {
      // Preview is still starting.
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

const previewFrameExpression = `(() => {
  const hosts = [...document.querySelectorAll("hyperframes-player")];
  const host = hosts.find((candidate) => {
    const shell = candidate.parentElement?.parentElement;
    const frame = candidate.shadowRoot?.querySelector("iframe");
    return Boolean(shell && frame && getComputedStyle(shell).opacity !== "0" && frame.style.visibility !== "hidden");
  }) ?? hosts.at(-1);
  return host?.shadowRoot?.querySelector("iframe") ?? null;
})()`;

async function clickPlay(ctx) {
  const point = await ctx.eval(`(() => {
    const button = document.querySelector(
      '[data-testid="figma-player-controls"] button[aria-label="播放"]:not(:disabled), [data-testid="figma-player-controls"] button[aria-label="Play"]:not(:disabled)'
    );
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  ctx.assert(point, "The Video Studio Play button was unavailable.");
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

export default {
  id: "video-studio-playback-handoff",
  title: "Video Studio keeps playback and transport state synchronized",
  kind: "user-facing",
  preserveTheme: true,
  steps: [
    {
      name: "Generated video plays continuously with matching transport state",
      run: async (ctx) => {
        const projectDir = await mkdtemp(join(tmpdir(), "ipw-video-playback-handoff-proof-"));
        let preview = null;

        try {
          await writeFile(join(projectDir, "index.html"), PROJECT_SOURCE);
          await writeFile(join(projectDir, "hyperframes.json"), PROJECT_CONFIG);
          preview = await startPreview(projectDir);
          const studioUrl = `http://127.0.0.1:${preview.port}/#project/${encodeURIComponent(basename(projectDir))}?v=1&t=0&locale=zh&ipolloworkTheme=light`;
          await ctx.eval(`location.assign(${JSON.stringify(studioUrl)})`);
          await ctx.waitFor('document.title === "HyperFrames Studio"', {
            timeoutMs: 60_000,
            label: "isolated Video Studio",
          });
          await ctx.waitFor(`Boolean(${previewFrameExpression}?.contentWindow?.__player)`, {
            timeoutMs: 60_000,
            label: "preview runtime",
          });
          await ctx.waitFor(`Boolean(
            document.querySelector('[data-testid="figma-player-controls"] button[aria-label="播放"]:not(:disabled), [data-testid="figma-player-controls"] button[aria-label="Play"]:not(:disabled)')
          )`, { timeoutMs: 60_000, label: "enabled Video Studio transport" });
          // First load may perform one automatic hf-id persistence refresh.
          await new Promise((resolve) => setTimeout(resolve, 2_500));
          await ctx.waitFor(`Boolean(${previewFrameExpression}?.contentWindow?.__player)`, {
            timeoutMs: 60_000,
            label: "settled visible preview runtime",
          });

          await ctx.prove("The generated video advances while the button shows Pause", {
            claim: "A freshly initialized no-timeline composition advances beyond 1.5 seconds, and its transport simultaneously exposes the active Pause state.",
            voiceover: "初始化完成后，画面和时间轴持续向前，左下角按钮也正确显示正在播放。",
            action: async () => clickPlay(ctx),
            assert: async () => {
              await ctx.waitFor(`(() => {
                const player = ${previewFrameExpression}?.contentWindow?.__player;
                const pauseButton = document.querySelector(
                  '[data-testid="figma-player-controls"] button[aria-label="暂停"], [data-testid="figma-player-controls"] button[aria-label="Pause"]'
                );
                return Boolean(player && player.getTime() > 1.5 && player.isPlaying() && pauseButton);
              })()`, { timeoutMs: 10_000, label: "active playback beyond initialization" });
            },
            screenshot: {
              name: "initialized-video-keeps-playing",
              rejectText: ["Something went wrong", "Console errors in preview"],
            },
          });

          const firstTime = await ctx.eval(`${previewFrameExpression}.contentWindow.__player.getTime()`);
          await ctx.prove("Playback continues without another user action", {
            claim: "The same playback session advances by at least another 0.6 seconds without a second click or a hidden pause.",
            voiceover: "不需要再次点击，成片会自然连续播放，不再莫名停住。",
            assert: async () => {
              await ctx.waitFor(`(() => {
                const player = ${previewFrameExpression}?.contentWindow?.__player;
                return Boolean(player && player.getTime() > ${Number(firstTime) + 0.6} && player.isPlaying());
              })()`, { timeoutMs: 5_000, label: "continued uninterrupted playback" });
            },
            screenshot: {
              name: "playback-keeps-advancing",
              rejectText: ["Something went wrong", "Console errors in preview"],
            },
          });
        } finally {
          await stopPreview(preview?.child);
          await rm(projectDir, { recursive: true, force: true });
        }
      },
    },
  ],
};
