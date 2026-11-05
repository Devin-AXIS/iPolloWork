import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const shellFrame = `document.querySelector('iframe[src*="/ipollowork-video/studio/"]')`;
const shellDocument = `${shellFrame}?.contentDocument`;
const studioFrame = `${shellDocument}?.querySelector('[data-testid="video-panel"] iframe')`;

async function ensureStudio(ctx) {
  const state = await ctx.eval(`(() => {
    if (${shellFrame}) return 'ready';
    const video = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Video');
    if (video) {
      video.click();
      return 'opening';
    }
    const conversation = [...document.querySelectorAll('[role="treeitem"]')]
      .find((row) => row.querySelector('button[aria-label^="会话"]'));
    conversation?.click();
    return conversation ? 'conversation' : 'missing';
  })()`);
  if (state === "conversation") {
    await ctx.waitFor(`[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Video')`, {
      timeoutMs: 15_000,
      label: "Video conversation view",
    });
    await ctx.eval(`[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Video')?.click()`);
  }
  await ctx.waitFor(`Boolean(${studioFrame})`, { timeoutMs: 60_000, label: "Video Studio" });
  const closed = await ctx.eval(`(() => {
    const close = ${shellDocument}?.querySelector('[data-testid="template-catalog-dialog"] [data-slot="dialog-close"]');
    close?.click();
    return Boolean(close);
  })()`);
  if (closed) await ctx.waitFor(`!${shellDocument}?.querySelector('[data-testid="template-catalog-dialog"]')`, { label: "stale template dialog" });
}

async function hyperframesClient(ctx, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const targets = await listTargets(ctx.cdpBaseUrl);
    const target = targets.find((entry) => entry.type === "iframe" && entry.webSocketDebuggerUrl && entry.url.includes("/#project/"));
    if (target) return connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("HyperFrames Studio target did not become available.");
}

async function hyperframesEval(ctx, expression) {
  const client = await hyperframesClient(ctx);
  try {
    return await evaluate(client, expression, { awaitPromise: true });
  } finally {
    client.close();
  }
}

export default {
  id: "ai-trend-video-template",
  title: "AI trend analysis template is discoverable with a real visual preview",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:" },
  steps: [
    {
      name: "Discover AI trend briefing",
      run: async (ctx) => {
        await ctx.prove("Video creators can find AI 热点拆解 with its real cover and a usable template action", {
          voiceover: "在视频模板里搜索 AI 热点拆解，可以直接看到带分析结构的真实封面，并继续使用这套模板。",
          action: async () => {
            await ensureStudio(ctx);
            await hyperframesEval(ctx, `(() => {
              [...document.querySelectorAll('.hf-studio-header button')]
                .find((button) => button.textContent?.includes('模板') || button.textContent?.includes('Templates'))?.click();
              return true;
            })()`);
            await ctx.waitFor(`Boolean(${shellDocument}?.querySelector('[data-testid="template-catalog-dialog"]'))`, {
              timeoutMs: 30_000,
              label: "Video template dialog",
            });
            await ctx.eval(`(() => {
              const doc = ${shellDocument};
              const input = doc?.querySelector('[data-testid="template-catalog-dialog"] input');
              if (!input || input.tagName !== 'INPUT') return false;
              const Input = input.ownerDocument.defaultView.HTMLInputElement;
              const setter = Object.getOwnPropertyDescriptor(Input.prototype, 'value')?.set;
              setter?.call(input, 'AI 热点拆解');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(`(() => {
              const doc = ${shellDocument};
              const card = [...(doc?.querySelectorAll('[data-testid="template-catalog-item"]') ?? [])]
                .find((item) => item.textContent?.includes('AI 热点拆解'));
              const image = card?.querySelector('[data-testid="template-catalog-cover"] img');
              return Boolean(card && image?.complete && image.naturalWidth === 960);
            })()`, { timeoutMs: 30_000, label: "AI trend template card and cover" });
          },
          assert: async () => {
            const card = await ctx.eval(`(() => {
              const doc = ${shellDocument};
              const item = [...(doc?.querySelectorAll('[data-testid="template-catalog-item"]') ?? [])]
                .find((entry) => entry.textContent?.includes('AI 热点拆解'));
              const image = item?.querySelector('[data-testid="template-catalog-cover"] img');
              return {
                count: doc?.querySelectorAll('[data-testid="template-catalog-item"]').length ?? 0,
                text: item?.textContent ?? '',
                coverWidth: image?.naturalWidth ?? 0,
                hasAction: [...(item?.querySelectorAll('button') ?? [])].some((button) => /使用模板|Use template/u.test(button.textContent ?? '')),
              };
            })()`);
            ctx.assert(card.count === 1, `Expected one filtered template card: ${JSON.stringify(card)}`);
            ctx.assert(card.text.includes("AI 热点拆解") && card.coverWidth === 960 && card.hasAction, `Template card is incomplete: ${JSON.stringify(card)}`);
          },
          screenshot: { name: "ai-trend-video-template", requireText: ["Video"], rejectText: ["暂时无法打开", "Something went wrong"] },
        });
      },
    },
  ],
};
