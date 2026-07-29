import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-template-pack");
const templates = [
  { title: "Agent Command Center", voiceover: vo[0] },
  { title: "Multi-Agent Relay", voiceover: vo[1] },
  { title: "Remote Worker Connect", voiceover: vo[2] },
  { title: "Connector Pulse", voiceover: vo[3] },
  { title: "Release Spotlight", voiceover: vo[4] },
  { title: "Meeting Action Conveyor", voiceover: vo[5] },
  { title: "Research Evidence Wall", voiceover: vo[6] },
  { title: "Permission Vault", voiceover: vo[7] },
  { title: "Local File Cascade", voiceover: vo[8] },
  { title: "Prompt A/B Laboratory", voiceover: vo[9] },
  { title: "Automation Day Planner", voiceover: vo[10] },
  { title: "Multilingual Type Stage", voiceover: vo[11] },
  { title: "Cost Saving Waterfall", voiceover: vo[12] },
  { title: "Plugin Exploded Blueprint", voiceover: vo[13] },
  { title: "Human Approval Branch", voiceover: vo[14] },
];

async function setEnglish(ctx) {
  const changed = await ctx.eval(`(() => {
    const key = "ipollowork.language";
    if (localStorage.getItem(key) === "en") return false;
    localStorage.setItem(key, "en");
    return true;
  })()`);
  if (changed) {
    await ctx.client.send("Page.reload", { ignoreCache: true });
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "reloaded English app" });
  }
}

async function openVideoTemplates(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await setEnglish(ctx);
  const opened = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => (item.textContent || "").trim() === "Templates" && !item.disabled,
    );
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(opened, "The Templates entry was not available.");
  await ctx.waitForText("Browse installed and bundled templates", { timeoutMs: 30_000 });
  const selected = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => (item.textContent || "").trim() === "Video" && !item.disabled,
    );
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(selected, "The Video category was not available.");
}

async function searchTemplate(ctx, title) {
  await ctx.waitFor(`Boolean(document.querySelector('input[placeholder="Search templates"]'))`, {
    timeoutMs: 30_000,
    label: "template search",
  });
  await ctx.fill('input[placeholder="Search templates"]', title);
  await ctx.waitFor(`(() => {
    const card = [...document.querySelectorAll("article")].find(
      (item) => (item.textContent || "").includes(${JSON.stringify(title)}),
    );
    const image = card?.querySelector("img");
    return Boolean(image?.complete && image.naturalWidth === 960 && image.naturalHeight === 540);
  })()`, { timeoutMs: 30_000, label: `${title} card and cover` });
}

function templateStateExpression(title) {
  return `(() => {
    const cards = [...document.querySelectorAll("article")].filter(
      (item) => (item.textContent || "").includes(${JSON.stringify(title)}),
    );
    const image = cards[0]?.querySelector("img");
    return {
      count: cards.length,
      width: image?.naturalWidth || 0,
      height: image?.naturalHeight || 0,
      video: cards[0]?.textContent?.includes("Video") || false,
      action: [...(cards[0]?.querySelectorAll("button") || [])].some(
        (button) => (button.textContent || "").trim() === "Use" && !button.disabled,
      ),
    };
  })()`;
}

export default {
  id: "video-template-pack",
  title: "Fifteen themeable HyperFrames templates appear as usable Video packages",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the video template flow can run."
      : null;
  },
  steps: templates.map((template, index) => ({
    name: `${template.title} is available`,
    run: async (ctx) => {
      await ctx.prove(`${template.title} ships as a usable Video template`, {
        voiceover: template.voiceover,
        action: async () => {
          if (index === 0) await openVideoTemplates(ctx);
          await searchTemplate(ctx, template.title);
          await ctx.client.send("Page.bringToFront");
        },
        assert: async () => {
          const state = await ctx.eval(templateStateExpression(template.title));
          ctx.assert(
            state.count === 1 && state.width === 960 && state.height === 540 && state.video && state.action,
            `${template.title} card is incomplete: ${JSON.stringify(state)}`,
          );
        },
        screenshot: {
          name: template.title,
          targetUrlIncludes: "localhost:5173",
          requireText: [template.title, "Video", "Use"],
          rejectText: ["Something went wrong"],
        },
      });
    },
  })),
};
