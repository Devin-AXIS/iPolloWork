import { readFile } from "node:fs/promises";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("session-compaction");
const health = "[data-testid=composer-context-health]";
const compact = "[data-testid=composer-compact-session]";
const popup = "[data-slot=popover-content]";
let fixture;

async function openSession(ctx, id) {
  await ctx.control("session.open", { sessionId: id });
  await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="${id}"] ${health}'))`);
}
async function openHealth(ctx) {
  await ctx.eval(`(() => { const control=document.querySelector(${JSON.stringify(health)}); if(control?.getAttribute("aria-expanded") !== "true") control?.click(); })()`);
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(popup)}))`);
}
const popupText = `document.querySelector('${popup}')?.innerText || ''`;
const screenshot = (name) => ({ name, fromSurface: true, rejectText: ["Something went wrong"] });

export default {
  id: "session-compaction",
  title: "Native compaction, busy and failure feedback, and saved OpenCode settings",
  kind: "user-facing",
  cdpTarget: { urlIncludes: process.env.IPOLLOWORK_EVAL_COMPACTION_ORIGIN || "127.0.0.1:5174" },
  precondition: async (ctx) => {
    const metadata = process.env.IPOLLOWORK_EVAL_COMPACTION_FIXTURE;
    if (!metadata) return "Run evals/support/session-compaction.ts and set IPOLLOWORK_EVAL_COMPACTION_FIXTURE to its metadata JSON.";
    fixture = JSON.parse(await readFile(metadata, "utf8"));
    const prepared = await fetch(fixture.newSessionUrl, { method: "POST" });
    if (!prepared.ok) throw new Error("Could not prepare a fresh native compaction session.");
    fixture.standardSessionId = (await prepared.json()).standardSessionId;
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
    await ctx.control("route.session");
    await ctx.waitFor(`Boolean(document.querySelector('[data-testid=project-new-conversation-button][data-project-id="${fixture.workspaceId}"]'))`);
    await ctx.eval(`document.querySelector('[data-testid=project-new-conversation-button][data-project-id="${fixture.workspaceId}"]').click()`);
    await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes(${JSON.stringify(fixture.workspaceId)})`);
    await ctx.waitFor(`window.__ipolloworkControl.listActions().some(a => a.id === "session.open")`);
    return null;
  },
  steps: [{
    name: "Native compaction journey",
    run: async (ctx) => {
      await ctx.prove("Supported native session exposes context details and compaction", {
        voiceover: vo[0],
        action: async () => { await openSession(ctx, fixture.standardSessionId); await openHealth(ctx); },
        assert: async () => {
          await ctx.waitFor(`Boolean(document.querySelector('${compact}') && !document.querySelector('${compact}').disabled)`);
          ctx.assert(/Current context|当前上下文/.test(await ctx.eval(popupText)), "Context details are visible.");
        }, screenshot: screenshot("available"),
      });
      await ctx.prove("Native compaction locks duplicate compaction and sending until completion", {
        voiceover: vo[1],
        action: async () => {
          await ctx.eval(`document.querySelector('${compact}').click()`);
          await ctx.waitFor(`/正在压缩|Compacting/.test(${popupText})`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('${compact}')?.disabled === true`), "Duplicate compaction disabled.");
          ctx.assert(await ctx.eval(`Array.from(document.querySelectorAll('button')).filter(e => /运行任务|Run task/.test(e.getAttribute('title') || '')).every(e => e.disabled)`), "Composer cannot send during compaction.");
        }, screenshot: screenshot("running"),
      });
      await ctx.prove("Completed native summary refreshes context without a synthetic user command", {
        voiceover: vo[2],
        action: async () => { await ctx.waitFor(`/会话压缩完成|compaction completed/i.test(${popupText})`, { timeoutMs: 30_000 }); },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('${compact}')?.disabled === false`), "Compaction available again after completion.");
          ctx.assert(!await ctx.eval(`Array.from(document.querySelectorAll('[data-message-role=user]')).some(e => e.innerText.trim() === '/compact')`), "Native command is not added as a user prompt.");
          const state = await (await fetch(fixture.fixtureStateUrl)).json();
          ctx.assert(state.compactions > 0, "Actual native compaction called the local model.");
        }, screenshot: screenshot("complete"),
      });
      await ctx.prove("A follow-up runs normally and blocks compaction while busy", {
        voiceover: vo[3],
        action: async () => {
          await ctx.eval(`document.querySelector('${health}').click()`);
          await ctx.waitFor("Boolean(document.querySelector('[contenteditable=true]'))");
          await ctx.eval(`(() => { const e=document.querySelector('[contenteditable=true]');e.focus();const d=new DataTransfer();d.setData('text/plain',${JSON.stringify('请复述之前保存的项目代号。\n' + 'Preserve the native checkpoint and continue reviewing the same project decisions. '.repeat(240))});e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d})); })()`);
          await ctx.waitFor(`Array.from(document.querySelectorAll('button')).some(e => /运行任务|Run task/.test(e.getAttribute('aria-label') || e.getAttribute('title') || '') && !e.disabled)`);
          await ctx.eval(`Array.from(document.querySelectorAll('button')).find(e => /运行任务|Run task/.test(e.getAttribute('aria-label') || e.getAttribute('title') || '') && !e.disabled).click()`);
          await openHealth(ctx);
          await ctx.waitFor(`document.querySelector('${compact}')?.disabled === true`);
        },
        assert: async () => { ctx.assert(/等待当前任务|Wait for the current task/.test(await ctx.eval(popupText)), "Busy reason is visible."); },
        screenshot: screenshot("task-busy"),
      });
      await ctx.prove("Native conversation continues and survives reopening", {
        voiceover: vo[4],
        action: async () => {
          await ctx.waitFor(`Array.from(document.querySelectorAll('[data-message-role=assistant]')).at(-1)?.innerText.includes(${JSON.stringify(fixture.expectedContinuityAnswer)})`, { timeoutMs: 30_000 });
          await ctx.waitFor(`document.querySelector('${compact}')?.disabled === false`);
          await ctx.eval("location.reload()");
          await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
          await ctx.waitFor(`Boolean(document.querySelector('${health}'))`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`window.__ipolloworkControl.snapshot().route.includes(${JSON.stringify(fixture.standardSessionId)})`), "Same session restored.");
          await ctx.waitFor(`Array.from(document.querySelectorAll('[data-message-role=assistant]')).at(-1)?.innerText.includes(${JSON.stringify(fixture.expectedContinuityAnswer)})`);
          const state = await (await fetch(fixture.fixtureStateUrl)).json();
          ctx.assert(state.lastOrdinaryRequestSawCheckpoint && state.lastOrdinaryRequestSawKnownFact, "Native follow-up carries the saved compaction checkpoint and known fact.");
        }, screenshot: screenshot("continued-and-reopened"),
      });
      await ctx.prove("Native summary failure shows error and releases the control", {
        voiceover: vo[5],
        action: async () => {
          await fetch(fixture.failNextCompactionUrl, { method: "POST" });
          await openHealth(ctx);
          await ctx.eval(`document.querySelector('${compact}').click()`);
          await ctx.waitFor(`Boolean(document.querySelector('${popup} [role=alert]'))`, { timeoutMs: 30_000 });
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('${compact}')?.disabled === false`), "Control released after failure.");
          ctx.assert(!/会话压缩完成|compaction completed/i.test(await ctx.eval(popupText)), "Failure is not shown as success.");
        }, screenshot: screenshot("failed"),
      });
      await ctx.prove("Unsupported DSH preset explains capability instead of offering a broken action", {
        voiceover: vo[6],
        action: async () => { await ctx.eval(`document.querySelector('${health}').click()`); await openSession(ctx, fixture.minimalSessionId); await openHealth(ctx); },
        assert: async () => {
          ctx.assert(!await ctx.eval(`Boolean(document.querySelector('${compact}'))`), "Unsupported session has no compaction action.");
          ctx.assert(/不支持压缩|does not support compaction/.test(await ctx.eval(popupText)), "Unsupported explanation is visible.");
        }, screenshot: screenshot("unsupported"),
      });
      await ctx.prove("OpenCode automatic setting is scoped and survives reopen", {
        voiceover: vo[7],
        action: async () => {
          await ctx.control("route.settings.general");
          await ctx.waitFor("document.body.innerText.includes('偏好') || document.body.innerText.includes('Preferences')");
          ctx.assert(!await ctx.eval(`Boolean(document.querySelector('[role=switch][aria-label="自动上下文压缩"], [role=switch][aria-label="Auto context compaction"]'))`), "OpenCode switch is absent for DSH.");
          await ctx.control("route.session");
          await ctx.eval(`document.querySelector('[data-testid=project-new-conversation-button][data-project-id="${fixture.openCodeWorkspaceId}"]').click()`);
          await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes(${JSON.stringify(fixture.openCodeWorkspaceId)})`);
          await ctx.control("route.settings.general");
          const selector = '[role=switch][aria-label="自动上下文压缩"], [role=switch][aria-label="Auto context compaction"]';
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).matches('[data-disabled], [aria-disabled=true]'))`);
          await ctx.eval(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(e.getAttribute("aria-checked") === "false") e.click();})()`);
          await ctx.waitFor(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked') === 'true' && !document.querySelector(${JSON.stringify(selector)}).matches('[data-disabled], [aria-disabled=true]')`);
          await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
          await ctx.waitFor(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked') === 'false' && !document.querySelector(${JSON.stringify(selector)}).matches('[data-disabled], [aria-disabled=true]')`);
          await ctx.eval("location.reload()");
          await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).matches('[data-disabled], [aria-disabled=true]') && document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked') === 'false')`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('[role=switch][aria-label="自动上下文压缩"], [role=switch][aria-label="Auto context compaction"]')?.getAttribute('aria-checked') === 'false'`), "Saved switch state restored.");
          const saved = await (await fetch(`${fixture.baseUrl}/workspace/${fixture.openCodeWorkspaceId}/config`, { headers: { authorization: `Bearer ${fixture.token}` } })).json();
          ctx.assert(saved.opencode?.compaction?.auto === false, "Server saved OpenCode auto:false.");
        }, screenshot: screenshot("settings-persisted"),
      });
    },
  }],
};
