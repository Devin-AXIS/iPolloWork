import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-artifact-entry-routing");

const ARTIFACT_STATE = `(() => {
  const fileTitles = [...document.querySelectorAll("[title]")]
    .filter((node) => /\\.(html?|css|js|json)$/i.test(node.getAttribute("title") || ""));
  const activeEntries = fileTitles.filter((node) => (
    node.getAttribute("title") === "index.html" && Boolean(node.closest("button"))
  ));
  const supportingFiles = fileTitles.filter((node) => (
    node.getAttribute("title") !== "index.html"
  ));
  return {
    activeEntries: activeEntries.length,
    supportingFiles: supportingFiles.length,
    videoFrames: document.querySelectorAll(
      'iframe[title="HyperFrames Video Studio"], iframe[title="HyperFrames 视频工作室"]',
    ).length,
    panelTabs: document.querySelectorAll('button[aria-label^="Select tab"]').length,
  };
})()`;

export default {
  id: "video-artifact-entry-routing",
  title: "Video conversations only activate the session-owned HTML entry",
  kind: "user-facing",
  steps: [
    {
      name: "Template selection stays compact across engines",
      run: async (ctx) => {
        await ctx.prove("The conversation shows the selected template label without its private execution prompt", {
          action: async () => {
            await ctx.eval(`(() => {
              const close = document.querySelector(
                'button[aria-label="Close right panel"], button[aria-label="收起右侧面板"], button[aria-label="Close panel"], button[aria-label="关闭面板"]',
              );
              close?.click();
              const label = [...document.querySelectorAll("div, p, span")]
                .filter((node) => node.textContent?.includes("已应用模板：Agent Command Center"))
                .sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0];
              label?.scrollIntoView({ block: "center", inline: "nearest" });
            })()`);
            await ctx.waitFor(
              'document.body.innerText.includes("已应用模板：Agent Command Center") && !document.body.innerText.includes("Read `video/session-e9b173fe-cebe-42ef-a250-bda08dd8c9ad/brief.json`")',
              { timeoutMs: 30_000, label: "compact template selection label" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              labelVisible: document.body.innerText.includes("已应用模板：Agent Command Center"),
              privatePromptVisible: document.body.innerText.includes("Keep the template's visual language and update every applicable item"),
            }))()`);
            ctx.assert(state.labelVisible, "Expected the selected template label to remain visible.");
            ctx.assert(!state.privatePromptVisible, "Expected the private template execution prompt to stay hidden.");
          },
          screenshot: { name: "template-selection-label-only", requireText: ["已应用模板"] },
        });
      },
    },
    {
      name: "Model-independent output cards expose one video entry",
      run: async (ctx) => {
        await ctx.prove("Only the current video entry has an open affordance", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 60_000,
              label: "control API",
            });
            await ctx.eval(`(() => {
              const expand = document.querySelector(
                'button[aria-label="Restore panel width"], button[aria-label="Expand panel"]',
              );
              if (expand?.getAttribute("aria-pressed") === "true") expand.click();
            })()`);
            await ctx.waitFor(`(() => {
              const state = ${ARTIFACT_STATE};
              return state.activeEntries > 0 &&
                state.supportingFiles === 0;
            })()`, {
              timeoutMs: 60_000,
              label: "one visible video entry without supporting-file cards",
            });
            await ctx.eval(`(() => {
              const entry = [...document.querySelectorAll('[title="index.html"]')]
                .find((node) => node.closest("button"));
              entry?.scrollIntoView({ block: "center", inline: "center" });
              entry?.closest("button")?.click();
            })()`);
            await ctx.waitFor(
              `Boolean(document.querySelector('iframe[title="HyperFrames Video Studio"], iframe[title="HyperFrames 视频工作室"]'))`,
              { timeoutMs: 60_000, label: "opened Video Studio from the only active entry" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(ARTIFACT_STATE);
            ctx.assert(state.activeEntries > 0, "Expected the current video index.html to be activatable.");
            ctx.assert(state.supportingFiles === 0, "Expected supporting files to be omitted from generated-file cards.");
          },
          screenshot: { name: "video-entry-only-active", requireText: ["index.html"] },
        });
      },
    },
    {
      name: "Supporting files stay hidden from the conversation",
      run: async (ctx) => {
        await ctx.prove("Implementation assets do not create misleading output cards", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`(() => {
              const close = document.querySelector(
                'button[aria-label="Close right panel"], button[aria-label="收起右侧面板"], button[aria-label="Close panel"], button[aria-label="关闭面板"]',
              );
              close?.click();
            })()`);
            await ctx.waitFor(
              `!document.querySelector('iframe[title="HyperFrames Video Studio"], iframe[title="HyperFrames 视频工作室"]')`,
              { timeoutMs: 30_000, label: "closed Video Studio while output card remains" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(ARTIFACT_STATE);
            ctx.assert(state.activeEntries > 0, "Expected the current video index.html output.");
            ctx.assert(state.supportingFiles === 0, "Supporting output cards are still visible.");
          },
          screenshot: { name: "supporting-files-hidden", requireText: ["index.html"] },
        });
      },
    },
    {
      name: "The current index opens Video Studio",
      run: async (ctx) => {
        await ctx.prove("The active index.html opens the current session Video Studio", {
          voiceover: vo[2],
          action: async () => {
            await ctx.eval(`(() => {
              const close = document.querySelector(
                'button[aria-label="Close right panel"], button[aria-label="收起右侧面板"], button[aria-label="Close panel"], button[aria-label="关闭面板"]',
              );
              close?.click();
            })()`);
            await ctx.waitFor(
              `!document.querySelector('iframe[title="HyperFrames Video Studio"], iframe[title="HyperFrames 视频工作室"]')`,
              { timeoutMs: 30_000, label: "closed right-side Video Studio" },
            );
            await ctx.eval(`(() => {
              const entry = [...document.querySelectorAll('[title="index.html"]')]
                .find((node) => node.closest("button"));
              entry?.closest("button")?.click();
            })()`);
            await ctx.waitFor(
              `document.querySelector('iframe[title="HyperFrames Video Studio"], iframe[title="HyperFrames 视频工作室"]')?.dataset.loaded === "true"`,
              { timeoutMs: 60_000, label: "loaded current Video Studio" },
            );
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            await ctx.eval(`(() => {
              const expand = document.querySelector('button[aria-label="Expand panel"]');
              if (expand?.getAttribute("aria-pressed") !== "true") expand?.click();
            })()`);
            await ctx.waitFor(
              `document.querySelector('button[aria-label="Restore panel width"]')?.getAttribute("aria-pressed") === "true"`,
              { timeoutMs: 30_000, label: "expanded Video Studio proof state" },
            );
          },
          assert: async () => {
            const route = await ctx.eval(`(() => {
              const sessionId = window.location.hash.match(/\\/session\\/([^/?#]+)/)?.[1] || "";
              const src = document.querySelector(
                'iframe[title="HyperFrames Video Studio"], iframe[title="HyperFrames 视频工作室"]',
              )?.getAttribute("src") || "";
              return { sessionId, src };
            })()`);
            ctx.assert(
              route.sessionId.length > 0 && route.src.includes(`/#project/${route.sessionId}`),
              `Expected the current session's Video Studio route, got ${JSON.stringify(route)}`,
            );
          },
          screenshot: { name: "video-entry-opens-studio" },
        });
      },
    },
  ],
};
