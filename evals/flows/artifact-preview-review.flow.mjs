import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("artifact-preview-review");
let websitePath = "";
let slidePath = "";

async function freshTask(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const before = await ctx.eval("window.__ipolloworkControl.snapshot().route");
  await ctx.control("session.create_task");
  await ctx.waitFor(`(() => {
    const route = window.__ipolloworkControl.snapshot().route;
    return route.includes('/session/') && route !== ${JSON.stringify(before)};
  })()`, { timeoutMs: 30_000, label: "fresh task" });
}

function activeWorkspaceId(ctx) {
  return ctx.eval(`(() => {
    const match = /\\/workspace\\/([^/]+)/.exec(window.__ipolloworkControl.snapshot().route);
    return match?.[1] || '';
  })()`);
}

export default {
  id: "artifact-preview-review",
  title: "Websites and presentations use one client batch-acceptance entry",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before Design acceptance can run."
      : null;
  },
  steps: [
    {
      name: "One website check covers desktop and mobile",
      run: async (ctx) => {
        await ctx.prove("The Design client reviews both website viewports in one action", {
          voiceover: vo[0],
          action: async () => {
            await freshTask(ctx);
            const seeded = await ctx.control("eval.design.seed_html");
            websitePath = seeded.path;
          },
          assert: async () => {
            const review = await ctx.control("design.preview_review", {
              workspaceId: await activeWorkspaceId(ctx),
              sourcePath: websitePath,
              kind: "site",
            });
            ctx.assert(review.passed === true, `Website review failed: ${JSON.stringify(review.issues)}`);
            ctx.assert(review.viewports?.map((viewport) => viewport.name).join(",") === "desktop,mobile", "Website review did not cover desktop and mobile together.");
          },
          screenshot: { name: "website-single-client-review", requireText: ["entry.html"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "One presentation check covers every slide",
      run: async (ctx) => {
        await ctx.prove("The same Design client entry reviews the complete presentation in one batch", {
          voiceover: vo[1],
          action: async () => {
            await freshTask(ctx);
            const seeded = await ctx.control("eval.design.seed_deck");
            slidePath = seeded.path;
          },
          assert: async () => {
            const review = await ctx.control("design.preview_review", {
              workspaceId: await activeWorkspaceId(ctx),
              sourcePath: slidePath,
              kind: "slides",
            });
            ctx.assert(review.passed === true, `Presentation review failed: ${JSON.stringify(review.issues)}`);
            ctx.assert(review.pageCount === 3 && review.pages?.every((page) => !page.blank), `Presentation coverage is incomplete: ${JSON.stringify(review.pages)}`);
          },
          screenshot: { name: "presentation-single-client-review", requireText: ["entry.html"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
