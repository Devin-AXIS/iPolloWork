import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, evaluate, pickAppTarget } from '../runner/cdp.mjs';

// Drive this flow on a dedicated preview browser, never the user's app target.
// The records are produced by real engine runs; no model responses are mocked.
export default {
  id: 'artifact-media-delivery',
  title: 'Real engine media files, placement and delivery checks',
  kind: 'user-facing',
  preserveTheme: true,
  requiredEnv: ['IPOLLOWORK_MEDIA_EVAL_SESSIONS'],
  steps: [{
    name: 'Validate real model artifacts and render their visual pages',
    run: async ctx => {
      const records = JSON.parse(await readFile(ctx.env.IPOLLOWORK_MEDIA_EVAL_SESSIONS, 'utf8'));
      const validRecords = [];
      const skippedRecords = [];
      for (const record of records) {
        try {
          const brief = JSON.parse(await readFile(resolve(record.root, record.briefPath), 'utf8'));
          const source = resolve(record.root, record.entry);
          if (brief.mediaOutcomes?.some(item => ['generated', 'reused'].includes(item.status)) && brief.mediaPlan && await readFile(source)) {
            validRecords.push(record);
          } else {
            skippedRecords.push(`${record.engine}/${record.mode}: no completed media outcome`);
          }
        } catch {
          skippedRecords.push(`${record.engine}/${record.mode}: source or brief is unavailable`);
        }
      }
      const app = await connect((await pickAppTarget(ctx.env.IPOLLOWORK_MEDIA_APP_CDP || 'http://127.0.0.1:9823')).webSocketDebuggerUrl);
      const request = (path, body) => evaluate(app, `(async()=>{
        const base=localStorage.getItem('ipollowork.server.urlOverride')||localStorage.getItem('ipollowork.server.active');
        const response=await fetch(base+${JSON.stringify(path)},{method:${JSON.stringify(body ? 'POST' : 'GET')},headers:{Authorization:'Bearer '+localStorage.getItem('ipollowork.server.token'),'Content-Type':'application/json'},${body ? `body:JSON.stringify(${JSON.stringify(body)})` : ''}});
        if(!response.ok)throw Error('Media acceptance API failed: '+response.status);
        return response.json();
      })()`, { awaitPromise: true });
      try {
        ctx.assert(validRecords.length >= 4, `Expected four completed real runs, got ${validRecords.length}`);
        ctx.output('Runs not included in the rendered proof', JSON.stringify(skippedRecords, null, 2));
        await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 800, deviceScaleFactor: 1, mobile: false });
        for (const record of validRecords) {
          await ctx.prove(`${record.engine} / ${record.mode}: real local media is placed in the PPT`, {
            action: async () => {
              const response = await request('/experimental/extensions/call', {
                extensionId: 'media', action: 'artifact_media_review',
                args: { phase: 'check', sourcePath: record.entry },
                context: { workspaceId: record.workspace, sessionId: record.sessionId },
              });
              ctx.output(`${record.engine} ${record.mode} host checkpoint`, JSON.stringify(response, null, 2));
              ctx.assert(response.result?.complete === true, 'The host must verify all planned assets, not merely report a fallback');
              const brief = JSON.parse(await readFile(resolve(record.root, record.briefPath), 'utf8'));
              ctx.assert(brief.mediaOutcomes?.some(item => ['generated', 'reused'].includes(item.status)), 'At least one actual image must be delivered');
              await ctx.client.send('Page.navigate', { url: pathToFileURL(resolve(record.root, record.entry)).href });
              await ctx.waitFor(`document.readyState==='complete' && document.querySelectorAll('[data-ipw-slide]').length>=3`);
              await ctx.waitFor(`[...document.images].every(image=>image.complete&&image.naturalWidth>0)`);
              // Slides are normally isolated by Design Studio. Reproduce only
              // that visibility behavior, retaining authored geometry and CSS.
              await ctx.eval(`(() => {
                const slides=[...document.querySelectorAll('[data-ipw-slide]')];
                const selected=slides.find(slide=>slide.querySelector('img'));
                for(const slide of slides)slide.style.display=slide===selected?'block':'none';
                return Boolean(selected);
              })()`);
            },
            assert: async () => {
              const result = await ctx.eval(`(() => {
                const slides=[...document.querySelectorAll('[data-ipw-slide]')];
                const visible=slides.find(slide=>getComputedStyle(slide).display!=='none');
                const rect=visible?.getBoundingClientRect();
                const image=[...visible.querySelectorAll('img')].find(image=>{const r=image.getBoundingClientRect();return image.naturalWidth>0&&r.width>100&&r.height>100;});
                return {count:slides.length,empty:slides.filter(slide=>slide.textContent.trim().length<10).length,visibleText:visible.innerText,image:Boolean(image),width:rect?.width,height:rect?.height};
              })()`);
              ctx.output('Rendered slide inspection', JSON.stringify(result, null, 2));
              ctx.assert(result.empty === 0 && result.visibleText.trim().length > 10, 'Slides must contain readable authored content');
              ctx.assert(result.image && result.width > 600 && result.height > 300, 'A real generated/reused image must visibly occupy the rendered slide');
            },
            screenshot: { name: `${record.engine}-${record.mode}-visual` },
          });
        }
        const uiRun = validRecords.find(record => record.dispatch === 'client-composer');
        if (uiRun) {
          const checks = await evaluate(app, 'window.__mediaDeliveryChecks || []');
          ctx.output('Observed client completion checks', JSON.stringify(checks, null, 2));
          ctx.assert(checks.some(check => check.args.sourcePath === uiRun.entry && check.response?.result?.fileCanBeDelivered === true), 'The real composer must invoke the host media check before completing delivery');
          const preview = ctx.client;
          try {
            ctx.client = app;
            await ctx.prove('The client performs the media checkpoint for a real template task', {
              assert: async () => ctx.assert(await ctx.eval(`location.hash.includes(${JSON.stringify(uiRun.sessionId)})`), 'The client must show the verified template task'),
              screenshot: { name: 'client-template-media-delivery' },
            });
          } finally { ctx.client = preview; }
        }
      } finally { app.close(); }
    },
  }],
};
