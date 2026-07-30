import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-artifact-entry-routing");

const ARTIFACT_STATE = `(() => {
  const fileTitles = [...document.querySelectorAll("[title]")]
    .filter((node) => /\\.(html?|css|js|json)$/i.test(node.getAttribute("title") || ""));
  const activeEntries = fileTitles.filter((node) => (
    node.getAttribute("title") === "index.html" && Boolean(node.closest("button"))
  ));
  const inactiveStylesheets = fileTitles.filter((node) => (
    node.getAttribute("title")?.endsWith(".css") && !node.closest("button")
  ));
  const inactiveHtml = fileTitles.filter((node) => (
    node.getAttribute("title")?.endsWith(".html") && !node.closest("button")
  ));
  return {
    activeEntries: activeEntries.length,
    inactiveStylesheets: inactiveStylesheets.length,
    inactiveHtml: inactiveHtml.length,
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
                state.inactiveStylesheets > 0 &&
                state.inactiveHtml > 0;
            })()`, {
              timeoutMs: 60_000,
              label: "video entry and inactive companion outputs",
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
            ctx.assert(state.inactiveStylesheets > 0, "Expected generated CSS output to remain non-activatable.");
            ctx.assert(state.inactiveHtml > 0, "Expected unrelated HTML output to remain non-activatable.");
          },
          screenshot: { name: "video-entry-only-active", requireText: ["index.html", "design-tokens.css"] },
        });
      },
    },
    {
      name: "Non-entry files cannot change the right-side editor",
      run: async (ctx) => {
        await ctx.prove("CSS and unrelated HTML clicks leave the editor unchanged", {
          voiceover: vo[1],
          action: async () => {
            const before = await ctx.eval(ARTIFACT_STATE);
            await ctx.eval(`(() => {
              const css = [...document.querySelectorAll("[title]")]
                .find((node) => node.getAttribute("title")?.endsWith(".css") && !node.closest("button"));
              const html = [...document.querySelectorAll('[title="index.html"]')]
                .find((node) => !node.closest("button"));
              css?.scrollIntoView({ block: "center", inline: "nearest" });
              css?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              html?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            })()`);
            await new Promise((resolve) => setTimeout(resolve, 350));
            const after = await ctx.eval(ARTIFACT_STATE);
            ctx.assert(
              after.videoFrames === before.videoFrames && after.panelTabs === before.panelTabs,
              `Inactive output changed the right panel: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
            );
          },
          assert: async () => {
            const state = await ctx.eval(ARTIFACT_STATE);
            ctx.assert(state.inactiveStylesheets > 0 && state.inactiveHtml > 0, "Inactive output cards disappeared unexpectedly.");
          },
          screenshot: { name: "inactive-files-do-not-open", requireText: ["design-tokens.css"] },
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
