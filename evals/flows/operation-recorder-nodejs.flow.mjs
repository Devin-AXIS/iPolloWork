import { createRequire } from 'node:module';
import { connect, debuggerUrlFor, evaluate, pickAppTarget } from '../runner/cdp.mjs';

const require = createRequire(new URL('../../examples/plugin-packages/operation-recorder/package.json', import.meta.url));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export default {
  id: 'operation-recorder-nodejs',
  title: '统一 Node.js 采集器记录页面、区域、控件并导出详细 Skill',
  kind: 'user-facing',
  preserveTheme: true,
  cdpTarget: { title: '操作录制 · iPolloWork' },
  steps: [{
    name: '在真实 Windows 页面上录制并检查具体点击位置',
    run: async ctx => {
      ctx.assert(process.platform === 'win32', 'This native input proof currently runs on Windows; macOS/Linux require their own real desktop validation.');
      const target = await pickAppTarget(ctx.cdpBaseUrl, { title: '项目列表 · Node.js 录制验证' });
      const fixture = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
      const koffi = require('koffi');
      const user = koffi.load('user32.dll');
      const find = user.func('void * __stdcall FindWindowW(const char16_t *className, const char16_t *title)');
      const foreground = user.func('void * __stdcall GetForegroundWindow()');
      const focus = user.func('int __stdcall SetForegroundWindow(void *window)');
      const windowThread = user.func('uint32 __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32 *pid)');
      const currentThread = koffi.load('kernel32.dll').func('uint32 __stdcall GetCurrentThreadId()');
      const attachInput = user.func('int __stdcall AttachThreadInput(uint32 from, uint32 to, int attach)');
      const cursor = user.func('int __stdcall SetCursorPos(int x, int y)');
      const mouse = user.func('void __stdcall mouse_event(uint32 flags, uint32 x, uint32 y, uint32 data, uintptr_t extra)');
      const POINT = koffi.struct('RecorderProofPoint', { x: 'int32', y: 'int32' });
      const getCursor = user.func('int __stdcall GetCursorPos(_Out_ RecorderProofPoint *point)');
      const atPoint = user.func('void * __stdcall WindowFromPoint(RecorderProofPoint point)');
      const ancestor = user.func('void * __stdcall GetAncestor(void *window, uint32 flags)');
      const originalWindow = foreground();
      const originalPoint = {}; getCursor(originalPoint);
      const window = find(null, '项目列表 · Node.js 录制验证');
      ctx.assert(Boolean(window), 'The isolated fixture has a real native window.');
      async function nativeClick(selector) {
        await fixture.send('Page.bringToFront');
        await evaluate(fixture, 'window.recorderProof.focus()');
        const from = currentThread();
        const to = windowThread(foreground(), [0]);
        const attached = from !== to && attachInput(from, to, 1);
        try { focus(window); await pause(150); } finally { if (attached) attachInput(from, to, 0); }
        ctx.assert(foreground() === window, 'Native input targets only the owned fixture window.');
        const point = await evaluate(fixture, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); const rect = element.getBoundingClientRect(); return { x: Math.round((window.screenX + rect.x + rect.width / 2) * devicePixelRatio), y: Math.round((window.screenY + rect.y + rect.height / 2) * devicePixelRatio) }; })()`);
        ctx.assert(cursor(point.x, point.y) !== 0, 'The native pointer reached the observed fixture control.');
        ctx.assert(foreground() === window && ancestor(atPoint(point), 2) === window, 'The observed screen point still belongs to the owned foreground fixture.');
        mouse(2, 0, 0, 0, 0);
        try { await pause(220); } finally { mouse(4, 0, 0, 0, 0); }
        await pause(700);
      }
      try {
        await ctx.waitFor("!document.getElementById('start').disabled");
        await ctx.prove('用户可以通过同一个 Node.js 采集器开始录制桌面操作', {
          voiceover: '我在操作录制工作台点击开始录制，状态显示录制中。',
          action: async () => ctx.eval("document.getElementById('start').click()"),
          assert: async () => {
            await ctx.waitFor("document.getElementById('capture-state').textContent.includes('录制中')");
            ctx.assert(await ctx.eval("document.getElementById('message').hidden || document.getElementById('message').dataset.tone !== 'error'"), 'Runtime diagnostics do not produce a recording error.');
          },
          screenshot: { name: 'node-recorder-running', requireText: ['录制中', '结束录制'] },
        });
        await nativeClick('#create');
        ctx.assert(await evaluate(fixture, "!document.getElementById('editor').hidden"), 'The real native click opened the project editor.');
        const { uIOhook, UiohookKey } = require('uiohook-napi');
        focus(window);
        for (const key of ['F', 'I', 'X', 'T', 'U', 'R', 'E']) { ctx.assert(foreground() === window, 'Native typing stays in the owned fixture.'); uIOhook.keyTap(UiohookKey[key]); await pause(50); }
        await pause(500);
        ctx.assert(foreground() === window, 'IME commit stays in the owned fixture.'); uIOhook.keyTap(UiohookKey.Enter);
        await pause(250);
        const inputValue = await evaluate(fixture, "document.getElementById('name').value");
        ctx.assert(inputValue.length > 0, 'Real native typing reached the labelled input, including the current IME.');
        await nativeClick('#save');
        ctx.assert(await evaluate(fixture, "document.getElementById('saved').textContent === '项目已保存'"), 'The real save click changed the fixture result.');
        await ctx.prove('保存的步骤明确页面、操作区域、按钮名称和点击位置', {
          voiceover: '结束录制后，新建项目这一步写明项目列表页面、右上方、项目操作工具栏和新建项目按钮。',
          action: async () => ctx.eval("document.getElementById('stop').click()"),
          assert: async () => {
            await ctx.waitFor("!document.getElementById('compile-area').hidden");
            await ctx.eval("if (!document.getElementById('review-area').open) document.querySelector('#review-area > summary').click()");
            await ctx.waitFor("Array.from(document.querySelectorAll('.step-target')).some(node => node.textContent.includes('项目列表') && node.textContent.includes('项目操作') && node.textContent.includes('新建项目') && node.textContent.includes('右上方'))");
            ctx.assert(await ctx.eval("document.getElementById('message').hidden || document.getElementById('message').dataset.tone !== 'error'"), 'Saved steps are unaffected by runtime warnings.');
          },
          screenshot: { name: 'detailed-page-region-control', requireText: ['项目列表', '项目操作', '新建项目', '右上方'] },
        });
        await ctx.prove('导出的 Skill 保留同一份详细步骤并使用输入变量', {
          voiceover: '生成的 Skill 同样说明每一步的页面和控件，输入使用变量，录制的输入原文不会进入导出。',
          action: async () => ctx.eval("document.getElementById('compile').click()"),
          assert: async () => {
            await ctx.waitFor("!document.getElementById('output-area').hidden");
            await ctx.eval("document.getElementById('draft-editor').open = true");
            const skill = await ctx.eval("document.getElementById('skill-markdown').value");
            ctx.assert(skill.includes('项目操作') && skill.includes('新建项目') && skill.includes('右上方'), 'Export contains the recorded page, region, control and relative position.');
            ctx.assert(/input_\d+/.test(skill), 'Export contains a captured input variable.');
            ctx.assert(!skill.includes(inputValue), 'The captured input value is absent from the exported Skill.');
          },
          screenshot: { name: 'detailed-skill-export', requireText: ['Skill 草稿已生成', '下载 Skill 插件'] },
        });
      } finally { cursor(originalPoint.x, originalPoint.y); if (originalWindow) focus(originalWindow); fixture.close(); }
    },
  }],
};
