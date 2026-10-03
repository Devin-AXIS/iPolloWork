let seamState = null;

export default {
  id: "chat-message-actions-hover",
  title: "Message quick actions remain reachable across the bubble edge",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"user-message-bubble\"]') && document.querySelector('[data-testid=\"user-message-actions\"]'))", {
      timeoutMs: 60_000,
      label: "user message and quick actions",
    });
    return null;
  },
  steps: [
    {
      name: "Move from the message bubble into its quick actions",
      run: async (ctx) => {
        await ctx.prove("The quick actions stay visible and clickable while the pointer crosses the bubble edge", {
          action: async () => {
            const points = await ctx.eval(`(() => {
              const bubble = [...document.querySelectorAll('[data-testid="user-message-bubble"]')].at(-1);
              const actions = bubble.parentElement.querySelector('[data-testid="user-message-actions"]');
              bubble.scrollIntoView({ block: 'center', behavior: 'instant' });
              const bubbleRect = bubble.getBoundingClientRect();
              const actionsRect = actions.getBoundingClientRect();
              return {
                bubble: { x: bubbleRect.left + bubbleRect.width / 2, y: bubbleRect.top + bubbleRect.height / 2 },
                seam: { x: actionsRect.right - 10, y: bubbleRect.bottom },
                action: { x: actionsRect.right - 14, y: actionsRect.top + actionsRect.height / 2 },
              };
            })()`);

            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.bubble });
            await ctx.waitFor("getComputedStyle(document.querySelector('[data-testid=\"user-message-actions\"]')).opacity === '1'", {
              timeoutMs: 3_000,
              label: "quick actions after hovering the bubble",
            });

            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.seam });
            await new Promise((resolve) => setTimeout(resolve, 50));
            seamState = await ctx.eval(`(() => {
              const actions = document.querySelector('[data-testid="user-message-actions"]');
              return {
                opacity: getComputedStyle(actions).opacity,
                pointerEvents: getComputedStyle(actions).pointerEvents,
              };
            })()`);

            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.action });
            await ctx.waitFor("document.querySelector('[data-testid=\"user-message-actions\"]').matches(':hover')", {
              timeoutMs: 3_000,
              label: "pointer over a quick action",
            });
          },
          assert: async () => {
            const finalState = await ctx.eval(`(() => {
              const actions = document.querySelector('[data-testid="user-message-actions"]');
              const rect = actions.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.right - 14, rect.top + rect.height / 2);
              return {
                hovered: actions.matches(':hover'),
                opacity: getComputedStyle(actions).opacity,
                pointerEvents: getComputedStyle(actions).pointerEvents,
                hitIsAction: hit instanceof HTMLButtonElement && actions.contains(hit),
                hitLabel: hit?.getAttribute('aria-label') ?? '',
              };
            })()`);

            ctx.assert(seamState?.opacity === "1", `Expected no fade at the bubble edge: ${JSON.stringify(seamState)}`);
            ctx.assert(seamState?.pointerEvents === "auto", `Expected the edge to remain pointer-interactive: ${JSON.stringify(seamState)}`);
            ctx.assert(finalState.hovered && finalState.opacity === "1", `Expected visible actions under the pointer: ${JSON.stringify(finalState)}`);
            ctx.assert(finalState.pointerEvents === "auto" && finalState.hitIsAction, `Expected a clickable quick action: ${JSON.stringify(finalState)}`);
            ctx.recordEvidence({
              type: "assertion",
              status: "passed",
              assertion: "The message quick actions remain fully visible and pointer-interactive across the bubble edge.",
              actual: { seamState, finalState },
            });
          },
          screenshot: {
            name: "message-quick-actions-hover",
            requireText: ["发布抖音"],
            rejectText: ["Something went wrong", "出了点问题"],
          },
        });
      },
    },
  ],
};
