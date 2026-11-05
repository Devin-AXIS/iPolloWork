import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export default {
  id: 'douyin-web-login',
  title: '抖音网页登录不唤起电脑客户端（真实 Electron，模拟登录网页）',
  kind: 'user-facing',
  requiresApp: false,
  steps: [{
    name: '客户端跳转被拦截，网页登录仍可操作',
    async run(ctx) {
      const file = 'douyin-web-login.png';
      const voiceover = '网页登录保持在浏览器中，网页尝试唤起客户端时不打开系统应用，扫码入口和正常网页跳转仍然可用。';
      await ctx.prove('真实浏览器拦截弹窗、主框架、子框架和重定向中的客户端链接，网页弹窗保持同一账号环境', {
        voiceover,
        async assert() {
          const result = await promisify(execFile)(process.execPath, ['--test', fileURLToPath(new URL('../../apps/desktop/electron/browser-panel.test.mjs', import.meta.url))], {
            timeout: 45000, windowsHide: true,
            env: { ...process.env, IPOLLOWORK_BROWSER_TEST_PROOF_FILE: join(ctx.outDir, file) },
          });
          ctx.output('真实 Electron 浏览器回归测试', result.stdout);
          ctx.assert(result.stdout.includes('# fail 0'), '所有浏览器行为断言通过，系统应用启动调用为零');
          const png = await readFile(join(ctx.outDir, file));
          ctx.assert(png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), '截图为真实 PNG');
          const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
          ctx.assert(width > 0 && height > 0, '截图有有效尺寸');
          const frame = { type: 'frame', status: 'passed', file, name: '客户端唤起被拦截后仍可选择扫码登录',
            claim: '测试网页的扫码入口仍能操作；真实 Electron 行为断言确认客户端唤起被拦截', voiceover,
            validations: [{ label: '真实 Electron 行为断言通过', passed: true }, { label: 'PNG 尺寸有效', passed: true, detail: `${width}x${height}` }] };
          ctx.screenshots.push(file); ctx.evidenceFrames.push(frame); ctx.recordEvidence(frame);
        },
      });
    },
  }],
};
