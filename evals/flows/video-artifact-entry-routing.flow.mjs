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
    videoFrames: document.querySelectorAll('iframe[title="HyperFrames Video Studio"]').length,
    panelTabs: document.querySelectorAll('button[aria-label^="Select tab"]').length,
  };
})()`;

export default {
  id: "video-artifact-entry-routing",
  title: "Video conversations only activate the session-owned HTML entry",
  kind: "user-facing",
  steps: [
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
              const expand = document.querySelector('button[aria-label="Toggle Video Studio fullscreen"]');
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
            })()`);
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
            const before = await ctx.eval(ARTIFACT_STATE);
            await new Promise((resolve) => setTimeout(resolve, 350));
            const after = await ctx.eval(ARTIFACT_STATE);
            ctx.assert(
              after.videoFrames === before.videoFrames && after.panelTabs === before.panelTabs,
              `Hidden support files changed the right panel: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
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
              const close = document.querySelector('button[aria-label="Close right panel"]');
              close?.click();
            })()`);
            await ctx.waitFor(
              `!document.querySelector('iframe[title="HyperFrames Video Studio"]')`,
              { timeoutMs: 30_000, label: "closed right-side Video Studio" },
            );
            await ctx.eval(`(() => {
              const entry = [...document.querySelectorAll('[title="index.html"]')]
                .find((node) => node.closest("button"));
              entry?.closest("button")?.click();
            })()`);
            await ctx.waitFor(
              `document.querySelector('iframe[title="HyperFrames Video Studio"]')?.dataset.loaded === "true"`,
              { timeoutMs: 60_000, label: "loaded current Video Studio" },
            );
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            await ctx.eval(`(() => {
              const expand = document.querySelector('button[aria-label="Toggle Video Studio fullscreen"]');
              if (expand?.getAttribute("aria-pressed") !== "true") expand?.click();
            })()`);
            await ctx.waitFor(
              `document.querySelector('button[aria-label="Toggle Video Studio fullscreen"]')?.getAttribute("aria-pressed") === "true"`,
              { timeoutMs: 30_000, label: "expanded Video Studio proof state" },
            );
          },
          assert: async () => {
            const route = await ctx.eval(`(() => {
              const sessionId = window.location.hash.match(/\\/session\\/([^/?#]+)/)?.[1] || "";
              const src = document.querySelector('iframe[title="HyperFrames Video Studio"]')?.getAttribute("src") || "";
              return { sessionId, src };
            })()`);
            ctx.assert(
              route.sessionId.length > 0 && route.src.includes(`/#project/${route.sessionId}`),
              `Expected the current session's Video Studio route, got ${JSON.stringify(route)}`,
            );
          },
          screenshot: { name: "video-entry-opens-studio", requireText: ["Video Studio"] },
        });
      },
    },
  ],
};
