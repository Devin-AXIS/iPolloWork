import { createServer } from 'node:http';
import { connect, debuggerUrlFor, evaluate, listTargets } from '../runner/cdp.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

const vo = await loadVoiceoverParagraphs('agent-browser');
const editor = '<label>Title<input id="title" value="Initial draft"></label><button onclick="document.querySelector(\'#result\').textContent=\'Preview ready: \'+document.querySelector(\'#title\').value">Preview</button><button onclick="document.querySelector(\'#result\').textContent=\'Opened details\'">Details</button><p id="result">Waiting for an action</p>';

async function setup(ctx) {
  await ctx.waitFor("window.__ipolloworkControl?.listActions().some(a => a.id === 'session.create_task' && !a.disabled)", { timeoutMs: 60_000 });
  await ctx.control('session.create_task');
  const route = await ctx.waitFor("location.hash.split('/session/')[1]?.split('/')[0]", { timeoutMs: 30_000 });
  const info = await ctx.eval('window.__IPOLLOWORK_ELECTRON__.invokeDesktop("ipolloworkServerInfo")', { awaitPromise: true });
  const status = await fetch(`${info.baseUrl}/status`, { headers: { authorization: `Bearer ${info.clientToken}` } }).then(r => r.json());
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>${request.url === '/human' ? 'My browsing' : 'Agent task'}</title><style>body{font:16px system-ui;margin:32px;color:#202020;background:#fafafa}label,input,button{display:block;margin:16px 0}input{padding:12px;width:80%;font:inherit}button{padding:12px 20px;font:inherit;border-radius:10px}p{padding:18px;background:#eaf4ef}</style><h1>${request.url === '/human' ? 'My browsing' : 'Agent task'}</h1>${editor}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const workspaceId = await ctx.eval("location.hash.split('/workspace/')[1]?.split('/')[0]");
  ctx.agentBrowser = { info, context: { workspaceId: workspaceId || status.activeWorkspaceId, sessionId: decodeURIComponent(route) }, server,
    url: `http://127.0.0.1:${server.address().port}`, task: null, human: null };
}

async function host(ctx, name, args = {}, { allowError = false } = {}) {
  const { info, context } = ctx.agentBrowser;
  const response = await fetch(`${info.baseUrl}/engine-tools/call`, {
    method: 'POST', headers: { authorization: `Bearer ${info.clientToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `ipollowork_browser_${name}`, args, context }),
  });
  const result = await response.json();
  if (!allowError) ctx.assert(response.ok, `Host browser ${name}: ${result.message ?? result.error ?? response.status}`);
  return { ...result, httpStatus: response.status };
}

async function page(ctx, suffix, expression, input = null) {
  const url = `${ctx.agentBrowser.url}${suffix}`;
  const deadline = Date.now() + 5000;
  let target;
  while (Date.now() < deadline) {
    target = (await listTargets(ctx.cdpBaseUrl)).find(t => t.url === url && t.webSocketDebuggerUrl);
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  ctx.assert(target, `Fixture browser target is missing: ${suffix}`);
  const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
  try {
    if (input !== null) {
      await evaluate(client, "document.querySelector('#title').focus(); document.querySelector('#title').select(); true");
      await client.send('Input.insertText', { text: input });
    }
    return await evaluate(client, expression, { awaitPromise: true });
  } finally { client.close(); }
}

async function click(ctx, selector) {
  await ctx.waitFor(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
}

async function showTab(ctx, tabId) {
  if (await ctx.eval('Boolean(document.querySelector(\'button[aria-label="Open right panel"], button[aria-label="打开右侧面板"]\'))')) await click(ctx, 'button[aria-label="Open right panel"], button[aria-label="打开右侧面板"]');
  if (!(await ctx.eval(`Boolean(document.getElementById(${JSON.stringify(tabId)}))`))) {
    await click(ctx, 'button[aria-label="添加侧面板入口"], button[aria-label="Add side panel entry"]');
    await ctx.clickText('网页', { selector: '[role="menuitem"]' });
  }
  await click(ctx, `[id="${tabId}"] button[aria-label^="Select tab:"]`);
  await ctx.waitFor(`document.querySelector('[id="${tabId}"] button[aria-selected="true"]') !== null`);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await ctx.eval('window.__IPOLLOWORK_ELECTRON__.browser.getState()', { awaitPromise: true });
    if (state.activeTabId === tabId) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  ctx.assert(false, `Native browser did not select ${tabId}`);
}

function snapshot(ctx) { return host(ctx, 'snapshot', { tabId: ctx.agentBrowser.task.tabId }); }
function act(ctx, observation, actions, extra = {}, options = {}) { return host(ctx, 'act', { tabId: ctx.agentBrowser.task.tabId, snapshotId: observation.snapshotId, actions, ...extra }, options); }
const titleTarget = { role: 'textbox', name: 'Title' };
const previewTarget = { role: 'button', name: 'Preview' };

export default {
  id: 'agent-browser', title: '人和 Agent 并行浏览、随时接管，JEV 按需启用', kind: 'user-facing',
  steps: [
    { name: 'Normal browser tools work without JEV', run: async ctx => {
      await setup(ctx);
      await ctx.prove('Default browser browsing and host actions work without a JEV connection', {
        voiceover: vo[0], action: async () => {
          ctx.agentBrowser.task = await host(ctx, 'open_url', { url: `${ctx.agentBrowser.url}/agent` });
          await showTab(ctx, ctx.agentBrowser.task.tabId);
          const state = await snapshot(ctx);
          ctx.agentBrowser.first = await act(ctx, state, [
            { type: 'fill', target: titleTarget, value: 'Without JEV' }, { type: 'click', target: previewTarget },
          ], { observe: { settleMs: 100 } });
        }, assert: async () => {
          const tabs = await host(ctx, 'list_tabs');
          ctx.assert(tabs.tabs.find(t => t.id === ctx.agentBrowser.task.tabId)?.decisionEngine === 'agent', 'Default decision engine must be Agent');
          ctx.assert(ctx.agentBrowser.first.status === 'executed', 'Unverified actions must not claim result verification');
          ctx.assert(await page(ctx, '/agent', "document.querySelector('#result').textContent") === 'Preview ready: Without JEV', 'Real page preview did not update');
        }, screenshot: { name: 'browser-without-jev', fromSurface: false, requireText: ['动作已执行'] },
      });
    } },
    { name: 'Background input preserves the user page and focus', run: async ctx => {
      await ctx.prove('The task updates in the background while the user keeps browsing and typing', {
        voiceover: vo[1], action: async () => {
          ctx.agentBrowser.human = await ctx.eval(`window.__IPOLLOWORK_ELECTRON__.browser.createTab(${JSON.stringify(`${ctx.agentBrowser.url}/human`)}, {sessionId:${JSON.stringify(ctx.agentBrowser.context.sessionId)}})`, { awaitPromise: true });
          await showTab(ctx, ctx.agentBrowser.human.tabId);
          await page(ctx, '/human', 'document.activeElement.id', 'My unfinished input');
          const state = await snapshot(ctx);
          await act(ctx, state, [{ type: 'fill', target: titleTarget, value: 'Background work' }, { type: 'click', target: previewTarget }], { observe: { settleMs: 100 } });
        }, assert: async () => {
          const state = await ctx.eval('window.__IPOLLOWORK_ELECTRON__.browser.getState()', { awaitPromise: true });
          ctx.assert(state.activeTabId === ctx.agentBrowser.human.tabId, 'Agent changed the active native page');
          const selected = await ctx.eval(`document.querySelector('[id="${ctx.agentBrowser.human.tabId}"] button')?.getAttribute('aria-selected')`);
          ctx.assert(selected === 'true', 'Agent changed the selected UI tab');
          const human = await page(ctx, '/human', '({focus:document.activeElement.id,value:document.querySelector("#title").value})');
          ctx.assert(human.focus === 'title' && human.value === 'My unfinished input', 'Agent stole page focus or modified user input');
          ctx.assert(await page(ctx, '/agent', 'document.querySelector("#result").textContent') === 'Preview ready: Background work', 'Background real input did not complete');
        }, screenshot: { name: 'user-browses-while-agent-works', fromSurface: false, textTargetUrlIncludes: '/human', requireText: ['My browsing'] },
      });
    } },
    { name: 'Takeover interrupts an in-flight batch', run: async ctx => {
      await ctx.prove('Taking control cancels the running Agent batch before the next input', {
        voiceover: vo[2], action: async () => {
          await showTab(ctx, ctx.agentBrowser.task.tabId);
          const state = await snapshot(ctx);
          ctx.agentBrowser.oldSnapshot = state;
          const pending = act(ctx, state, [
            { type: 'waitFor', condition: 'text', value: 'A result that never appears', timeoutMs: 5000 },
            { type: 'fill', target: titleTarget, value: 'Must never be inserted' },
          ], {}, { allowError: true });
          await ctx.waitFor('document.querySelector("[data-browser-activity=acting]") !== null');
          await click(ctx, '[data-browser-control="agent"]');
          ctx.agentBrowser.interrupted = await pending;
          await page(ctx, '/agent', 'document.querySelector("#title").value', 'My manual correction');
        }, assert: async () => {
          ctx.assert(ctx.agentBrowser.interrupted.httpStatus >= 400, 'The in-flight batch was not interrupted');
          ctx.assert(await page(ctx, '/agent', 'document.querySelector("#title").value') === 'My manual correction', 'Agent overwrote manual input');
          await ctx.waitFor('document.querySelector("[data-browser-control=human]") !== null');
          const tabs = await host(ctx, 'list_tabs');
          ctx.assert(tabs.tabs.find(t => t.id === ctx.agentBrowser.task.tabId)?.controller === 'human', 'Host did not transfer control');
        }, screenshot: { name: 'user-takes-control', fromSurface: false, requireText: ['由你操作 · Agent 输入已暂停'] },
      });
    } },
    { name: 'Return control re-observes the current page', run: async ctx => {
      await ctx.prove('Returning control queues continuation in the same conversation and requires fresh page state', {
        voiceover: vo[3], action: async () => {
          await click(ctx, '[data-browser-control="human"]');
          await ctx.waitFor('document.querySelector("[data-browser-control=agent]") !== null');
          const stale = await act(ctx, ctx.agentBrowser.oldSnapshot, [{ type: 'fill', target: titleTarget, value: 'Stale input' }], {}, { allowError: true });
          ctx.assert(stale.httpStatus >= 400, 'Pre-takeover page references were accepted after resuming');
          const state = await snapshot(ctx);
          ctx.assert(state.tree.includes('My manual correction'), 'Fresh snapshot did not include the current user edit');
          await act(ctx, state, [{ type: 'click', target: previewTarget }], { observe: { settleMs: 100 } });
        }, assert: async () => {
          ctx.assert(await page(ctx, '/agent', 'document.querySelector("#result").textContent') === 'Preview ready: My manual correction', 'Continuation lost the user edit');
          const tabs = await host(ctx, 'list_tabs');
          ctx.assert(tabs.tabs.find(t => t.id === ctx.agentBrowser.task.tabId)?.controller === 'agent', 'Control was not returned');
          const text = await ctx.eval('document.body.innerText');
          ctx.assert(text.includes('我已经完成页面操作'), 'Return control did not queue the continuation message');
        }, screenshot: { name: 'agent-continues-from-user-edit', fromSurface: false, requireText: ['动作已执行'] },
      });
    } },
    { name: 'Batches observe and verify real outcomes', run: async ctx => {
      await ctx.prove('A bounded action batch distinguishes execution from an observed result', {
        voiceover: vo[4], action: async () => {
          const state = await snapshot(ctx);
          ctx.agentBrowser.verified = await act(ctx, state, [
            { type: 'fill', target: titleTarget, value: 'Verified result' }, { type: 'click', target: previewTarget },
          ], { expect: { condition: 'text', value: 'Preview ready: Verified result', timeoutMs: 1000 }, observe: { settleMs: 100 } });
        }, assert: async () => {
          const result = ctx.agentBrowser.verified;
          ctx.assert(result.status === 'verified' && result.results.length === 2 && result.observation.snapshotId, 'The bounded batch did not observe and verify its result');
          ctx.assert(await page(ctx, '/agent', 'document.querySelector("#result").textContent') === 'Preview ready: Verified result', 'The actual page result is incorrect');
          await ctx.waitFor('document.querySelector("[data-browser-activity=verified]") !== null');
        }, screenshot: { name: 'result-verified', fromSurface: false, requireText: ['结果已确认'] },
      });
    } },
    { name: 'Optional JEV does not block the browser', run: async ctx => {
      try {
        await ctx.prove('JEV opt-in displays unavailable state and ordinary Agent work remains usable', {
          voiceover: vo[5], action: async () => {
            await click(ctx, '[data-browser-decision="agent"]');
            await ctx.clickText('JEV · 可选', { selector: '[role="menuitemcheckbox"]' });
            await ctx.waitFor('document.querySelector("[data-browser-decision=jev]") !== null');
            await click(ctx, '[data-browser-decision="jev"]');
            ctx.agentBrowser.decision = await host(ctx, 'decide', { tabId: ctx.agentBrowser.task.tabId, goal: 'Preview the final draft', candidates: [
              { type: 'click', target: previewTarget }, { type: 'click', target: { role: 'button', name: 'Details' } },
            ] });
            const state = await snapshot(ctx);
            await act(ctx, state, [{ type: 'fill', target: titleTarget, value: 'Agent fallback works' }, { type: 'click', target: previewTarget }], {
              expect: { condition: 'text', value: 'Preview ready: Agent fallback works', timeoutMs: 1000 }, observe: { settleMs: 100 },
            });
          }, assert: async () => {
            ctx.assert(ctx.agentBrowser.decision.engine === 'agent' && ctx.agentBrowser.decision.status === 'unavailable', 'Missing JEV did not fall back honestly');
            await ctx.waitFor('document.querySelector("[data-browser-decision-status=unavailable]") !== null');
            ctx.assert(await page(ctx, '/agent', 'document.querySelector("#result").textContent') === 'Preview ready: Agent fallback works', 'Normal browser action failed after optional JEV was unavailable');
          }, screenshot: { name: 'jev-optional-fallback', fromSurface: false, requireText: ['JEV · 不可用，使用 Agent', '结果已确认'] },
        });
        await click(ctx, '[data-browser-decision="jev"]');
        await ctx.clickText('Agent · 默认', { selector: '[role="menuitemcheckbox"]' });
        const disabled = await host(ctx, 'decide', { tabId: ctx.agentBrowser.task.tabId, goal: 'Preview', candidates: [] });
        ctx.assert(disabled.status === 'disabled', 'Disabling JEV still invoked optional decision work');
      } finally { await new Promise(resolve => ctx.agentBrowser.server.close(resolve)); }
    } },
  ],
};
