import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, evaluate, listTargets } from '../runner/cdp.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

const vo = await loadVoiceoverParagraphs('shared-ui-overlays');
async function key(parent, name) {
  const code = { Enter: 13, Escape: 27, ArrowDown: 40, Home: 36 }[name];
  for (const type of ['keyDown', 'keyUp']) await parent.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code, ...(name === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
}
async function click(parent, frame, selector) {
  await evaluate(frame, `document.querySelector(${JSON.stringify(selector)}).focus()`);
  await key(parent, 'Enter');
}
async function pluginFrame(ctx, mode) {
  for (let attempt = 0; attempt < 80; attempt++) {
    for (const target of (await listTargets(ctx.cdpBaseUrl)).filter(t => t.type === 'iframe')) {
      const frame = await connect(target.webSocketDebuggerUrl).catch(() => null);
      if (!frame) continue;
      if (await evaluate(frame, `window.ipolloworkUi?.mode===${JSON.stringify(mode)} && Boolean(document.querySelector('[aria-label="新建项目"]'))`).catch(() => false)) return frame;
      frame.close();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Plugin did not initialize');
}
async function savedProject(root, title) {
  const projects = join(root, 'short-video');
  const all = await Promise.all((await readdir(projects)).map(id => readFile(join(projects, id, 'project.json'), 'utf8').then(JSON.parse)));
  return all.find(p => p.title === title);
}
export default {
  id: 'shared-ui-overlays', title: '共享 Select、Dialog、Toast：两种加载与真实保存', kind: 'user-facing', preserveTheme: true,
  cdpTarget: { urlIncludes: '127.0.0.1:589' },
  steps: ['bundled', 'host'].map((mode, index) => ({ name: `${mode} 组件接入`, async run(ctx) {
    const parent = ctx.client;
    await parent.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await parent.send('Page.navigate', { url: `http://127.0.0.1:${5896 + index}` });
    await parent.send('Page.bringToFront');
    const frame = await pluginFrame(ctx, mode); ctx.client = frame;
    const title = `组件接入 ${mode} ${Date.now()}`;
    const root = `/tmp/ipollowork-shared-ui-overlays-${mode}`;
    const shot = (name, text) => ({ name: `${mode}-${name}`, targetId: parent.targetId, textTargetId: frame.targetId, requireText: text });
    const inject = action => evaluate(parent, `(()=>{window.__originalFetch=fetch;window.__attempts=0;window.fetch=async(...args)=>{if(args[0]==='/rpc'&&JSON.parse(args[1].body).name===${JSON.stringify(action)}){window.__attempts++;if(window.__attempts===1)return new Promise(resolve=>window.__reject=()=>resolve(new Response(JSON.stringify({error:'验证：保存暂不可用，请重试'}),{headers:{'content-type':'application/json'}})));}return window.__originalFetch(...args);};})()`);
    try {
      await click(parent, frame, '[aria-label="新建项目"]');
      await ctx.waitFor('Boolean(document.querySelector("#dialog"))');
      await ctx.fill('#dialog input', title); await inject('project-create');
      await ctx.prove('共享 Dialog 提交中保留输入、禁止重复和关闭', {
        voiceover: vo[0], action: () => click(parent, frame, '[data-dialog="ok"]'),
        assert: async () => {
          await ctx.waitFor('document.querySelector("#dialog").getAttribute("aria-busy")==="true"');
          await key(parent, 'Escape');
          ctx.assert(await ctx.eval(`document.querySelector('#dialog input').value===${JSON.stringify(title)} && [...document.querySelectorAll('#dialog button, #dialog input')].every(e=>e.disabled&&e.getBoundingClientRect().height===32)`), 'busy shared controls retain draft and geometry');
        }, screenshot: shot('busy', ['新建短片', '提交中…']),
      });
      await ctx.prove('失败保留草稿，真实重试成功后显示共享 Toast', {
        voiceover: vo[1], action: async () => {
          await evaluate(parent, 'window.__reject()');
          await ctx.waitFor('!document.querySelector("#dialog-error").hidden');
          ctx.assert(await ctx.eval(`document.querySelector('#dialog input').value===${JSON.stringify(title)} && document.querySelector('#dialog input').getAttribute('aria-describedby')==='dialog-error' && !document.querySelector('[data-slot="toast-card"]')`), 'field error remains inline, not a toast');
          await click(parent, frame, '[data-dialog="ok"]');
        }, assert: async () => {
          await ctx.waitFor('!document.querySelector("#dialog") && Boolean(document.querySelector("[data-slot=toast-card]"))');
          ctx.assert((await savedProject(root, title))?.title === title, 'actual project file persists');
          ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label")==="新建项目"'), 'focus returns to entry');
        }, screenshot: shot('toast', ['短片已创建', title]),
      });
      await evaluate(parent, 'window.fetch=window.__originalFetch;delete window.__originalFetch');
      await click(parent, frame, '[data-action="add:image"]');
      await ctx.waitFor('Boolean(document.querySelector("[data-slot=select-trigger]"))');
      await inject('project-save');
      await ctx.prove('Select 键盘与取消不丢值，失败恢复原值并就地提示', {
        voiceover: vo[2], action: async () => {
          await click(parent, frame, '[data-slot="select-trigger"]'); await ctx.waitFor('document.activeElement.getAttribute("role")==="option"');
          await key(parent, 'Escape'); await ctx.waitFor('document.querySelector("[data-slot=select-trigger]").getAttribute("aria-expanded")==="false"');
          await ctx.waitFor('document.activeElement.dataset.slot==="select-trigger"');
          ctx.assert(await ctx.eval('document.activeElement.dataset.slot==="select-trigger" && document.activeElement.textContent.includes("自由创作")'), 'Escape returns focus without altering selection');
          await click(parent, frame, '[data-slot="select-trigger"]'); await ctx.waitFor('document.activeElement.getAttribute("role")==="option"'); await key(parent, 'Home'); await key(parent, 'ArrowDown'); await key(parent, 'Enter');
          ctx.client = parent; await ctx.waitFor('typeof window.__reject==="function"'); ctx.client = frame;
          await evaluate(parent, 'window.__reject()');
        }, assert: async () => {
          await ctx.waitFor('!document.querySelector("#preset-error").hidden');
          await ctx.waitFor('document.activeElement.dataset.slot==="select-trigger"');
          ctx.assert(await ctx.eval('document.querySelector("[data-slot=select-trigger]").textContent.includes("自由创作") && document.querySelector("[data-slot=select-trigger]").getAttribute("aria-describedby")==="preset-error"'), 'failed choice restores persisted value');
          ctx.assert(!(await savedProject(root, title)).nodes[0].settings?.preset, 'failed save did not mutate disk');
        }, screenshot: shot('select-error', ['风格提示', '保存暂不可用', '自由创作']),
      });
      await ctx.prove('Select 重试保存风格及提示词到真实项目', {
        voiceover: vo[3], action: async () => {
          await click(parent, frame, '[data-slot="select-trigger"]'); await ctx.waitFor('document.activeElement.getAttribute("role")==="option"'); await key(parent, 'Home');
          for (let i = 0; i < 4; i++) await key(parent, 'ArrowDown'); await key(parent, 'Enter');
        }, assert: async () => {
          await ctx.waitFor('document.querySelector("[data-slot=select-trigger]").textContent.includes("产品展示") && !document.querySelector("[data-slot=select-trigger]").disabled');
          await ctx.waitFor('document.activeElement.dataset.slot==="select-trigger"');
          const project = await savedProject(root, title);
          ctx.assert(project.nodes[0].settings.preset === '产品展示' && project.nodes[0].prompt.includes('商业产品摄影'), 'preset and prompt persisted together');
          ctx.assert(await evaluate(parent, 'window.__attempts===2'), 'one failed save and one real retry');
        }, screenshot: shot('select-saved', ['风格提示', '产品展示']),
      });
      await evaluate(parent, 'window.fetch=window.__originalFetch;delete window.__originalFetch');
      await ctx.prove('深色与390px下共享浮层不越界', {
        voiceover: vo[4], action: async () => {
          await evaluate(parent, 'document.querySelector("#theme").click()');
          await parent.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
          await evaluate(frame, 'window.ipolloworkUi.toast.dismiss();window.ipolloworkUi.toast.info("共享主题已切换",{duration:60000})');
          await click(parent, frame, '[data-slot="select-trigger"]');
        }, assert: async () => {
          await ctx.waitFor(`(()=>{const e=document.querySelector('[data-slot=select-content][data-open]');if(!e)return false;const r=e.getBoundingClientRect();return document.documentElement.dataset.theme==='dark'&&r.width>0&&r.left>=0&&r.right<=innerWidth})()`);
          await ctx.waitFor('document.querySelector("[data-sonner-toaster]").dataset.sonnerTheme==="dark"');
          await ctx.waitFor(`(()=>{const e=document.querySelector('[data-sonner-toast][data-mounted=true][data-removed=false]');if(!e||!e.textContent.includes('共享主题已切换')||document.querySelector('[data-sonner-toast][data-removed=true]'))return false;const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth})()`);
          ctx.assert(await ctx.eval('document.querySelector("[data-sonner-toaster]").dataset.sonnerTheme==="dark"'), 'shared toaster follows host theme');
        }, screenshot: shot('dark-narrow', ['风格提示', '产品展示']),
      });
      await key(parent, 'Escape');
      await ctx.prove('取消弹窗恢复焦点，Toast 可用键盘关闭', {
        voiceover: vo[5], action: async () => {
          await click(parent, frame, '[aria-label="新建项目"]'); await ctx.waitFor('Boolean(document.querySelector("#dialog"))');
          await ctx.waitFor('document.activeElement===document.querySelector("#dialog input")');
          ctx.assert(await ctx.eval(`(()=>{const r=document.querySelector('#dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`), 'dialog fits narrow container');
          await key(parent, 'Escape'); await ctx.waitFor('!document.querySelector("#dialog")');
          await ctx.waitFor('document.activeElement.getAttribute("aria-label")==="新建项目"');
          ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label")==="新建项目"'), 'cancel restores entry focus');
          await evaluate(frame, 'window.ipolloworkUi.toast.dismiss();window.ipolloworkUi.toast.info("键盘关闭提示",{duration:60000})');
          await ctx.waitFor('Boolean(document.querySelector("[data-sonner-toast][data-mounted=true][data-removed=false]")?.textContent.includes("键盘关闭提示")) && !document.querySelector("[data-sonner-toast][data-removed=true]")');
          await click(parent, frame, '[data-sonner-toast][data-removed=false] [data-slot="toast-card"] button[aria-label="Close notification"]');
        }, assert: async () => { await ctx.waitFor('!document.querySelector("[data-slot=toast-card]")'); }, screenshot: shot('closed', [title]),
      });
      ctx.client = parent;
      const rejectedShot = { name: `${mode}-missing-capability`, targetId: parent.targetId, requireText: ['缺少所需 UI 组件', '请更新'] };
      await ctx.prove('缺少新组件的旧1.x明确停止并提示更新', {
        voiceover: vo[6], action: () => evaluate(parent, `(()=>{const f=document.querySelector('iframe');window.__srcdoc=f.srcdoc;f.srcdoc=f.srcdoc.replace('<head>','<head><script>Object.defineProperty(window,"ipolloworkUi",{value:{version:"1.0.1"},writable:false});<\/script>');})()`),
        assert: async () => {
          let rejected;
          for (let attempt = 0; attempt < 80 && !rejected; attempt++) {
            for (const t of (await listTargets(ctx.cdpBaseUrl)).filter(t => t.type === 'iframe')) {
              const c = await connect(t.webSocketDebuggerUrl).catch(() => null); if (!c) continue;
              if (await evaluate(c, 'Boolean(document.querySelector("[role=alert]")?.textContent.includes("缺少"))').catch(() => false)) { rejected = c; break; } c.close();
            }
            if (!rejected) await new Promise(resolve => setTimeout(resolve, 250));
          }
          ctx.assert(Boolean(rejected), 'missing capability shows update error'); ctx.client = rejected; rejectedShot.textTargetId = rejected.targetId;
          ctx.assert(await ctx.eval('!document.querySelector("[aria-label=新建项目]")'), 'business not initialized');
        }, screenshot: rejectedShot,
      });
    } finally {
      await evaluate(parent, 'if(window.__originalFetch)window.fetch=window.__originalFetch;if(window.__srcdoc)document.querySelector("iframe").srcdoc=window.__srcdoc;delete window.__srcdoc;').catch(() => undefined);
      frame.close(); if (ctx.client !== parent) ctx.client.close(); ctx.client = parent;
    }
  } })),
};
