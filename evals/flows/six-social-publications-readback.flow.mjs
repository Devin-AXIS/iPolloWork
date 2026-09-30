import { connect, debuggerUrlFor, evaluate, listTargets } from '../runner/cdp.mjs';

const tasks = [
  ['DeepSeek Harness · 抖音', 'ws_db87741caf02', 'session-423cd870-c270-434f-8b27-661558d14050', 'douyin-ops', '8d2e88c8-5686-4433-899c-2808566a152d', 'succeeded'],
  ['DeepSeek Harness · 视频号', 'ws_db87741caf02', 'session-0134d434-d4f4-47f1-8aaf-ff81e115f295', 'wechat-channels-ops', 'eca2ce83-f65a-4021-b1cc-eaa72df74005', 'submitted'],
  ['Codex Harness · 抖音', 'ws_952b823a8595', '01a0ecc9-a9d0-7591-97f1-66bd307f5ddb', 'douyin-ops', '58410039-8100-4604-9f04-dc53d321b2b6', 'succeeded'],
  ['Codex Harness · 视频号', 'ws_952b823a8595', '01a0ec97-f1ae-7042-9af3-f35fd90ed6de', 'wechat-channels-ops', 'a76b3114-43ac-40de-9e1f-a632450710d3', 'submitted'],
  ['OpenCode · 抖音', 'ws_b9696c675c05', 'ses_f13362fa5ffen9T5msAwCRZ3wh', 'douyin-ops', '92a4291a-4e0d-4fbc-9beb-789eec8a4f6d', 'succeeded'],
  ['OpenCode · 视频号', 'ws_b9696c675c05', 'ses_f13675299ffezI5Vmcx7p5p6le', 'wechat-channels-ops', 'bb35189b-1879-4abe-a0da-832a3b36ea98', 'submitted'],
];

async function studioText(ctx) {
  const origin = await ctx.eval("document.querySelector('iframe[title$=\"运营台\"]')?.src.split('#')[0] || ''");
  ctx.assert(origin.startsWith('http://127.0.0.1:'), 'The task has no local Studio iframe');
  const deadline = Date.now() + 20_000;
  let target;
  while (Date.now() < deadline) {
    target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.type === 'iframe' && item.url.startsWith(origin));
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  ctx.assert(target, 'The Studio iframe target was unavailable');
  const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
  try {
    return await evaluate(client, `(async () => {
      const works = [...document.querySelectorAll('button')].find(button => button.innerText.trim() === '作品');
      works?.click();
      await new Promise(resolve => setTimeout(resolve, 1200));
      return document.body.innerText;
    })()`, { awaitPromise: true });
  } finally {
    client.close();
  }
}

export default {
  id: 'six-social-publications-readback',
  title: 'Six real social-video publication receipts and task-owned Studios',
  kind: 'user-facing',
  steps: [{
    name: 'Read all six receipts and switch between task-owned Studios',
    run: async ctx => {
      await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 30_000, label: 'app ready' });
      let receipts;
      await ctx.prove('Six publication jobs have platform-accepted terminal receipts', {
        voiceover: '三个引擎各自向抖音和视频号提交了视频；六份回执都已经落盘，右侧显示当前抖音任务的运营台。',
        action: async () => {
          await ctx.navigateHash('/workspace/ws_b9696c675c05/session/ses_f13362fa5ffen9T5msAwCRZ3wh');
          await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"抖音运营台\"]'))", { timeoutMs: 30_000, label: 'Douyin Studio' });
          receipts = await ctx.eval(`(async () => {
            const tasks = ${JSON.stringify(tasks)};
            const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
            const headers = {
              authorization: 'Bearer ' + (info.ownerToken || info.clientToken),
              'X-iPolloWork-Host-Token': info.hostToken,
              'content-type': 'application/json',
            };
            const out = [];
            for (const [name, workspaceId, sessionId, extensionId, jobId] of tasks) {
              const response = await fetch(info.baseUrl + '/experimental/extensions/call', {
                method: 'POST', headers,
                body: JSON.stringify({ extensionId, action: 'get-job', args: { jobId }, context: { workspaceId, sessionId } }),
              });
              const payload = await response.json();
              out.push({ name, http: response.status, status: payload.result?.job?.status,
                publicationStatus: payload.result?.job?.result?.publicationStatus,
                linkStatus: payload.result?.job?.result?.linkStatus });
            }
            return out;
          })()`, { awaitPromise: true });
        },
        assert: async () => {
          ctx.assert(receipts.length === tasks.length, 'A publication receipt is missing');
          for (const [index, receipt] of receipts.entries()) {
            ctx.assert(receipt.http === 200 && receipt.status === tasks[index][5], `${receipt.name}: ${JSON.stringify(receipt)}`);
          }
          ctx.assert(receipts[4].linkStatus === 'unavailable', 'The invalid Douyin public link must remain quarantined');
          const text = await studioText(ctx);
          ctx.assert(text.includes('iPolloWork：想法到交付') && text.includes('播放'), 'Studio does not show the published work and read-back data');
          await ctx.output('six-publication-receipts', JSON.stringify(receipts, null, 2));
        },
        screenshot: { name: 'douyin-studio-readback', requireText: ['抖音运营台'], hashIncludes: '/session/ses_f13362fa5ffen9T5msAwCRZ3wh' },
      });

      await ctx.prove('Switching tasks restores only that task’s WeChat Channels Studio', {
        voiceover: '切到另一个任务，右侧换成视频号运营台，抖音任务的标签不会串到这里。',
        action: async () => {
          await ctx.navigateHash('/workspace/ws_b9696c675c05/session/ses_f13675299ffezI5Vmcx7p5p6le');
          await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"视频号运营台\"]'))", { timeoutMs: 30_000, label: 'WeChat Channels Studio' });
        },
        assert: async () => {
          const tabs = await ctx.eval("[...document.querySelectorAll('button[aria-label^=\"Select tab:\"]')].map(button => button.getAttribute('aria-label'))");
          ctx.assert(tabs.includes('Select tab: 视频号运营台') && !tabs.includes('Select tab: 抖音运营台'), JSON.stringify(tabs));
        },
        screenshot: { name: 'wechat-studio-isolated', requireText: ['视频号运营台'], hashIncludes: '/session/ses_f13675299ffezI5Vmcx7p5p6le' },
      });
    },
  }],
};
