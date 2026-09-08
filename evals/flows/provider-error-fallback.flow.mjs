const message = "第三方服务暂时不可用，请稍后重试。";

export default {
  id: "provider-error-fallback",
  title: "Authorization Center shows a safe provider outage and remains retryable",
  kind: "user-facing",
  preserveTheme: true,
  steps: [{
    name: "A simulated provider failure is visible without changing credentials",
    async run(ctx) {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
      // Renderer-only fixtures: exercise the real client + React error state,
      // with no credential writes or requests to a real provider.
      await ctx.eval(`(() => {
        const original = window.fetch;
        window.__providerErrorProof = { original, calls: 0 };
        window.fetch = async (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
          if (url.pathname === '/authorization-services') return Response.json({ items: [{
            id: 'openai-images', configured: true, fields: [{ key: 'OPENAI_API_KEY', configured: true }],
            browserLogin: { providerId: 'openai', connected: false }
          }] });
          if (url.pathname === '/authorization-services/openai-images/test') {
            window.__providerErrorProof.calls++;
            return Response.json({ code: 'provider_unavailable', message: 'Service Unavailable' }, { status: 503 });
          }
          return original(input, init);
        };
      })()`);
      try {
        await ctx.navigateHash('/settings/authorizations');
        await ctx.waitFor(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '测试连接' && !b.disabled)`, { timeoutMs: 20_000 });
        await ctx.prove("A provider outage appears in Chinese, and the connection-test button is usable again", {
          voiceover: "第三方服务暂时不可用时，授权中心显示清晰的中文提示，不会误报 Key 失效，也不会卡住测试按钮。",
          action: () => ctx.clickText('测试连接', { selector: 'button', exact: true }),
          assert: async () => {
            await ctx.waitForText(message);
            ctx.assert(await ctx.eval('window.__providerErrorProof.calls === 1'), 'One user action issued exactly one test request.');
            ctx.assert(await ctx.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '测试连接' && !b.disabled)`), 'The user can retry the test.');
            await ctx.expectNoText('Unexpected server error');
            await ctx.expectNoText('JSON Parse error');
          },
          screenshot: { name: 'provider-outage-fallback', requireText: [message, '测试连接'], rejectText: ['Unexpected server error', 'JSON Parse error'] },
        });
      } finally {
        await ctx.eval(`(() => { if (window.__providerErrorProof) { window.fetch = window.__providerErrorProof.original; delete window.__providerErrorProof; } })()`);
      }
    },
  }],
};
