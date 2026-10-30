import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, evaluate, listTargets } from '../runner/cdp.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
import createService from '../../examples/plugin-packages/short-video-studio/src/service.mjs';
import { addNode, uuid } from '../../examples/plugin-packages/short-video-studio/src/project.mjs';

const vo = await loadVoiceoverParagraphs('short-video-shared-ui');
const rootFor = mode => `${process.env.IPOLLOWORK_UI_TEST_ROOT_PREFIX || '/tmp/ipollowork-full-ui'}-${mode}`;
const previewPort = Number(process.env.IPOLLOWORK_UI_TEST_PORT || 5906);
async function key(parent, key) {
  for (const type of ['keyDown', 'keyUp']) await parent.send('Input.dispatchKeyEvent', { type, key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: { Enter: 13, Escape: 27, ArrowRight: 39, ArrowDown: 40, Home: 36, ' ': 32 }[key], ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) });
}
async function click(parent, frame, selector) {
  await evaluate(frame, `document.querySelector(${JSON.stringify(selector)}).focus()`);
  await key(parent, 'Enter');
}
async function frameFor(ctx, mode, previousTargets) {
  for (let attempt = 0; attempt < 80; attempt++) {
    for (const target of (await listTargets(ctx.cdpBaseUrl)).filter(t => t.type === 'iframe' && !previousTargets.has(t.id))) {
      const client = await connect(target.webSocketDebuggerUrl).catch(() => null);
      if (!client) continue;
      if (await evaluate(client, `window.ipolloworkUi?.mode===${JSON.stringify(mode)} && Boolean(document.querySelector('[aria-label="新建项目"]'))`).catch(() => false)) return client;
      client.close();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('Migrated plugin did not initialize');
}
async function fixture(mode) {
  const { actions } = await createService({ workspace: { root: rootFor(mode) }, storage: { dataDir: rootFor(mode) + '/private' }, host: { callAction: async () => { throw Error('No paid generation in UI fixture'); } } });
  let { project } = await actions['project-create']({ title: `完整迁移 ${mode} ${Date.now()}` });
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
  for (const filename of ['参考一.png', '参考二.png']) ({ project } = await actions['asset-upload']({ projectId: project.id, uploadId: uuid('u'), filename, total: Buffer.from(image, 'base64').length, offset: 0, data: image }));
  const video = addNode(project, 'video'); video.settings = { operation: 'reference', referenceIds: [project.assets[0].id] };
  addNode(project, 'image', { x: 360, y: 80 }); addNode(project, 'audio', { x: 640, y: 80 });
  project.shots = [{ id: uuid('s'), title: '验收分镜', prompt: '本地测试素材', narration: '验收字幕', duration: 2, assetId: project.assets[0].id }];
  project.roles = [{ id: uuid('r'), name: '验收角色', description: '本地角色设定', assetId: project.assets[0].id }];
  project.tracks = [{ id: uuid('t'), kind: 'caption', label: '字幕', clips: [{ id: uuid('c'), label: '验收字幕', text: '本地字幕', startFrame: 0, durationFrames: 60 }] }];
  ({ project } = await actions['project-save']({ project }));
  return project;
}
async function saved(mode, id) { return JSON.parse(await readFile(join(rootFor(mode), 'short-video', id, 'project.json'), 'utf8')); }
// Base UI owns aria-hidden form inputs; audit the plugin's visible controls.
const coverage = `(()=>{const controls=[...document.querySelectorAll('#app button,#app input:not([type=file]):not([aria-hidden=true]),#app textarea')];return !document.querySelector('#app select')&&controls.every(e=>!!e.dataset.slot||!!e.dataset.ipwReady)})()`;

export default {
  id: 'short-video-shared-ui', title: '短片工作台：七页完整共享控件迁移', kind: 'user-facing', preserveTheme: true,
  cdpTarget: { urlIncludes: '127.0.0.1' },
  steps: ['bundled', 'host'].map((mode, index) => ({ name: `${mode} 七页与保存恢复`, async run(ctx) {
    const project = await fixture(mode), parent = ctx.client;
    await parent.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const previousTargets = new Set((await listTargets(ctx.cdpBaseUrl)).map(t => t.id));
    await parent.send('Page.navigate', { url: `http://127.0.0.1:${previewPort + index}` });
    const frame = await frameFor(ctx, mode, previousTargets); ctx.client = frame;
    const shot = (name, requireText) => ({ name: mode + '-' + name, targetId: parent.targetId, textTargetId: frame.targetId, requireText });
    const tab = async name => { await click(parent, frame, `[data-action="tab:${name}"]`); await ctx.waitFor(`document.querySelector('[data-action="tab:${name}"]').getAttribute('aria-selected')==='true'`); await ctx.waitFor(coverage); };
    const choose = async (selector, label) => {
      await click(parent, frame, selector); await ctx.waitFor('Boolean(document.querySelector("[role=option]"))');
      await ctx.eval(`(()=>{const e=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('Option missing');e.focus()})()`); await key(parent, 'Enter');
      await ctx.waitFor('!document.querySelector("[data-slot=select-content][data-open]")');
      await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)})) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
      await ctx.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    };
    try {
      await ctx.waitFor(`document.body.textContent.includes(${JSON.stringify(project.title)})`);
      await ctx.prove('顶栏和工具栏共享控件尺寸一致', { voiceover: vo[0], action: async () => {
        await ctx.waitFor(coverage); await ctx.eval(`document.querySelector('[data-node="${project.nodes[0].id}"]').click()`); await ctx.waitFor('Boolean(document.querySelector(".inspector"))');
      }, assert: async () => {
        ctx.assert(await ctx.eval(coverage), 'all rendered controls shared');
        ctx.assert(await ctx.eval('window.ipolloworkUi.version==="1.3.0" && getComputedStyle(document.body).fontSize==="13px" && getComputedStyle(document.body).lineHeight==="20px"'), 'current runtime and public body typography');
        ctx.assert(await ctx.eval(`(()=>{const buttons=[...document.querySelectorAll('.topbar button,.floating-tools button')].filter(e=>e.getBoundingClientRect().height>0);return buttons.every(e=>[28,32].includes(e.getBoundingClientRect().height))})()`), 'explicit shared sizes');
        ctx.assert(await ctx.eval(`(()=>{const b=document.querySelector('[data-action=close-inspector]'),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return r.width===28&&r.height===28&&s.width===16&&s.height===16&&Math.abs(s.x+s.width/2-r.x-r.width/2)<.5&&Math.abs(s.y+s.height/2-r.y-r.height/2)<.5})()`), 'centered inspector close');
      }, screenshot: shot('controls', ['镜头意图']) });
      await ctx.prove('七页共享标签可切换并支持键盘', { voiceover: vo[1], action: async () => {
        for (const name of ['shots', 'script', 'roles', 'assets', 'tracks', 'jobs', 'canvas']) await tab(name);
        await ctx.eval('document.querySelector("[data-action=\\"tab:canvas\\"]").focus()'); await key(parent, 'ArrowRight'); await key(parent, 'Enter');
      }, assert: async () => {
        await ctx.waitFor('document.querySelector("[data-action=\\"tab:shots\\"]").getAttribute("aria-selected")==="true"');
        ctx.assert(await ctx.eval('document.querySelectorAll("[data-slot=tabs-trigger]").length===7 && Boolean(document.querySelector("[role=tablist]")) && document.querySelector("[role=tabpanel]")?.getAttribute("aria-labelledby") === "view-tab-shots" && document.querySelector("[role=tabpanel]").contains(document.querySelector("main"))'), 'shared accessible tabs with real content panel');
        ctx.assert((await saved(mode, project.id)).shots[0].title === '验收分镜', 'navigation preserves project');
      }, screenshot: shot('tabs', ['画面描述', '旁白 / 字幕']) });
      await ctx.prove('所有表单使用共享输入，保存失败保留并重试', { voiceover: vo[2], action: async () => {
        for (const name of ['shots', 'roles', 'tracks', 'script']) { await tab(name); ctx.assert(await ctx.eval('Boolean(document.querySelector("main [data-slot=input],main [data-slot=textarea]"))'), name + ' has shared fields'); }
        await evaluate(parent, `(()=>{window.__migrationFetch=fetch;window.__migrationFailed=false;window.fetch=async(...args)=>{if(args[0]==='/rpc'&&JSON.parse(args[1].body).name==='project-save'&&!window.__migrationFailed){window.__migrationFailed=true;return new Response(JSON.stringify({error:'验收：保存暂不可用'}),{headers:{'content-type':'application/json'}})}return window.__migrationFetch(...args)}})()`);
        await ctx.fill('[data-script]', '失败后保留的剧本'); await ctx.waitFor('Boolean(document.querySelector("[data-action=retry-save]"))');
        ctx.assert(await ctx.eval('document.querySelector("[data-script]").value==="失败后保留的剧本"'), 'failed autosave preserves draft');
        ctx.assert((await saved(mode, project.id)).script !== '失败后保留的剧本', 'injected failure did not persist');
        await click(parent, frame, '[data-action=retry-save]');
      }, assert: async () => {
        await ctx.waitFor('!document.querySelector("[data-action=retry-save]")');
        ctx.assert((await saved(mode, project.id)).script === '失败后保留的剧本', 'retry writes actual file');
        await evaluate(parent, 'window.fetch=window.__migrationFetch;delete window.__migrationFetch');
      }, screenshot: shot('saved-fields', ['剧本', '按段落拆分镜']) });
      await ctx.prove('单选和多选都使用共享组件并保存真实值', { voiceover: vo[3], action: async () => {
        await tab('tracks'); await choose('[data-project-size]', '1080x1920');
        await ctx.waitFor('document.querySelector("[data-project-size]")?.textContent.includes("1080x1920")');
        await tab('canvas'); await ctx.eval(`document.querySelector('[data-node="${project.nodes[0].id}"]').click()`);
        await ctx.waitFor('Boolean(document.querySelector("[role=checkbox]"))');
        await choose('[data-setting=camera]', '俯拍');
        await ctx.waitFor('document.querySelector("[data-setting=camera]")?.textContent.includes("俯拍")');
        await ctx.eval('document.querySelector("[role=checkbox]").focus()'); await key(parent, ' ');
      }, assert: async () => {
        await ctx.waitFor('document.querySelector("[role=checkbox]")?.getAttribute("aria-checked")==="false"');
        await ctx.waitFor(coverage);
        let persisted = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          const p = await saved(mode, project.id);
          persisted = p.width === 1080 && p.height === 1920 && p.nodes[0].settings.camera === '俯拍' && p.nodes[0].settings.referenceIds.length === 0;
          if (persisted) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        ctx.assert(persisted, 'frame/camera/multiple values persisted after debounced autosave');
      }, screenshot: shot('selects', ['镜头意图', '俯拍']) });
      await ctx.prove('持续提醒与空态使用共享组件', { voiceover: vo[4], action: async () => {
        ctx.assert(await ctx.eval('Boolean(document.querySelector(".inspector [data-slot=alert]"))'), 'missing provider is persistent shared alert');
        await tab('tracks'); ctx.assert(await ctx.eval('Boolean(document.querySelector("main [data-slot=badge]"))'), 'track badge shared');
        await tab('jobs');
      }, assert: async () => { ctx.assert(await ctx.eval('Boolean(document.querySelector("main [data-slot=empty]"))'), 'empty jobs shared'); }, screenshot: shot('empty-feedback', ['尚无生成任务']) });
      await ctx.prove('共享弹窗失败保留、重试成功并恢复焦点', { voiceover: vo[5], action: async () => {
        await click(parent, frame, '[aria-label="新建项目"]'); await ctx.waitFor('Boolean(document.querySelector("#dialog"))');
        await key(parent, 'Escape'); await ctx.waitFor('!document.querySelector("#dialog")');
        await ctx.waitFor('document.activeElement.getAttribute("aria-label")==="新建项目"');
        ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label")==="新建项目"'), 'cancel restores focus');
        await click(parent, frame, '[aria-label="新建项目"]'); await ctx.fill('#dialog input', '迁移后新建 ' + mode);
        await evaluate(parent, `(()=>{window.__migrationFetch=fetch;window.fetch=async(...args)=>{if(args[0]==='/rpc'&&JSON.parse(args[1].body).name==='project-create'){window.fetch=window.__migrationFetch;return new Promise(resolve=>window.__migrationReject=()=>resolve(new Response(JSON.stringify({error:'验收：新建暂不可用'}),{headers:{'content-type':'application/json'}})))}return window.__migrationFetch(...args)}})()`);
        await click(parent, frame, '[data-dialog=ok]'); await ctx.waitFor('document.querySelector("#dialog").getAttribute("aria-busy")==="true"');
        await key(parent, 'Escape'); ctx.assert(await ctx.eval('Boolean(document.querySelector("#dialog"))'), 'busy cannot dismiss');
        await evaluate(parent, 'window.__migrationReject()'); await ctx.waitFor('document.querySelector("#dialog-error")?.textContent.includes("新建暂不可用")');
        ctx.assert(await ctx.eval(`document.querySelector('#dialog input').value===${JSON.stringify('迁移后新建 ' + mode)}`), 'dialog draft retained');
        await click(parent, frame, '[data-dialog=ok]');
      }, assert: async () => {
        await ctx.waitFor('!document.querySelector("#dialog")'); await ctx.waitFor('document.activeElement.getAttribute("aria-label")==="新建项目"');
        const all = await readdir(join(rootFor(mode), 'short-video')); const docs = await Promise.all(all.map(id => saved(mode, id)));
        ctx.assert(docs.some(p => p.title === '迁移后新建 ' + mode), 'dialog retry creates real project');
      }, screenshot: shot('dialog-retry', ['迁移后新建 ' + mode]) });
      await ctx.prove('亮暗和窄窗口全页无遗漏旧控件', { voiceover: vo[6], action: async () => {
        await evaluate(parent, 'document.querySelector("#theme").click()'); await parent.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
        for (const name of ['canvas', 'shots', 'roles', 'script', 'assets', 'tracks', 'jobs']) await tab(name);
      }, assert: async () => {
        ctx.assert(await ctx.eval('document.documentElement.dataset.theme==="dark"'), 'host theme follows');
        ctx.assert(await ctx.eval('document.body.scrollWidth<=innerWidth'), 'document does not overflow narrow');
        ctx.assert(await ctx.eval(coverage), 'no unmigrated generic controls');
      }, screenshot: shot('dark-narrow', ['尚无生成任务']) });
    } finally {
      await evaluate(parent, 'if(window.__migrationFetch)window.fetch=window.__migrationFetch;delete window.__migrationFetch').catch(() => undefined);
      await parent.send('Emulation.clearDeviceMetricsOverride'); frame.close(); ctx.client = parent;
    }
  } })),
};
