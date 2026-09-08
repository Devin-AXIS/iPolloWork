import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("chat-message-alignment");
const DELIVERY_GROUP_SELECTOR = [
  '[data-testid="assistant-message-group"]',
  ':has([data-testid="assistant-process-column"])',
  ':has([data-testid="assistant-message-column"])',
  ':has([data-testid="artifact-file-card"])',
].join("");
const COMPLETE_GROUP_SELECTOR = [
  DELIVERY_GROUP_SELECTOR,
  ':has([data-testid="assistant-message-actions"])',
].join("");

async function forceHover(ctx, selector) {
  await ctx.client.send("DOM.enable");
  await ctx.client.send("CSS.enable");
  const { root } = await ctx.client.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  ctx.assert(nodeId > 0, `Expected hover target: ${selector}`);
  await ctx.client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
}

export default {
  id: "chat-message-alignment",
  title: "Conversation content shares one left alignment line",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    return null;
  },
  steps: [
    {
      name: "Align completed assistant content",
      run: async (ctx) => {
        await ctx.prove("Completed assistant content shares one left edge while the user bubble stays right-aligned", {
          voiceover: vo[0],
          action: async () => {
            await ctx.eval(`location.hash = "/workspace/ws_591f8b972e41/session/session-d79df34f-a103-4d3d-a9b4-3437fa654ff4"`);
            await ctx.waitFor(`[...document.querySelectorAll('[data-testid="artifact-file-title"]')]
              .some((element) => element.textContent?.includes('Afterglow'))`, {
              timeoutMs: 60_000,
              label: "completed delivery conversation",
            });
            await ctx.waitFor(`(() => {
              if (document.querySelector('[data-testid=startup-logo-animation]')) return false;
              return ![...document.querySelectorAll('[role=status]')]
                .some((element) => /Loading|Installing required resources|正在加载|正在安装所需资源/.test(element.innerText || ''));
            })()`, {
              timeoutMs: 120_000,
              label: "conversation content without startup overlay",
            });

            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(COMPLETE_GROUP_SELECTOR)}))`, {
              timeoutMs: 60_000,
              label: "complete delivery conversation group",
            });

            await ctx.eval(`(() => {
              const group = document.querySelector(${JSON.stringify(COMPLETE_GROUP_SELECTOR)});
              group.scrollIntoView({ block: 'center', behavior: 'instant' });
              return true;
            })()`);
          },
          assert: async () => {
            const geometry = await ctx.eval(`(() => {
              const group = document.querySelector(${JSON.stringify(COMPLETE_GROUP_SELECTOR)});
              const process = group.querySelector('[data-testid="assistant-process-column"]');
              const message = group.querySelector('[data-testid="assistant-message-column"]');
              const artifact = group.querySelector('[data-testid="artifact-file-card"]');
              const actions = group.querySelector('[data-testid="assistant-message-actions"]');
              const processContent = process?.querySelector('button');
              const messageContent = message?.querySelector(':scope > div');
              const actionContent = actions?.querySelector('button');
              const userBubble = [...document.querySelectorAll('[data-testid="user-message-bubble"]')].at(-1);
              const userColumn = userBubble?.closest('[data-message-role="user"]');
              if (!processContent || !messageContent || !artifact || !actionContent || !userBubble || !userColumn) return null;
              const left = (element) => element.getBoundingClientRect().left;
              const rect = (element) => element.getBoundingClientRect();
              return {
                processLeft: left(processContent),
                messageLeft: left(messageContent),
                artifactLeft: left(artifact),
                actionsLeft: left(actionContent),
                userBubbleRight: rect(userBubble).right,
                userColumnRight: rect(userColumn).right - parseFloat(getComputedStyle(userColumn).paddingRight),
                userTextAlign: getComputedStyle(userBubble).textAlign,
              };
            })()`);
            ctx.assert(Boolean(geometry), "Expected all conversation alignment targets to be visible.");
            const leftEdges = [geometry.processLeft, geometry.messageLeft, geometry.artifactLeft, geometry.actionsLeft];
            ctx.assert(Math.max(...leftEdges) - Math.min(...leftEdges) <= 1, `Expected one assistant left edge: ${JSON.stringify(geometry)}`);
            ctx.assert(Math.abs(geometry.userBubbleRight - geometry.userColumnRight) <= 1, `Expected the user bubble to remain right-aligned: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.userTextAlign === "left", `Expected left-aligned text inside the user bubble: ${JSON.stringify(geometry)}`);
            ctx.recordEvidence({
              type: "assertion",
              status: "passed",
              assertion: "Assistant content shares one left edge and the user bubble retains right/left alignment semantics.",
              actual: geometry,
            });
          },
          screenshot: {
            name: "aligned-conversation-content",
            requireText: ["已处理"],
            rejectText: ["Something went wrong", "出了点问题"],
          },
        });
      },
    },
    {
      name: "Use the file card as the delivery entry",
      run: async (ctx) => {
        await ctx.prove("The file card carries the friendly title, delivery metadata, and technical path", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`location.hash = "/workspace/ws_9a1bcecbd4fe/session/ses_f85a82f8effe7wjuCWsiJ3Qwmt"`);
            await ctx.waitFor(`[...document.querySelectorAll('[data-testid="artifact-file-description"]')]
              .some((element) => /视频 · \\d+ 秒 · \\d+ 个场景/.test(element.textContent || ''))`, {
              timeoutMs: 60_000,
              label: "video delivery card with metadata",
            });
            await ctx.eval(`(() => {
              const card = document.querySelector(${JSON.stringify(`${DELIVERY_GROUP_SELECTOR} [data-testid="artifact-file-card"]`)});
              card.scrollIntoView({ block: 'center', behavior: 'instant' });
              return true;
            })()`);
            await forceHover(ctx, `${DELIVERY_GROUP_SELECTOR} [data-testid="artifact-file-shell"]`);
            await ctx.waitFor(`getComputedStyle(document.querySelector('[data-testid="artifact-file-actions"]')).opacity === '1'`, {
              timeoutMs: 10_000,
              label: "artifact hover actions",
            });
            await ctx.eval(`document.querySelector('[data-testid="artifact-file-more"]').click()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-slot="dropdown-menu-content"]'))`, {
              timeoutMs: 10_000,
              label: "artifact path menu",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const group = document.querySelector(${JSON.stringify(DELIVERY_GROUP_SELECTOR)});
              const body = [...group.querySelectorAll('[data-chat-readable-text="true"]')].map((node) => node.innerText).join('\\n');
              const card = group.querySelector('[data-testid="artifact-file-card"]');
              return {
                title: group.querySelector('[data-testid="artifact-file-title"]')?.textContent?.trim() ?? '',
                description: group.querySelector('[data-testid="artifact-file-description"]')?.textContent?.trim() ?? '',
                cardTag: card?.tagName ?? '',
                pathInBody: body.includes('design/') || body.includes('video/') || body.includes('生成文件：') || body.includes('生成文件:'),
                menuPath: document.querySelector('[data-slot="dropdown-menu-content"] [title]')?.getAttribute('title') ?? '',
              };
            })()`);
            ctx.assert(Boolean(state.title) && !state.title.includes("/") && !/\.html?$/i.test(state.title), `Expected a friendly artifact title: ${JSON.stringify(state)}`);
            ctx.assert(/视频 · \d+ 秒 · \d+ 个场景/.test(state.description), `Expected duration and scene metadata: ${JSON.stringify(state)}`);
            ctx.assert(state.cardTag === "BUTTON", `Expected the whole card to remain clickable: ${JSON.stringify(state)}`);
            ctx.assert(!state.pathInBody && (state.menuPath.includes('design/') || state.menuPath.includes('video/')), `Expected the path only in the card menu: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "artifact-card-primary-entry",
            requireText: ["视频", "个场景", "复制文件路径"],
            rejectText: ["Something went wrong", "出了点问题"],
          },
        });
      },
    },
    {
      name: "Keep recovery controls out of the content",
      run: async (ctx) => {
        await ctx.prove("File actions appear on hover and the compact latest control restores the conversation tail", {
          voiceover: vo[2],
          action: async () => {
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await ctx.eval(`(() => {
              const scroll = document.querySelector('[data-testid="session-message-scroll"]');
              scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));
              scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight - 220);
              scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="jump-to-latest"]'))`, {
              timeoutMs: 10_000,
              label: "compact jump to latest action",
            });
            await ctx.eval(`(() => {
              const card = document.querySelector(${JSON.stringify(`${DELIVERY_GROUP_SELECTOR} [data-testid="artifact-file-card"]`)});
              card.scrollIntoView({ block: 'center', behavior: 'instant' });
              const scroll = document.querySelector('[data-testid="session-message-scroll"]');
              scroll.scrollTop = Math.max(0, scroll.scrollTop - 120);
              scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="session-scroll-overlay"]'))`, {
              timeoutMs: 10_000,
              label: "recovery control beside the delivery card",
            });
            await forceHover(ctx, `${DELIVERY_GROUP_SELECTOR} [data-testid="artifact-file-shell"]`);
            await ctx.waitFor(`getComputedStyle(document.querySelector('[data-testid="artifact-file-actions"]')).opacity === '1'`, {
              timeoutMs: 10_000,
              label: "artifact hover actions after manual scroll",
            });
          },
          assert: async () => {
            const before = await ctx.eval(`(() => {
              const card = document.querySelector(${JSON.stringify(`${DELIVERY_GROUP_SELECTOR} [data-testid="artifact-file-card"]`)}).getBoundingClientRect();
              const overlay = document.querySelector('[data-testid="session-scroll-overlay"]').getBoundingClientRect();
              const actions = document.querySelector('[data-testid="artifact-file-actions"]');
              const overlaps = Math.max(card.left, overlay.left) < Math.min(card.right, overlay.right)
                && Math.max(card.top, overlay.top) < Math.min(card.bottom, overlay.bottom);
              return { overlaps, actionsOpacity: getComputedStyle(actions).opacity };
            })()`);
            ctx.assert(before.actionsOpacity === "1", `Expected hover-only artifact actions: ${JSON.stringify(before)}`);
            ctx.assert(!before.overlaps, `Expected the recovery control outside the file card: ${JSON.stringify(before)}`);

            await ctx.eval(`document.querySelector('[data-testid="jump-to-latest"]').click()`);
            await ctx.waitFor(`(() => {
              const scroll = document.querySelector('[data-testid="session-message-scroll"]');
              return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 1
                && !document.querySelector('[data-testid="jump-to-latest"]');
            })()`, {
              timeoutMs: 3_000,
              label: "conversation tail after jump",
            });

            await ctx.eval(`(() => {
              const scroll = document.querySelector('[data-testid="session-message-scroll"]');
              scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));
              scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight - 220);
              scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
              const card = document.querySelector(${JSON.stringify(`${DELIVERY_GROUP_SELECTOR} [data-testid="artifact-file-card"]`)});
              card.scrollIntoView({ block: 'center', behavior: 'instant' });
              scroll.scrollTop = Math.max(0, scroll.scrollTop - 120);
              scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="jump-to-latest"]'))`, {
              timeoutMs: 10_000,
              label: "restored manual reading position",
            });
            await forceHover(ctx, `${DELIVERY_GROUP_SELECTOR} [data-testid="artifact-file-shell"]`);
          },
          screenshot: {
            name: "hover-actions-and-compact-latest",
            requireText: ["视频", "个场景"],
            rejectText: ["Jump to latest", "Something went wrong", "出了点问题"],
          },
        });
      },
    },
    {
      name: "Tune Chinese reading weight on macOS only",
      run: async (ctx) => {
        await ctx.prove("Chinese conversation text uses the native macOS reading weight with restrained emphasis", {
          voiceover: vo[3],
          action: async () => {
            await ctx.waitFor(`Boolean(document.querySelector('[data-chat-readable-text="true"]'))`, {
              timeoutMs: 10_000,
              label: "readable conversation text",
            });
            await ctx.eval(`(() => {
              const readable = [...document.querySelectorAll('[data-chat-readable-text="true"]')].at(-1);
              readable.scrollIntoView({ block: 'center', behavior: 'instant' });
              return true;
            })()`);
          },
          assert: async () => {
            const typography = await ctx.eval(`(() => {
              const root = document.documentElement;
              const readables = [...document.querySelectorAll('[data-chat-readable-text="true"]')];
              const readable = readables.find((element) => element.querySelector('strong')) ?? readables[0];
              const paragraph = readable?.querySelector('p') ?? readable;
              const strong = readable?.querySelector('strong');
              return {
                mac: root.classList.contains('ipollowork-platform-mac'),
                bodyWeight: paragraph ? getComputedStyle(paragraph).fontWeight : '',
                bodySize: paragraph ? getComputedStyle(paragraph).fontSize : '',
                bodyLineHeight: paragraph ? getComputedStyle(paragraph).lineHeight : '',
                strongWeight: strong ? getComputedStyle(strong).fontWeight : '',
              };
            })()`);
            ctx.assert(typography.mac, `Expected the local macOS development client: ${JSON.stringify(typography)}`);
            ctx.assert(Number(typography.bodyWeight) === 500, `Expected the readable macOS body weight: ${JSON.stringify(typography)}`);
            ctx.assert(typography.bodySize === "15px" && typography.bodyLineHeight === "24px", `Expected the readable macOS type scale: ${JSON.stringify(typography)}`);
            ctx.assert(!typography.strongWeight || Number(typography.strongWeight) === 600, `Expected restrained emphasis: ${JSON.stringify(typography)}`);
          },
          screenshot: {
            name: "macos-chat-reading-weight",
            requireText: ["视频"],
            rejectText: ["Something went wrong", "出了点问题"],
          },
        });
      },
    },
  ],
};
