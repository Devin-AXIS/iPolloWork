import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "streaming-scroll-stability";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
const PROMPT = "滚动稳定性验证：请用 Markdown 输出 400 行简短的编号说明，每行只写‘稳定输出’和编号，不要提前结束。";

export default {
  id: FLOW_ID,
  title: "Streaming output respects continuous manual scrolling without forced anchors",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const ready = await ctx.waitFor(
      `window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`,
      { timeoutMs: 30_000, label: "session.create_task enabled" },
    );
    return ready ? null : "No usable workspace is available.";
  },
  steps: [
    {
      name: "Continuous scrolling remains stable while output grows",
      run: async (ctx) => {
        await ctx.prove("Streaming output does not replay the user's scroll position through forced anchors", {
          voiceover: vo[0],
          action: async () => {
            await ctx.control("session.create_task");
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions().some((action) => action.id === "composer.set_text" && !action.disabled)`,
              { timeoutMs: 30_000, label: "composer ready" },
            );
            await ctx.control("composer.set_text", { text: PROMPT });
            await ctx.control("composer.send");

            await ctx.waitFor(
              `(() => {
                const message = document.querySelector('[data-message-role="assistant"]');
                if (!message) return false;
                let scroller = message.parentElement;
                while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) {
                  scroller = scroller.parentElement;
                }
                return Boolean(scroller && scroller.scrollHeight > scroller.clientHeight + 200);
              })()`,
              { timeoutMs: 60_000, label: "streaming transcript overflow" },
            );

            const installed = await ctx.eval(`(() => {
              const message = document.querySelector('[data-message-role="assistant"]');
              let scroller = message?.parentElement || null;
              while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) {
                scroller = scroller.parentElement;
              }
              if (!scroller) return false;

              const originalScrollIntoView = Element.prototype.scrollIntoView;
              const proof = {
                originalScrollIntoView,
                scroller,
                forcedAnchorCalls: 0,
                scrollEvents: 0,
                gestureSteps: 0,
                assistantCharsAtStart: message?.innerText.length || 0,
                assistantCharsAtEnd: 0,
                startTop: 0,
                endTop: 0,
                largestJump: 0,
                previousTop: 0,
                interval: 0,
                listener: null,
              };

              scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 8 }));
              scroller.scrollTop = Math.max(1, Math.floor((scroller.scrollHeight - scroller.clientHeight) * 0.2));
              proof.startTop = scroller.scrollTop;
              proof.previousTop = scroller.scrollTop;
              proof.listener = () => {
                const jump = Math.abs(scroller.scrollTop - proof.previousTop);
                proof.largestJump = Math.max(proof.largestJump, jump);
                proof.previousTop = scroller.scrollTop;
                proof.scrollEvents += 1;
              };
              scroller.addEventListener('scroll', proof.listener);
              Element.prototype.scrollIntoView = function (...args) {
                proof.forcedAnchorCalls += 1;
                return originalScrollIntoView.apply(this, args);
              };
              proof.interval = window.setInterval(() => {
                scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 8 }));
                const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 8);
                scroller.scrollTop = Math.min(maxTop, scroller.scrollTop + 3);
                proof.gestureSteps += 1;
              }, 32);
              window.__streamingScrollProof = proof;
              return true;
            })()`);
            ctx.assert(installed, "Could not install the transcript scroll witness.");
            await new Promise((resolve) => setTimeout(resolve, 2_500));
          },
          assert: async () => {
            const metrics = await ctx.eval(`(() => {
              const proof = window.__streamingScrollProof;
              if (!proof) return null;
              clearInterval(proof.interval);
              proof.scroller.removeEventListener('scroll', proof.listener);
              Element.prototype.scrollIntoView = proof.originalScrollIntoView;
              proof.endTop = proof.scroller.scrollTop;
              proof.assistantCharsAtEnd = document.querySelector('[data-message-role="assistant"]')?.innerText.length || 0;
              const result = {
                forcedAnchorCalls: proof.forcedAnchorCalls,
                scrollEvents: proof.scrollEvents,
                gestureSteps: proof.gestureSteps,
                assistantCharsAtStart: proof.assistantCharsAtStart,
                assistantCharsAtEnd: proof.assistantCharsAtEnd,
                startTop: proof.startTop,
                endTop: proof.endTop,
                largestJump: proof.largestJump,
              };
              delete window.__streamingScrollProof;
              return result;
            })()`);

            ctx.assert(metrics, "No streaming scroll metrics were recorded.");
            ctx.assert(metrics.gestureSteps >= 60, `Expected continuous wheel gestures: ${JSON.stringify(metrics)}`);
            ctx.assert(metrics.scrollEvents >= 20, `Expected real transcript scroll events: ${JSON.stringify(metrics)}`);
            ctx.assert(metrics.assistantCharsAtEnd > metrics.assistantCharsAtStart, `Assistant output did not grow during scrolling: ${JSON.stringify(metrics)}`);
            ctx.assert(metrics.endTop > metrics.startTop, `Transcript did not follow the downward gesture: ${JSON.stringify(metrics)}`);
            ctx.assert(metrics.forcedAnchorCalls === 0, `Manual scrolling triggered forced anchors: ${JSON.stringify(metrics)}`);
            ctx.assert(metrics.largestJump <= 12, `Transcript position jumped during continuous scrolling: ${JSON.stringify(metrics)}`);
            ctx.log(`scroll metrics: ${JSON.stringify(metrics)}`);

            const stopAction = await ctx.eval(
              `window.__ipolloworkControl.listActions().find((action) => action.id === "composer.stop")`,
            );
            if (stopAction && !stopAction.disabled) {
              await ctx.control("composer.stop");
            }
          },
          screenshot: {
            name: "stable-streaming-scroll",
            requireText: ["滚动稳定性验证", "稳定输出"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};
