import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

const vo = await loadVoiceoverParagraphs('shared-ui-pages');
const dialog = '[data-slot="dialog-content"]';
async function escape(ctx) {
  for (const type of ['keyDown', 'keyUp']) await ctx.client.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}
async function button(ctx, label, scope = 'document') {
  const selector = await ctx.eval(`(()=>{const b=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button: '+${JSON.stringify(label)});b.dataset.pageProof='target';return '[data-page-proof="target"]'})()`);
  await ctx.trustedClick(selector);
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-page-proof')`);
}
const errorStyle = `(()=>{const e=document.querySelector('[role="alert"]'),s=getComputedStyle(e);return s.borderTopWidth==='0px'&&s.boxShadow==='none'&&s.backgroundColor!=='rgba(0, 0, 0, 0)'})()`;

export default {
  id: 'shared-ui-pages', title: '共享组件本地整合：真实客户端逐页验收', kind: 'user-facing', preserveTheme: true,
  requiredEnv: ['IPOLLOWORK_UI_CLIENT_ROOT'], cdpTarget: { urlIncludes: '5193' },
  steps: [{ name: '设置、授权、插件、云市场与工作区', async run(ctx) {
    if (!ctx.env.IPOLLOWORK_UI_CLIENT_ROOT.startsWith('/tmp/ipollowork-shared-ui-client-')) throw Error('Use a dedicated temporary Electron profile');
    const theme = await ctx.eval('localStorage.getItem("ipollowork.react.settings.theme-mode")');
    const language = await ctx.eval('localStorage.getItem("ipollowork.language")');
    await ctx.eval(`import('/src/i18n/index.ts').then(m=>m.setLocale('en'))`, { awaitPromise: true });
    await escape(ctx);
    try {
      await ctx.prove('设置页主题选择与实际页面同步', {
        voiceover: vo[0], action: async () => {
          await ctx.control('settings.panel.open', { panel: 'appearance' });
          await ctx.waitFor('Boolean(document.querySelector("button[aria-label=Dark]"))');
          await ctx.trustedClick('button[aria-label=Dark]');
          await ctx.waitFor('document.documentElement.dataset.theme==="dark"');
          ctx.assert(await ctx.eval('document.querySelector("button[aria-label=Dark]").getAttribute("aria-pressed")==="true"'), 'dark selection is explicit');
          await ctx.trustedClick('button[aria-label=Light]');
        }, assert: async () => {
          await ctx.waitFor('document.documentElement.dataset.theme==="light"');
          ctx.assert(await ctx.eval('document.querySelector("button[aria-label=Light]").getAttribute("aria-pressed")==="true" && Boolean(document.querySelector("[data-slot=select-trigger]"))'), 'light selected and language control remains available');
        }, screenshot: { name: 'appearance', requireText: ['Appearance', 'Language'] },
      });
      await ctx.prove('授权必填错误保留输入、浅背景与关闭焦点', {
        voiceover: vo[1], action: async () => {
          await ctx.control('settings.panel.open', { panel: 'authorizations' });
          await ctx.waitFor('document.body.innerText.includes("Alibaba Cloud OSS")');
          ctx.assert(await ctx.eval(`(()=>{const card=[...document.querySelectorAll('[data-slot=card]')].find(e=>e.innerText.includes('Alibaba Cloud OSS'));return [...card.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Configure').every(b=>{const r=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);const t=range.getBoundingClientRect();return r.height===28&&Math.abs(t.x+t.width/2-r.x-r.width/2)<0.5&&Math.abs(t.y+t.height/2-r.y-r.height/2)<0.5})})()`), 'configure icon and text centered as a group');
          await button(ctx, 'Configure', `[...document.querySelectorAll('[data-slot="card"]')].find(e=>e.innerText.includes('Alibaba Cloud OSS'))`);
          await ctx.waitFor(`Boolean(document.querySelector('${dialog} input'))`);
          await ctx.fill(`${dialog} input`, 'isolated-draft-not-a-credential');
          await button(ctx, 'Save authorization', `document.querySelector('${dialog}')`);
        }, assert: async () => {
          await ctx.waitFor(`document.querySelector('${dialog} [role="alert"]')?.textContent.includes('required')`);
          ctx.assert(await ctx.eval(`document.querySelector('${dialog} input').value==='isolated-draft-not-a-credential' && ${errorStyle}`), 'draft remains and actual authorization error uses feedback background');
        }, screenshot: { name: 'authorization-required', requireText: ['AccessKey Secret is required.', 'Save authorization'] },
      });
      await escape(ctx);
      await ctx.waitFor(`!document.querySelector('${dialog}')`);
      ctx.assert(await ctx.eval('document.activeElement.textContent.trim()==="Configure"'), 'authorization returns focus to configure');
      await ctx.prove('插件安装状态与真实服务拒绝的导入错误', {
        voiceover: vo[2], action: async () => {
          await ctx.control('settings.panel.open', { panel: 'extensions' });
          await ctx.waitFor(`Boolean([...document.querySelectorAll('[data-testid="plugin-package-list-item"]')].find(e=>e.innerText.includes('Short Video Studio')&&e.innerText.includes('Open')))`);
          await button(ctx, 'Add'); await ctx.waitFor('Boolean(document.querySelector("[data-testid=plugin-package-import-dialog]"))');
          await button(ctx, 'GitHub', 'document.querySelector("[data-testid=plugin-package-import-dialog]")');
          await ctx.fill('input[placeholder="https://github.com/owner/repository"]', 'not-a-github-url');
          await button(ctx, 'Preview', 'document.querySelector("[data-testid=plugin-package-import-dialog]")');
        }, assert: async () => {
          await ctx.waitFor('Boolean(document.querySelector("[data-testid=plugin-package-import-dialog] [role=alert]"))');
          ctx.assert(await ctx.eval(`document.querySelector('input[placeholder="https://github.com/owner/repository"]').value==='not-a-github-url' && ${errorStyle}`), 'local validation retains address with borderless error');
        }, screenshot: { name: 'plugin-import-error', requireText: ['Import a complete plugin package', 'Preview'] },
      });
      await button(ctx, 'Cancel', 'document.querySelector("[data-testid=plugin-package-import-dialog]")');
      await ctx.waitFor('!document.querySelector("[data-testid=plugin-package-import-dialog]")');
      ctx.assert(await ctx.eval('document.activeElement.textContent.trim()==="Add"'), 'import returns focus to add');
      await ctx.prove('云市场未登录状态与可操作的账号入口', {
        voiceover: vo[3], action: async () => {
          await ctx.control('settings.panel.open', { panel: 'cloud-marketplaces' });
          await ctx.waitForText('Sign in to browse the Plugin Marketplace');
          ctx.assert(await ctx.eval('!document.querySelector("[data-testid=plugin-package-list-item]")'), 'signed-out state is not a successful catalog');
          await button(ctx, 'Sign in');
        }, assert: async () => {
          await ctx.waitFor('location.hash.includes("cloud-account")');
          ctx.assert(await ctx.eval('document.body.innerText.includes("Sign in")'), 'account sign-in surface remains available');
          const accountAlignment = `(()=>{const area=document.querySelector('[data-settings-safe-area]'),body=document.querySelector('[data-testid=cloud-account-content]');if(!area||!body)return false;const h=area.firstElementChild.getBoundingClientRect(),b=body.getBoundingClientRect();return Math.abs(h.left-b.left)<0.5&&Math.abs(h.right-b.right)<0.5&&b.left>=0&&b.right<=innerWidth&&body.scrollWidth<=body.clientWidth})()`;
          await ctx.waitFor(accountAlignment, { label: 'account content follows standard header width' });
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
          await ctx.waitFor(accountAlignment, { label: 'narrow account content remains aligned' });
          ctx.assert(await ctx.eval(accountAlignment), 'account content aligned without narrow overflow');
          await ctx.client.send('Emulation.clearDeviceMetricsOverride');
          await ctx.waitFor(accountAlignment, { label: 'desktop account alignment restored' });
        }, screenshot: { name: 'cloud-account', requireText: ['Sign in', 'Account'] },
      });
      await ctx.prove('工作区权限浮层在窄视口可用并恢复焦点', {
        voiceover: vo[4], action: async () => {
          await ctx.control('route.session');
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
          await ctx.waitFor(`Boolean(document.querySelector('button[aria-label^="Access:"]'))`);
          await ctx.trustedClick('button[aria-label^="Access:"]');
        }, assert: async () => {
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=popover-content]"))');
          ctx.assert(await ctx.eval(`(()=>{const e=document.querySelector('[data-slot=popover-content]'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth})()`), 'actual permission popup fits narrow viewport');
        }, screenshot: { name: 'workspace-permissions', requireText: ['Agent defaults'] },
      });
      await escape(ctx); await ctx.waitFor('!document.querySelector("[data-slot=popover-content]")');
      ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label").startsWith("Access:")'), 'permission focus returns');
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      await ctx.prove('模板操作尺寸、筛选入口与选中尺寸稳定', {
        voiceover: vo[5], action: async () => {
          await button(ctx, 'Templates');
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=dialog-content]"))');
          await button(ctx, 'Explore', 'document.querySelector("[data-slot=dialog-content]")');
          await ctx.waitFor('Boolean(document.querySelector("[data-testid=template-catalog-filters]"))');
          await ctx.eval(`window.__templateButtonBefore=[...document.querySelectorAll('[data-slot=dialog-content] button')].filter(b=>b.hasAttribute('aria-pressed')).map(b=>({text:b.textContent,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,font:getComputedStyle(b).fontSize,padding:getComputedStyle(b).padding}))`);
          await button(ctx, 'App Prototype', 'document.querySelector("[data-slot=dialog-content]")');
        }, assert: async () => {
          ctx.assert(await ctx.eval(`window.__templateButtonBefore.every(a=>{const b=[...document.querySelectorAll('[data-slot=dialog-content] button')].find(b=>b.textContent===a.text),r=b.getBoundingClientRect(),s=getComputedStyle(b);return Math.abs(a.w-r.width)<0.1&&a.h===r.height&&a.font===s.fontSize&&a.padding===s.padding})`), 'category selection does not resize controls');
          ctx.assert(await ctx.eval(`['Custom template','Import'].every(text=>[...document.querySelectorAll('[data-slot=dialog-content] button')].find(b=>b.textContent.trim()===text).getBoundingClientRect().height===32)`), 'template operations are 32px');
          ctx.assert(await ctx.eval(`[...document.querySelectorAll('[data-testid=template-catalog-filters] button')].every(b=>b.classList.contains('group/button')&&b.getBoundingClientRect().height===32)`), 'facets use shared buttons');
          ctx.assert(await ctx.eval(`(()=>{const b=document.querySelector('[data-slot=dialog-close]:has(svg.lucide-x)'),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return r.width===28&&r.height===28&&s.width===16&&s.height===16&&Math.abs(s.x+s.width/2-r.x-r.width/2)<0.1&&Math.abs(s.y+s.height/2-r.y-r.height/2)<0.1})()`), 'dialog close uses centered 16px icon in 28px control');
          await ctx.trustedClick('[data-testid=template-catalog-filters] button');
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=dropdown-menu-content]"))');
          await escape(ctx);
          await ctx.waitFor('!document.querySelector("[data-slot=dropdown-menu-content]")');
        }, screenshot: { name: 'template-controls', requireText: ['Templates', 'Custom template', 'Category'] },
      });
      await escape(ctx);
      await ctx.prove('设置按钮居中与统一弹窗关闭', {
        voiceover: vo[6], action: async () => {
          await ctx.control('settings.panel.open', { panel: 'extensions' });
          await ctx.waitFor('document.body.innerText.includes("Personal")');
        }, assert: async () => {
          ctx.assert(await ctx.eval(`['Plugins','Skills','Personal','Public'].every(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text),r=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);const t=range.getBoundingClientRect();return r.height===28&&Math.abs(t.x+t.width/2-r.x-r.width/2)<0.5&&Math.abs(t.y+t.height/2-r.y-r.height/2)<0.5&&getComputedStyle(b).lineHeight==='18px'})`), 'settings labels centered with stable line height');
          await button(ctx, 'Add');
          await ctx.waitFor('Boolean(document.querySelector("[data-testid=plugin-package-import-dialog]"))');
          await ctx.waitFor(`document.querySelector('[data-slot=dialog-close]:has(svg.lucide-x)')?.getBoundingClientRect().width===28`);
          ctx.assert(await ctx.eval(`(()=>{const b=document.querySelector('[data-slot=dialog-close]:has(svg.lucide-x)'),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return r.width===28&&r.height===28&&s.width===16&&s.height===16&&Math.abs(s.x+s.width/2-r.x-r.width/2)<0.1&&Math.abs(s.y+s.height/2-r.y-r.height/2)<0.1})()`), 'import reuses standard dialog close');
        }, screenshot: { name: 'standard-import-close', requireText: ['Import a complete plugin package', 'Cancel'] },
      });
      await escape(ctx);
      await ctx.prove('模型按钮无前置图标且窄窗口不留空入口', {
        voiceover: vo[7], action: async () => {
          await ctx.control('route.session');
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
          await ctx.waitFor('Boolean(document.querySelector("[data-testid=composer-model-trigger]"))');
        }, assert: async () => {
          ctx.assert(await ctx.eval(`(()=>{const b=document.querySelector('[data-testid=composer-model-trigger]'),s=b.querySelector('span');return b.querySelectorAll('svg').length===1&&b.querySelector('svg').classList.contains('lucide-chevron-down')&&s.textContent.trim().length>0&&getComputedStyle(s).display!=='none'&&s.getBoundingClientRect().width>0})()`), 'model text visible and only trailing chevron remains');
          await ctx.trustedClick('[data-testid=composer-model-trigger]');
          await ctx.waitFor('Boolean(document.querySelector("[data-slot=popover-content]"))');
          await escape(ctx);
          await ctx.waitFor('!document.querySelector("[data-slot=popover-content]")');
        }, screenshot: { name: 'text-model-trigger', requireText: ['Agent defaults'] },
      });
    } finally {
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      await ctx.eval(`(()=>{for(const [key,value] of ${JSON.stringify([['ipollowork.react.settings.theme-mode', theme], ['ipollowork.language', language]])}){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}})()`);
      await ctx.client.send('Page.reload');
    }
  } }],
};
