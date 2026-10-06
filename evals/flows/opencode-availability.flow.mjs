const faultScript = `(() => {
  localStorage.setItem('ipollowork.language', 'zh');
  const original = window.fetch.bind(window);
  const fault = window.__opencodeAvailabilityFault = { mode: 'hold', pending: [], failures: 0, catalogs: 0, paths: [] };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(url, location.origin).pathname;
    if (pathname.includes('provider')) fault.paths.push(pathname);
    if (pathname.endsWith('/provider')) {
      if (fault.mode === 'hold') await new Promise((resolve, reject) => fault.pending.push({ resolve, reject }));
      if (fault.mode === 'fail') { fault.failures++; throw new Error('Request timed out.'); }
      const response = await original(input, init);
      if (response.ok) {
        const data = await response.clone().json();
        if (data.all?.some(provider => Object.keys(provider.models ?? {}).length)) fault.catalogs++;
      }
      return response;
    }
    return original(input, init);
  };
})();`;

async function state(ctx) {
  return ctx.eval(`(() => {
    const shell = document.querySelector('[data-testid="new-conversation-starter-composer-shell"]');
    const run = shell?.querySelector('button[title="Run task"], button[title="运行任务"]');
    return { text: shell?.innerText ?? '', disabled: run?.disabled,
      catalogs: window.__opencodeAvailabilityFault?.catalogs ?? 0,
      failures: window.__opencodeAvailabilityFault?.failures ?? 0 };
  })()`);
}

async function assertNoFalseUnavailable(ctx) {
  const value = await state(ctx);
  ctx.assert(!/模型已不可用|Model no longer available|OpenCode unavailable/.test(value.text),
    'A transport failure was presented as model or engine unavailability.');
  await ctx.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    { awaitPromise: true });
  return value;
}

export default {
  id: 'opencode-availability',
  title: 'OpenCode catalog loading, transport failures and recovery preserve accurate model readiness',
  kind: 'user-facing',
  steps: [{
    name: 'Load and recover the real OpenCode catalog under controlled transport faults',
    run: async ctx => {
      await ctx.client.send('Page.enable');
      const { identifier } = await ctx.client.send('Page.addScriptToEvaluateOnNewDocument', { source: faultScript });
      try {
        await ctx.client.send('Page.reload', { ignoreCache: true });
        await ctx.waitFor("window.__opencodeAvailabilityFault?.pending.length > 0", {
          timeoutMs: 60000, label: 'held model catalog request',
        });
        await ctx.prove('A cold model directory shows loading and keeps sending disabled', {
          voiceover: '模型目录尚未返回时，输入框显示正在读取目录，不会误报模型已不可用。',
          action: async () => {
            await ctx.waitForText('正在读取模型目录', { timeoutMs: 10000 });
            await ctx.waitFor("!document.getElementById('ipollowork-startup-splash') && !document.querySelector('[data-testid=\"startup-logo-animation\"]')", { timeoutMs: 10000 });
            await ctx.eval(`(() => {
              const editor = document.querySelector('[data-testid="new-conversation-starter-composer-shell"] [contenteditable="true"]');
              editor.focus(); const data = new DataTransfer(); data.setData('text/plain', '模型加载恢复验证');
              editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
              return true;
            })()`);
          },
          assert: async () => {
            const value = await assertNoFalseUnavailable(ctx);
            ctx.assert(value.disabled === true, 'Sending was enabled before model discovery completed.');
          },
          screenshot: { name: 'model-catalog-loading', requireText: ['正在读取模型目录'], rejectText: ['模型已不可用'] },
        });

        await ctx.prove('Repeated catalog timeouts provide a retry action without claiming model removal', {
          voiceover: '目录请求超时后显示加载失败和重试入口，草稿保留。',
          action: async () => {
            await ctx.eval(`(() => {
              const fault = window.__opencodeAvailabilityFault; fault.mode = 'fail';
              fault.pending.splice(0).forEach(item => item.reject(new Error('Request timed out.'))); return true;
            })()`);
            await ctx.waitForText('模型目录加载失败', { timeoutMs: 45000 });
          },
          assert: async () => {
            const value = await assertNoFalseUnavailable(ctx);
            ctx.assert(value.disabled === true, 'Sending was enabled without an executable model.');
            ctx.assert(value.text.includes('重试'), 'Catalog failure has no retry action.');
            ctx.assert(value.text.includes('模型加载恢复验证'), 'The draft was lost during failed discovery.');
          },
          screenshot: { name: 'model-catalog-retry', requireText: ['模型目录加载失败', '重试'], rejectText: ['模型已不可用'] },
        });

        await ctx.prove('Retry reads the real OpenCode catalog and restores the same draft to a sendable state', {
          voiceover: '点击重试后读取真实 OpenCode 模型目录，原草稿保留，运行任务恢复可用。',
          action: async () => {
            await ctx.eval("window.__opencodeAvailabilityFault.mode = 'pass'; true");
            await ctx.clickText('模型目录加载失败', { selector: 'button' });
            await ctx.waitFor(`(() => {
              const shell = document.querySelector('[data-testid="new-conversation-starter-composer-shell"]');
              const run = shell?.querySelector('button[title="Run task"], button[title="运行任务"]');
              return window.__opencodeAvailabilityFault?.catalogs > 0 && run && !run.disabled;
            })()`, { timeoutMs: 120000, label: 'real catalog and enabled run button' });
          },
          assert: async () => {
            const value = await assertNoFalseUnavailable(ctx);
            ctx.assert(value.catalogs > 0 && value.disabled === false, 'The real catalog did not restore readiness.');
            ctx.assert(value.text.includes('模型加载恢复验证'), 'The recovered catalog replaced the draft.');
          },
          screenshot: { name: 'model-catalog-recovered', requireText: ['模型加载恢复验证'], rejectText: ['模型目录加载失败', '模型已不可用'] },
        });

        await ctx.prove('A failed background refresh keeps the previously confirmed model executable', {
          voiceover: '后台刷新超时后查看当前模型，原选择和草稿仍保留，发送仍可用。',
          action: async () => {
            const previousFailures = await ctx.eval(`(async () => {
              const fault = window.__opencodeAvailabilityFault; fault.mode = 'fail';
              const previousFailures = fault.failures;
              const { getReactQueryClient } = await import('/src/react-app/infra/query-client.ts');
              const { refreshProviderListQueries } = await import('/src/react-app/infra/provider-list-query.ts');
              await refreshProviderListQueries(getReactQueryClient()); return previousFailures;
            })()`, { awaitPromise: true });
            await ctx.waitFor(`window.__opencodeAvailabilityFault.failures > ${previousFailures}`, { timeoutMs: 10000 });
            await ctx.trustedClick('[data-testid="new-conversation-starter-composer-shell"] button[aria-label^="切换模型"]');
            await ctx.waitForText('切换模型', { timeoutMs: 10000 });
          },
          assert: async () => {
            const value = await assertNoFalseUnavailable(ctx);
            ctx.assert(value.disabled === false, 'A failed refresh disabled the previously confirmed model.');
          },
          screenshot: { name: 'model-retained-on-refresh-failure', requireText: ['模型加载恢复验证'], rejectText: ['模型已不可用'] },
        });
      } catch (error) {
        ctx.output('Fault injection diagnostics', JSON.stringify(await ctx.eval(`({
          url: location.pathname,
          fault: window.__opencodeAvailabilityFault ? {
            mode: window.__opencodeAvailabilityFault.mode,
            paths: window.__opencodeAvailabilityFault.paths,
            pending: window.__opencodeAvailabilityFault.pending.length,
            failures: window.__opencodeAvailabilityFault.failures,
            catalogs: window.__opencodeAvailabilityFault.catalogs
          } : null
        })`)));
        throw error;
      } finally {
        await ctx.client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
        await ctx.eval("if (window.__opencodeAvailabilityFault) window.__opencodeAvailabilityFault.mode = 'pass'; true");
      }
    },
  }],
};
