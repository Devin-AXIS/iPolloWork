import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '../..');
let library;
let layouts;

// Preview the server's actual session snapshot, not a separately assembled fixture.
export default {
  id: 'ppt-layout-library',
  title: 'PPT catalog layouts materialize and render independently',
  kind: 'user-facing',
  preserveTheme: true,
  steps: [{
    name: 'Materialize the library through the template service',
    run: async (ctx) => {
      const root = resolve(ctx.outDir, 'workspace');
      await mkdir(root, { recursive: true });
      const source = pathToFileURL(join(repo, 'apps/server/src/templates.ts')).href;
      const output = execFileSync('bun', ['--eval', `
        import { installBundledTemplate, materializeTemplate } from ${JSON.stringify(source)};
        const root = ${JSON.stringify(root)};
        const config = {host:'127.0.0.1',port:0,token:'test',hostToken:'host',approval:{mode:'auto',timeoutMs:1000},corsOrigins:['*'],workspaces:[],authorizedRoots:[root],readOnly:false,startedAt:Date.now(),tokenSource:'env',hostTokenSource:'env',logFormat:'pretty',logRequests:false};
        const workspace = {id:'preview',name:'Preview',path:root,preset:'default',workspaceType:'local'};
        await installBundledTemplate(config, workspace.id, 'ipollowork.pptx-brand-narrative');
        const {state} = await materializeTemplate(config, workspace, 'ipollowork.pptx-brand-narrative', 'layout-library');
        console.log(JSON.stringify(state));
      `], { cwd: repo, encoding: 'utf8', env: { ...process.env, IPOLLOWORK_RUNTIME_DB: join(root, 'runtime.sqlite'), IPOLLOWORK_BUNDLED_TEMPLATES_DIR: join(repo, 'apps/server/bundled-templates') } });
      ctx.output('Materialized session', output);
      library = join(root, 'design/layout-library/core-v1-slides');
      const catalog = await readFile(join(library, 'catalog.md'), 'utf8');
      layouts = [...catalog.matchAll(/^\| `([^`]+\.html)`/gm)].map((match) => match[1]);
      ctx.assert(layouts.length === 10, 'The materialized catalog exposes all ten layouts');
      const guide = await readFile(join(library, 'layout.md'), 'utf8');
      for (const file of layouts) ctx.assert(guide.includes('`' + file + '`'), `The guide covers ${file}`);
      ctx.assert(!/\p{Script=Han}/u.test(guide), 'The materialized layout guide is English');
      ctx.output('Layout guide', guide);

      await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1328, height: 768, deviceScaleFactor: 1, mobile: false });
    },
  }, {
    name: 'Inspect every independent layout at its native canvas size',
    run: async (ctx) => {
      for (const file of layouts) {
        const id = file.replace('.html', '');
        await ctx.prove(`${id}: materialized layout loads styled, editable and within the slide`, {
          action: async () => {
            await ctx.client.send('Page.navigate', { url: pathToFileURL(join(library, file)).href });
            await ctx.waitFor(`document.querySelector('[data-layout="${id}"]') && document.styleSheets.length > 0 && document.readyState === 'complete'`);
            await ctx.eval('document.fonts.ready.then(() => true)');
          },
          assert: async () => { await verifySlide(ctx); },
          screenshot: { name: id },
        });
      }
    },
  }, {
    name: 'Validate theme inheritance, longer Chinese titles and the image slot',
    run: async (ctx) => {
      for (const file of layouts.slice(4)) {
        const id = file.replace('.html', '');
        await ctx.prove(`${id}: a new theme and a longer title preserve readable bounds`, {
          action: async () => {
            await ctx.client.send('Page.navigate', { url: pathToFileURL(join(library, file)).href });
            await ctx.waitFor(`document.querySelector('[data-layout="${id}"]') && document.readyState === 'complete'`);
            await ctx.eval(`(() => {
              document.documentElement.style.setProperty('--ipw-color-bg','#102638');
              document.documentElement.style.setProperty('--ipw-color-surface','#173449');
              document.documentElement.style.setProperty('--ipw-color-text','#f6f3e9');
              document.documentElement.style.setProperty('--ipw-color-muted','#c4d3df');
              document.documentElement.style.setProperty('--ipw-color-border','#738998');
              document.documentElement.style.setProperty('--ipw-color-primary','#375d6b');
              document.documentElement.style.setProperty('--ipw-font-display','system-ui, sans-serif');
              document.querySelector('h2').textContent='从真实观察走向行动，让每一个结论都有清晰的依据';
              const slot=document.querySelector('.visual-slot');
              if (slot) {
                const image=document.createElement('img');
                image.className='visual-slot'; image.dataset.slot='visual'; image.dataset.pptxImage='';
                image.alt='离线测试图：验证真实图片节点与裁切';
                image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#edd7a7"/><circle cx="580" cy="170" r="72" fill="#bb694f"/><path d="M0 600V380L240 180L540 600Z" fill="#456b65"/><path d="M250 600L650 260L800 390V600Z" fill="#759078"/></svg>');
                slot.replaceWith(image);
              }
            })()`);
            await ctx.waitFor('[...document.images].every(image => image.complete && image.naturalWidth > 0)');
          },
          assert: async () => {
            await verifySlide(ctx);
            ctx.assert(await ctx.eval(`getComputedStyle(document.querySelector('section')).backgroundColor === 'rgb(16, 38, 56)'`), 'The layout inherits the target theme');
            if (id === 'editorial-visual') ctx.assert(await ctx.eval(`Boolean(document.querySelector('img[data-pptx-image]:not([data-pptx-shape])'))`), 'The image replaces the placeholder with the editable image marker');
          },
          screenshot: { name: `${id}-theme-and-content`, requireText: ['从真实观察走向行动'] },
        });
      }
    },
  }],
};

async function verifySlide(ctx) {
  const result = await ctx.eval(`(() => {
    const slide=document.querySelector('[data-ipw-slide]');
    const canvas=slide.getBoundingClientRect();
    const text=[...slide.querySelectorAll('[data-pptx-text]')];
    const failures=[];
    if (Math.abs(canvas.width-1280)>1 || Math.abs(canvas.height-720)>1) failures.push('canvas');
    if (getComputedStyle(slide).paddingLeft !== '56px') failures.push('stylesheet');
    const rects=text.map(el => {
      const r=el.getBoundingClientRect();
      if (r.left<canvas.left-1 || r.right>canvas.right+1 || r.top<canvas.top-1 || r.bottom>canvas.bottom+1) failures.push('outside: '+el.dataset.slot);
      if (el.scrollWidth>el.clientWidth+2 || el.scrollHeight>el.clientHeight+2) failures.push('overflow: '+el.dataset.slot);
      // Range measures inline text too; inline elements have zero clientWidth.
      const range=document.createRange();range.selectNodeContents(el);
      return {el,r:range.getBoundingClientRect()};
    });
    for (let i=0;i<rects.length;i++) for (let j=i+1;j<rects.length;j++) {
      const a=rects[i], b=rects[j];
      if (a.el.contains(b.el)||b.el.contains(a.el)) continue;
      if (Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1 && Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1) failures.push('overlap: '+a.el.dataset.slot+'/'+b.el.dataset.slot);
    }
    return {failures,textCount:text.length,source:slide.dataset.layoutSource};
  })()`);
  ctx.assert(result.textCount >= 3 && result.failures.length === 0, JSON.stringify(result));
  ctx.output('Layout geometry', JSON.stringify(result));
}
