const origin = process.env.XHS_OPS_ORIGIN;
const removedId = Number(process.env.XHS_OPS_PROOF_ACCOUNT_ID);
const retainedId = Number(process.env.XHS_OPS_PROOF_RETAIN_ACCOUNT_ID);
const avatarUrl = process.env.XHS_OPS_PROOF_AVATAR_URL;

export default {
  id: 'xiaohongshu-account-binding',
  title: '小红书账号真实头像与删除绑定',
  kind: 'user-facing',
  requiredEnv: ['XHS_OPS_ORIGIN', 'XHS_OPS_PROOF_ACCOUNT_ID', 'XHS_OPS_PROOF_RETAIN_ACCOUNT_ID', 'XHS_OPS_PROOF_AVATAR_URL', 'XHS_OPS_DISPOSABLE_FIXTURE'],
  preserveTheme: true,
  cdpTarget: { urlIncludes: origin },
  steps: [{
    name: '在独立验证数据中展示真实头像、取消删除并确认删除',
    async run(ctx) {
      ctx.assert(process.env.XHS_OPS_DISPOSABLE_FIXTURE === '1', 'Deletion proof requires an explicitly disposable fixture.');
      ctx.assert(new URL(origin).hostname === '127.0.0.1' && new URL(origin).port !== '4790', 'Use a dedicated local fixture server.');
      ctx.assert(Number.isInteger(removedId) && removedId > 0 && Number.isInteger(retainedId) && retainedId > 0 && removedId !== retainedId, 'Provide two distinct fixture account IDs.');
      const removed = `[data-account-id="${removedId}"]`;
      const retained = `[data-account-id="${retainedId}"]`;
      let retainedBefore;
      await ctx.prove('账号卡片显示从真实创作台页面同步的头像', {
        voiceover: '独立验证数据中的数字飓风使用了实际创作台页面的头像。旁边保留一个验证账号，用于检查删除是否影响其他账号。',
        action: async () => {
          await ctx.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
          await ctx.client.send('Page.navigate', { url: origin + '/accounts' });
          await ctx.waitFor(`document.readyState === 'complete' && document.querySelector('${removed} img')?.naturalWidth > 0`);
        },
        assert: async () => {
          const state = await ctx.eval(`({src: document.querySelector('${removed} img').src, visible: !document.querySelector('${removed} img').hidden, retained: document.querySelector('${retained}')?.outerHTML, overflow: document.documentElement.scrollWidth > innerWidth + 1})`);
          ctx.assert(state.src === avatarUrl && state.visible && state.retained && !state.overflow, 'The real avatar or second account is missing.');
          retainedBefore = state.retained;
        },
        screenshot: { name: 'real-account-avatar', requireText: ['数字飓风', '保留账号（验证）', '删除绑定'] },
      });
      await ctx.prove('删除确认明确显示目标账号，取消后两个账号仍保留', {
        voiceover: '点击删除绑定后，弹窗会说明删除的是哪个账号，并保留历史记录。取消操作不会删除账号。',
        action: async () => {
          await ctx.eval(`document.querySelector('${removed} [data-delete-account]').click()`);
          await ctx.waitFor(`document.querySelector('#account-delete-dialog').open`);
          await ctx.eval(`document.querySelector('#account-delete-dialog [value="cancel"]').click()`);
          await ctx.waitFor(`!document.querySelector('#account-delete-dialog').open`);
          ctx.assert(await ctx.eval(`Boolean(document.querySelector('${removed}') && document.querySelector('${retained}'))`), 'Cancel removed an account.');
          await ctx.eval(`document.querySelector('${removed} [data-delete-account]').click()`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('#account-delete-dialog').open && document.querySelector('[data-delete-account-name]').textContent === '数字飓风'`), 'Confirmation names the wrong account.');
        },
        screenshot: { name: 'confirm-account-removal', requireText: ['删除账号绑定', '历史记录保留', '取消'] },
      });
      await ctx.prove('确认后只移除选中的账号绑定', {
        voiceover: '确认后，选中的验证账号从列表移除，另一个账号的资料和状态保持不变。本次验证没有修改实际运营数据。',
        action: async () => {
          await ctx.eval(`document.querySelector('[data-confirm-delete-account]').click()`);
          await ctx.waitFor(`document.readyState === 'complete' && !document.querySelector('${removed}') && Boolean(document.querySelector('${retained}')) && !document.querySelector('#account-delete-dialog').open`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('${retained}').outerHTML`) === retainedBefore, 'Deleting one account changed another account.');
        },
        screenshot: { name: 'only-selected-binding-removed', requireText: ['保留账号（验证）', '1 个账号'], rejectText: ['数字飓风'] },
      });
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
    },
  }],
};
