import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { evaluate } from '../runner/cdp.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

const vo = await loadVoiceoverParagraphs('shared-ui-client');

// Electron may keep sandboxed srcdoc frames in the page process, not OOPIF targets.
async function frameClient(parent) {
  const { frameTree } = await parent.send('Page.getFrameTree');
  const frame = frameTree.childFrames?.find(({ frame }) => frame.url === 'about:srcdoc');
  if (!frame) return null;
  const socket = new WebSocket(parent.webSocketDebuggerUrl);
  const contexts = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Frame context timeout')), 5000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    socket.onerror = error => { clearTimeout(timer); reject(error); };
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context);
      if (message.id === 1) { clearTimeout(timer); resolve(); }
    };
  }).finally(() => socket.close());
  const context = contexts.find(context => context.auxData?.isDefault && context.auxData.frameId === frame.frame.id);
  if (!context) return null;
  return { ...parent, send: (method, params) => parent.send(method, method === 'Runtime.evaluate' ? { ...params, contextId: context.id } : params) };
}

async function activate(parent, frame, selector) {
  await evaluate(frame, `document.querySelector(${JSON.stringify(selector)}).focus()`);
  for (const type of ['keyDown', 'keyUp']) await parent.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
}

async function openInstalledWorkspace(parent) {
  if (!(await parent.send('Page.getFrameTree')).frameTree.childFrames?.length) {
    if (!await evaluate(parent, `Boolean(document.querySelector('[role="menuitem"]'))`)) {
      await evaluate(parent, `document.querySelector('[aria-label="Add side panel entry"]').click()`);
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(parent, `Boolean([...document.querySelectorAll('[role="menuitem"]')].find(e=>e.innerText==='短片工作台'))`)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await evaluate(parent, `[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.innerText==='短片工作台').click()`);
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const frame = await frameClient(parent).catch(() => null);
    if (frame && await evaluate(frame, 'Boolean(window.ipolloworkUi && document.querySelector("[aria-label=新建项目]"))').catch(() => false)) return frame;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Installed workspace did not load');
}

export default {
  id: 'shared-ui-client', title: '共享 UI：真实 Electron 安装、失败恢复与同版本重开', kind: 'user-facing',
  preserveTheme: true, requiredEnv: ['IPOLLOWORK_UI_CLIENT_ROOT'], cdpTarget: { urlIncludes: '5193' },
  steps: [{ name: '真实安装后的插件与嵌入式服务', async run(ctx) {
    const parent = ctx.client;
    const root = ctx.env.IPOLLOWORK_UI_CLIENT_ROOT;
    if (!root.startsWith('/tmp/ipollowork-shared-ui-client-')) throw new Error('Use a dedicated temporary Electron profile');
    const installed = join(root, 'plugin-packages/artifacts/short-video-studio/0.1.0/ui/studio.html');
    const html = await readFile(installed, 'utf8');
    const originalHash = createHash('sha256').update(html).digest('hex');
    ctx.assert(html.includes('<meta name="ipollowork-ui-runtime" content="1">') && !html.includes('data-ipw-runtime="bundled"'), 'installed production package opts in without bundled runtime');
    await ctx.waitFor(`Boolean(document.querySelector('[aria-label="Add side panel entry"]'))`);
    const frame = await openInstalledWorkspace(parent);
    ctx.assert(Boolean(frame), 'installed plugin frame exists');
    ctx.client = frame;
    const title = `客户端共享组件验收 ${Date.now()}`;
    try {
      await ctx.prove('真实安装插件接收宿主运行时并使用32px共享控件', {
        voiceover: vo[0], action: () => activate(parent, frame, '[aria-label="新建项目"]'),
        assert: async () => {
          await ctx.waitFor('document.querySelector("#dialog").open');
          ctx.assert(await ctx.eval('window.ipolloworkUi.mode === "host" && window.ipolloworkUi.version === "1.0.1"'), 'patched host runtime is installed inside iframe');
          await ctx.waitFor('[...document.querySelectorAll("#dialog button, #dialog input")].every(e => e.dataset.ipwReady === window.ipolloworkUi.version && e.getBoundingClientRect().height === 32)');
        }, screenshot: { name: 'installed-host-controls', requireText: ['新建短片'] },
      });
      await ctx.fill('#dialog input', title);
      await evaluate(parent, `(()=>{window.__uiOriginalFetch=fetch;window.__uiSaves=0;window.fetch=async(...args)=>{const request=args[0],url=request instanceof Request?request.url:String(request);if(url.includes('/experimental/extensions/call')){const body=JSON.parse(args[1]?.body??await request.clone().text());if(body.extensionId==='short-video-studio'&&body.action==='project-create'){window.__uiSaves++;if(window.__uiSaves===1)return new Promise(resolve=>window.__uiReject=()=>resolve(new Response(JSON.stringify({message:'验证：保存暂不可用，请重试'}),{status:503,headers:{'content-type':'application/json'}})));}}return window.__uiOriginalFetch(...args);};})()`);
      await activate(parent, frame, '[data-dialog="ok"]');
      await ctx.waitFor('document.querySelector("#dialog").getAttribute("aria-busy") === "true"');
      ctx.assert(await ctx.eval('[...document.querySelectorAll("#dialog button")].every(b=>b.disabled)'), 'busy blocks duplicate submission');
      ctx.client = parent;
      await ctx.waitFor('typeof window.__uiReject === "function"');
      ctx.client = frame;
      await ctx.prove('真实客户端传输失败后保留输入并提供就地错误', {
        voiceover: vo[1], action: () => evaluate(parent, 'window.__uiReject()'),
        assert: async () => {
          await ctx.waitFor('!document.querySelector("#dialog-error").hidden');
          ctx.assert(await ctx.eval(`document.querySelector('#dialog').open && document.querySelector('#dialog input').value === ${JSON.stringify(title)} && document.querySelector('#dialog input').getAttribute('aria-describedby') === 'dialog-error'`), 'draft survives and error is accessible');
        }, screenshot: { name: 'failed-draft-preserved', requireText: ['新建短片', '保存暂不可用'] },
      });
      await ctx.prove('重试通过真实嵌入式服务写入项目，成功恢复焦点', {
        voiceover: vo[2], action: () => activate(parent, frame, '[data-dialog="ok"]'),
        assert: async () => {
          await ctx.waitFor('!document.querySelector("#dialog").open');
          ctx.assert(await evaluate(parent, 'window.__uiSaves === 2'), 'one injected failure and one real retry');
          ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label") === "新建项目"'), 'focus returns to new-project entry');
          const projects = join(root, 'userdata/ipollowork-dev-data/home/iPolloWork/short-video');
          const entries = await readdir(projects);
          const saved = await Promise.all(entries.map(id => readFile(join(projects, id, 'project.json'), 'utf8').then(JSON.parse)));
          ctx.assert(saved.some(project => project.title === title), 'project title persists in actual workspace file');
        }, screenshot: { name: 'real-save', requireText: [title] },
      });
      await evaluate(parent, 'window.fetch = window.__uiOriginalFetch; delete window.__uiOriginalFetch');
      ctx.client = parent;
      await ctx.prove('客户端刷新后重新加载宿主运行时并保留项目', {
        voiceover: vo[3], action: async () => {
          await evaluate(parent, 'window.__uiReloadMarker = true');
          await parent.send('Page.reload');
        },
        assert: async () => {
          await ctx.waitFor(`window.__uiReloadMarker === undefined && document.readyState === "complete" && Boolean(document.querySelector('[aria-label="Add side panel entry"]'))`);
          const reopened = await openInstalledWorkspace(parent);
          ctx.assert(await evaluate(reopened, `window.ipolloworkUi?.mode === 'host' && window.ipolloworkUi.version === '1.0.1' && document.body.textContent.includes(${JSON.stringify(title)})`), 'installed plugin reloads patched host runtime and saved project remains available');
          ctx.assert(createHash('sha256').update(await readFile(installed)).digest('hex') === originalHash, 'production plugin artifact unchanged by host runtime update');
          ctx.client = reopened;
        }, screenshot: { name: 'same-version-reopen', requireText: [title] },
      });
      const reopened = ctx.client;
      const originalTheme = await evaluate(parent, 'document.documentElement.dataset.theme');
      await ctx.prove('真实宿主桥接同步深色主题，390px容器保留弹窗边界与焦点', {
        voiceover: vo[4], action: async () => {
          await evaluate(parent, `(()=>{document.documentElement.dataset.theme='dark';const frame=document.querySelector('iframe');frame.style.width='390px';frame.style.minWidth='0';frame.style.maxWidth='390px';})()`);
          await activate(parent, reopened, '[aria-label="新建项目"]');
        },
        assert: async () => {
          await ctx.waitFor(`document.documentElement.dataset.theme === 'dark' && innerWidth === 390 && document.querySelector('#dialog').open`);
          ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('#dialog'),r=d.getBoundingClientRect(),s=getComputedStyle(document.documentElement);return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth&&s.getPropertyValue('--sv-text').trim()===s.getPropertyValue('--foreground').trim()})()`), 'dialog stays inside narrow container and resolves shared dark tokens');
        }, screenshot: { name: 'host-dark-narrow', requireText: ['新建短片'] },
      });
      for (const type of ['keyDown', 'keyUp']) await parent.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await ctx.waitFor('!document.querySelector("#dialog").open');
      ctx.assert(await ctx.eval('document.activeElement.getAttribute("aria-label") === "新建项目"'), 'Escape restores entry focus');
      await evaluate(parent, `(()=>{document.documentElement.dataset.theme=${JSON.stringify(originalTheme)};const frame=document.querySelector('iframe');for(const key of ['width','min-width','max-width'])frame.style.removeProperty(key);})()`);
      ctx.client = parent;
      const originalSrcdoc = await evaluate(parent, `document.querySelector('iframe').srcdoc`);
      try {
        await ctx.prove('生产插件拒绝不兼容运行时并显示更新提示', {
          voiceover: vo[5], action: () => evaluate(parent, `(()=>{const frame=document.querySelector('iframe');frame.srcdoc=frame.srcdoc.replace(/<script data-ipw-runtime="host">[\\s\\S]*?<\\/script>/,'<script data-ipw-runtime="host">window.ipolloworkUi={version:"2.0.0"};<\\/script>');})()`),
          assert: async () => {
            let incompatible;
            for (let attempt = 0; attempt < 100; attempt++) {
              incompatible = await frameClient(parent).catch(() => null);
              if (incompatible && await evaluate(incompatible, `Boolean(document.querySelector('[role="alert"]')?.textContent.includes('请更新'))`).catch(() => false)) break;
              incompatible = null;
              await new Promise(resolve => setTimeout(resolve, 250));
            }
            ctx.assert(Boolean(incompatible), 'real plugin initialization renders update error');
            ctx.client = incompatible;
            ctx.assert(await ctx.eval(`!document.querySelector('[aria-label="新建项目"]') && window.ipolloworkUi.version==='2.0.0'`), 'project business does not initialize under incompatible major');
          }, screenshot: { name: 'incompatible-runtime', requireText: ['暂未连接', '请更新 iPolloWork'] },
        });
      } finally {
        await evaluate(parent, `document.querySelector('iframe').srcdoc=${JSON.stringify(originalSrcdoc)}`);
      }
    } finally {
      await evaluate(parent, 'if(window.__uiOriginalFetch){window.fetch=window.__uiOriginalFetch;delete window.__uiOriginalFetch;}').catch(() => undefined);
      ctx.client = parent;
    }
  } }],
};
