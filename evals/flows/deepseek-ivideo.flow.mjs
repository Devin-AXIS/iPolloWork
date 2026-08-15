import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("deepseek-ivideo");
const state = { messageCount: 0 };

const shellFrame = `document.querySelector('iframe[src*="/ipollowork-video/studio/"]')`;
const shellDocument = `${shellFrame}?.contentDocument`;

async function ensureStudio(ctx) {
  await ctx.eval(`(() => {
    if (${shellFrame}) return true;
    [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Video')?.click();
    return false;
  })()`);
  await ctx.waitFor(`Boolean(${shellDocument}?.querySelector('.ivideo-frame'))`, {
    timeoutMs: 60_000,
    label: "DeepSeek iVideo Studio",
  });
  if (await ctx.eval("Boolean(document.querySelector('textarea'))")) await ctx.fill("textarea", "");
}

async function hyperframesClient(ctx, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const targets = await listTargets(ctx.cdpBaseUrl);
    const target = targets.find((entry) => (
      entry.type === "iframe"
      && entry.webSocketDebuggerUrl
      && entry.url.includes("/#project/session-")
    ));
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

async function waitForHyperframes(ctx, expression, { timeoutMs = 60_000, label = "HyperFrames state" } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await hyperframesEval(ctx, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : "."}`);
}

async function conversationMessageCount(ctx) {
  return ctx.eval(`document.body.innerText.split('Create a short product video.').length - 1`);
}

export default {
  id: "deepseek-ivideo",
  title: "DeepSeek Harness gains a native, editable iVideo Studio without a second editor or renderer",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "127.0.0.1:52268" },
  steps: [
    {
      name: "Native one-line Video Studio",
      run: async (ctx) => {
        await ctx.prove("Video opens iVideo as one native HyperFrames workspace with a single branded control row", {
          voiceover: vo[0],
          action: async () => ensureStudio(ctx),
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const doc = ${shellDocument};
              return {
                rows: doc?.querySelectorAll('.ivideo-native-row').length ?? 0,
                studio: Boolean(doc?.querySelector('iframe.ivideo-frame')),
                controls: [...doc?.querySelectorAll('.ivideo-glass-cluster button, .ivideo-glass-cluster a') ?? []]
                  .map((node) => node.textContent?.trim() || node.getAttribute('aria-label')),
              };
            })()`);
            ctx.assert(result.rows === 1 && result.studio, `Expected one native iVideo row: ${JSON.stringify(result)}`);
            ctx.assert(result.controls.some((label) => label?.includes("模板")), "Template control is missing.");
            ctx.assert(result.controls.some((label) => label?.includes("Ask AI")), "Whole-video Ask AI is missing.");
          },
          screenshot: { name: "ivideo-native-studio", requireText: ["Video"], rejectText: ["iVideo 暂时无法打开"] },
        });
      },
    },
    {
      name: "Video-only template market",
      run: async (ctx) => {
        await ctx.prove("The iVideo template market contains exactly the 27 bundled Video templates", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`(() => {
              const doc = ${shellDocument};
              [...doc.querySelectorAll('button')].find((button) => button.textContent?.includes('模板'))?.click();
            })()`);
            await ctx.waitFor(`${shellDocument}?.querySelectorAll('.ivideo-template-card').length === 27`, {
              timeoutMs: 30_000,
              label: "27 iVideo templates",
            });
            await ctx.waitFor(`[...${shellDocument}?.querySelectorAll('.ivideo-template-cover img') ?? []].filter((image) => image.complete && image.naturalWidth > 0).length >= 24`, {
              timeoutMs: 30_000,
              label: "loaded iVideo template covers",
            });
          },
          assert: async () => {
            const catalog = await ctx.eval(`(() => {
              const doc = ${shellDocument};
              return {
                count: doc.querySelectorAll('.ivideo-template-card').length,
                heading: doc.querySelector('#ivideo-template-title')?.textContent,
                description: doc.querySelector('.ivideo-template-dialog header p')?.textContent,
              };
            })()`);
            ctx.assert(catalog.count === 27, `Expected 27 Video templates: ${JSON.stringify(catalog)}`);
            ctx.assert(catalog.heading === "Video 模板" && catalog.description.includes("27 个"), `Unexpected catalog identity: ${JSON.stringify(catalog)}`);
          },
          screenshot: { name: "ivideo-video-template-market", requireText: ["Video"] },
        });
      },
    },
    {
      name: "Atomic template application keeps native timeline",
      run: async (ctx) => {
        await ctx.prove("Applying a template returns to the same native twelve-second HyperFrames timeline", {
          voiceover: vo[2],
          action: async () => {
            await ctx.eval(`(() => {
              const doc = ${shellDocument};
              [...doc.querySelectorAll('.ivideo-template-card')]
                .find((card) => card.textContent?.includes('Agent Command Center'))?.click();
            })()`);
            await ctx.waitFor(`Boolean(${shellDocument}?.querySelector('[aria-label="确认更换视频模板"]'))`, {
              timeoutMs: 15_000,
              label: "template replacement confirmation",
            });
            await ctx.eval(`(() => {
              const doc = ${shellDocument};
              [...doc.querySelectorAll('[aria-label="确认更换视频模板"] button')]
                .find((button) => button.textContent?.trim() === '使用模板')?.click();
            })()`);
            await ctx.waitFor(`!${shellDocument}?.querySelector('.ivideo-template-dialog')`, {
              timeoutMs: 60_000,
              label: "applied video template",
            });
            await ctx.waitFor(`Boolean(${shellDocument}?.querySelector('iframe.ivideo-frame'))`, {
              timeoutMs: 60_000,
              label: "restarted native Studio",
            });
            await waitForHyperframes(ctx, `document.body.innerText.includes('00:00/00:12') && document.querySelectorAll('button[aria-label^="Hide track"]').length >= 5`, {
              label: "twelve-second native timeline",
            });
          },
          assert: async () => {
            const studio = await hyperframesEval(ctx, `(() => ({
              duration: document.body.innerText.includes('00:00/00:12'),
              exportButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Export'),
              tracks: document.querySelectorAll('button[aria-label^="Hide track"]').length,
            }))()`);
            ctx.assert(studio.duration && studio.exportButton && studio.tracks >= 5, `Native timeline is incomplete: ${JSON.stringify(studio)}`);
          },
          screenshot: { name: "ivideo-template-native-timeline", requireText: ["Video"] },
        });
      },
    },
    {
      name: "Selected element Ask AI stays draft-only",
      run: async (ctx) => {
        await ctx.prove("A selected video element contributes validated text, styles, and a stable locator to a draft without sending", {
          voiceover: vo[3],
          action: async () => {
            await hyperframesEval(ctx, `(() => {
              const params = new URLSearchParams(location.hash.split('?')[1] || '');
              params.set('selFile', 'index.html');
              params.set('selSelector', '.tool-stage');
              params.set('selIndex', '0');
              location.hash = location.hash.split('?')[0] + '?' + params.toString();
              return location.hash;
            })()`);
            await ctx.waitFor(`Boolean(${shellDocument}?.querySelector('button[title^="Ask AI about"]:not([disabled])'))`, {
              timeoutMs: 30_000,
              label: "selected-element AI control",
            });
            state.messageCount = await conversationMessageCount(ctx);
            await ctx.eval(`(() => {
              const doc = ${shellDocument};
              doc.querySelector('button[title^="Ask AI about"]')?.click();
            })()`);
            await ctx.waitFor(`document.querySelector('textarea')?.value.includes('Help me edit the selected element in iPolloWork iVideo.')`, {
              timeoutMs: 15_000,
              label: "selected-element Harness draft",
            });
            await ctx.eval("document.querySelector('textarea').scrollTop = 0");
          },
          assert: async () => {
            const result = await ctx.eval(`(() => ({
              draft: document.querySelector('textarea')?.value || '',
              count: document.body.innerText.split('Create a short product video.').length - 1,
            }))()`);
            ctx.assert(result.draft.includes('[data-hf-id="hf-s2yn"]'), `Stable selector missing: ${result.draft.slice(0, 500)}`);
            ctx.assert(result.draft.includes('Computed styles:'), "Selected element styles are missing from the draft.");
            ctx.assert(result.count === state.messageCount, `Element AI sent a message: ${state.messageCount} -> ${result.count}`);
          },
          screenshot: { name: "ivideo-selected-element-ai-draft", requireText: ["Video"] },
        });
      },
    },
    {
      name: "Whole-video Ask AI stays draft-only",
      run: async (ctx) => {
        await ctx.prove("Whole-video Ask AI prepares a project-aware validated editing request without executing it", {
          voiceover: vo[4],
          action: async () => {
            state.messageCount = await conversationMessageCount(ctx);
            await ctx.eval(`(() => {
              const doc = ${shellDocument};
              [...doc.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Ask AI')?.click();
            })()`);
            await ctx.waitFor(`document.querySelector('textarea')?.value.includes('Help me improve the current iPolloWork HyperFrames video.')`, {
              timeoutMs: 15_000,
              label: "whole-video Harness draft",
            });
            await ctx.eval("document.querySelector('textarea').scrollTop = 0");
          },
          assert: async () => {
            const result = await ctx.eval(`(() => ({
              draft: document.querySelector('textarea')?.value || '',
              count: document.body.innerText.split('Create a short product video.').length - 1,
            }))()`);
            ctx.assert(result.draft.includes("ipollowork_video_validate"), "Whole-video draft does not require validation.");
            ctx.assert(result.count === state.messageCount, `Whole-video AI sent a message: ${state.messageCount} -> ${result.count}`);
          },
          screenshot: { name: "ivideo-whole-video-ai-draft", requireText: ["Video"] },
        });
      },
    },
    {
      name: "Native HyperFrames export",
      run: async (ctx) => {
        await ctx.prove("iVideo delegates video export to the native HyperFrames MP4, MOV, and WebM pipeline", {
          voiceover: vo[5],
          action: async () => {
            await hyperframesEval(ctx, `(() => {
              [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Export')?.click();
              return true;
            })()`);
            let ready = false;
            for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
              ready = await hyperframesEval(ctx, `document.body.innerText.includes('MP4') && document.body.innerText.includes('WebM') && document.body.innerText.includes('Resolution')`);
              if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
            }
            ctx.assert(ready, "HyperFrames export controls did not appear.");
          },
          assert: async () => {
            const exportState = await hyperframesEval(ctx, `(() => ({
              mp4: document.body.innerText.includes('MP4'),
              mov: document.body.innerText.includes('MOV (ProRes)'),
              webm: document.body.innerText.includes('WebM'),
              resolution: document.body.innerText.includes('Resolution'),
              quality: document.body.innerText.includes('High Quality'),
            }))()`);
            ctx.assert(Object.values(exportState).every(Boolean), `Native export options are incomplete: ${JSON.stringify(exportState)}`);
          },
          screenshot: { name: "ivideo-native-hyperframes-export", requireText: ["Video"] },
        });
      },
    },
    {
      name: "Stop export smoke test",
      run: async (ctx) => {
        await hyperframesEval(ctx, `(() => {
          [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Cancel')?.click();
          return true;
        })()`).catch(() => undefined);
      },
    },
  ],
};
