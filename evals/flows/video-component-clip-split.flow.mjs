import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #eef1f5; }
    </style>
  </head>
  <body>
    <main data-composition-id="main" data-duration="14" data-width="1920" data-height="1080" data-fps="30">
      <div
        id="feature-grid"
        data-hf-id="hf-feature-grid"
        data-composition-id="feature-grid"
        data-composition-src="compositions/components/feature-grid.html"
        data-start="2"
        data-duration="10"
        data-track-index="1"
        data-width="1920"
        data-height="1080"
      ></div>
    </main>
  </body>
</html>`;

const COMPONENT_SOURCE = `<template id="feature-grid-template">
  <style>
    #feature-grid { width: 1920px; height: 1080px; display: grid; place-items: center; background: #f5efe4; color: #171816; font: 700 96px Arial, sans-serif; }
  </style>
  <section id="feature-grid" data-composition-id="feature-grid" data-duration="10" data-width="1920" data-height="1080">
    Feature Grid
  </section>
</template>`;

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

async function waitForPersistedComponentInstances(projectDir, expectedCount) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const source = await readFile(join(projectDir, "index.html"), "utf8");
    const count =
      source.match(/data-composition-src="compositions\/components\/feature-grid\.html"/g)
        ?.length ?? 0;
    if (count === expectedCount) return source;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expectedCount} persisted Feature Grid clips.`);
}

const componentClipSelector = '[data-clip="true"][data-el-id*="feature-grid"]';
const enabledSplitButtonSelector =
  'button[aria-label="当前片段时刻分割"]:not(:disabled), button[aria-label="Split clip at playhead"]:not(:disabled)';

export default {
  id: "video-component-clip-split",
  title: "Inserted component clips can be split at the playhead",
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
      name: "Split an inserted component clip",
      run: async (ctx) => {
        const projectDir = await mkdtemp(join(tmpdir(), "ipw-component-split-proof-"));
        let preview = null;
        let flowError = null;

        try {
          await mkdir(join(projectDir, "compositions", "components"), { recursive: true });
          await writeFile(join(projectDir, "index.html"), PROJECT_SOURCE);
          await writeFile(
            join(projectDir, "compositions", "components", "feature-grid.html"),
            COMPONENT_SOURCE,
          );
          await writeFile(join(projectDir, "hyperframes.json"), PROJECT_CONFIG);
          preview = await startPreview(projectDir);
          const studioUrl = `http://127.0.0.1:${preview.port}/#project/${encodeURIComponent(basename(projectDir))}?v=1&t=7&locale=zh&ipolloworkTheme=light`;
          await ctx.eval(`location.assign(${JSON.stringify(studioUrl)})`);
          await ctx.waitFor('document.title === "HyperFrames Studio"', {
            timeoutMs: 60_000,
            label: "isolated Video Studio",
          });
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(componentClipSelector)}))`, {
            timeoutMs: 60_000,
            label: "Feature Grid timeline clip",
          });

          await ctx.prove("An inserted component clip splits into two timeline clips", {
            claim: "Selecting Feature Grid with the playhead inside it enables the scissors button, and clicking it creates two persisted component clips.",
            voiceover: "选中已插入的组件后，播放头位于片段内部时剪刀会启用，点击即可把组件分成前后两个片段。",
            action: async () => {
              await ctx.trustedClick(componentClipSelector);
              await ctx.waitFor(
                `Boolean(document.querySelector(${JSON.stringify(enabledSplitButtonSelector)}))`,
                { timeoutMs: 20_000, label: "enabled component split button" },
              );
              await ctx.trustedClick(enabledSplitButtonSelector);
              await ctx.waitFor(
                `(() => {
                  const clips = [...document.querySelectorAll(${JSON.stringify(componentClipSelector)})];
                  const windows = clips
                    .map((clip) => [Number(clip.dataset.clipStart), Number(clip.dataset.clipEnd)])
                    .sort((a, b) => a[0] - b[0]);
                  const lanes = new Set(clips.map((clip) => clip.closest('.hf-timeline-lane')));
                  return windows.length === 2
                    && windows[0][0] === 2 && windows[0][1] === 7
                    && windows[1][0] === 7 && windows[1][1] === 12
                    && lanes.size === 1 && !lanes.has(null);
                })()`,
                { timeoutMs: 30_000, label: "two adjacent Feature Grid timeline clips" },
              );
              await waitForPersistedComponentInstances(projectDir, 2);
            },
            assert: async () => {
              const source = await readFile(join(projectDir, "index.html"), "utf8");
              const componentInstances =
                source.match(/data-composition-src="compositions\/components\/feature-grid\.html"/g) ?? [];
              ctx.assert(
                componentInstances.length === 2,
                `Expected two persisted Feature Grid clips, received ${componentInstances.length}.`,
              );
              ctx.assert(
                /id="feature-grid"[\s\S]*?data-start="2"[\s\S]*?data-duration="5"/.test(source),
                "The first component half was not persisted with the expected timing.",
              );
              ctx.assert(
                /id="feature-grid-split"[\s\S]*?data-start="7"[\s\S]*?data-duration="5"/.test(source),
                "The second component half was not persisted with the expected timing.",
              );
            },
            screenshot: {
              name: "component-clip-split-at-playhead",
              requireText: ["Feature Grid"],
              rejectText: ["Something went wrong", "Console errors in preview", "Failed to split"],
            },
          });
        } catch (error) {
          flowError = error;
          throw error;
        } finally {
          if (ctx.appUrl) {
            await ctx.eval(`location.assign(${JSON.stringify(ctx.appUrl)})`).catch(() => undefined);
            await ctx
              .waitFor("Boolean(window.__ipolloworkControl)", {
                timeoutMs: 60_000,
                label: "iPolloWork after isolated Studio proof",
              })
              .catch((restoreError) => {
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
