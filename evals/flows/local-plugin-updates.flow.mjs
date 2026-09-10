const plugins = [
  { id: 'xiaohongshu-ops', name: '小红书' },
  { id: 'douyin-ops', name: '抖音' },
];

function card(id, action) {
  const name = plugins.find(plugin => plugin.id === id).name;
  return `(() => {
    const rows = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')];
    const row = rows.find(row => row.innerText.includes(${JSON.stringify(name)}));
    if (!row) return false;
    const button = [...row.querySelectorAll('button')].find(button => /^(安装|更新|Install|Update)$/.test(button.textContent.trim()));
    ${action ? "if (button && !button.disabled) { row.scrollIntoView({block:'center'}); button.click(); return true; }" : 'return Boolean(button && !button.disabled);'}
    return false;
  })()`;
}

export default {
  id: 'local-plugin-updates',
  title: 'Install the latest signed social plugins from local package',
  kind: 'user-facing',
  steps: [{
    name: 'Open the personal plugin catalog',
    run: async ctx => {
      await ctx.waitFor('Boolean(window.__ipolloworkControl)');
      await ctx.eval(`(() => {
        window.__restoreSocialReleaseProof?.();
        window.__socialReleaseProof = {catalog: [], installs: []};
        const original = window.fetch;
        window.__restoreSocialReleaseProof = () => { window.fetch = original; };
        window.fetch = async (...args) => {
          const response = await original(...args);
          if (/\\/plugin-packages\\/catalog$/.test(response.url)) {
            const data = await response.clone().json();
            window.__socialReleaseProof.catalog = data.items;
            window.__socialReleaseProof.errors = data.errors;
          }
          if (/\\/plugin-packages\\/catalog\\/(xiaohongshu-ops|douyin-ops)\\/install$/.test(response.url)) {
            window.__socialReleaseProof.installs.push({status: response.status, data: await response.clone().json()});
          }
          return response;
        };
      })()`);
      await ctx.navigateHash('/settings/extensions');
      await ctx.waitFor(`document.querySelector('[data-testid="plugin-library-heading"]') !== null`, {timeoutMs: 30_000});
      await ctx.eval(`(() => { [...document.querySelectorAll('button')].find(b => ['个人','Personal'].includes(b.textContent.trim()))?.click(); })()`);
      await ctx.waitFor('window.__socialReleaseProof.catalog.length > 0', {timeoutMs: 60_000});
      const catalog = await ctx.eval('window.__socialReleaseProof');
      for (const plugin of plugins) {
        const entry = catalog.catalog.find(item => item.pluginId === plugin.id);
        ctx.assert(entry?.integrity.status === 'verified', `Missing verified release: ${plugin.id}; ${catalog.errors}`);
      }
      await ctx.output('local-catalog', JSON.stringify(catalog, null, 2));
    },
  }, ...plugins.map(plugin => ({
    name: `Install ${plugin.name} from its latest local package release`,
    run: async ctx => {
      await ctx.prove(`${plugin.name} installs the latest signed local package version`, {
        voiceover: `在插件列表点击更新，${plugin.name}会读取本机生成的最新插件包，安装后的版本保存在主软件中。`,
        action: async () => {
          await ctx.waitFor(card(plugin.id, false), {timeoutMs: 30_000, label: `${plugin.id} update action`});
          ctx.assert(await ctx.eval(card(plugin.id, true)), 'The install action was not available');
          await ctx.waitFor(`window.__socialReleaseProof.installs.some(result => result.data.item?.pluginId === ${JSON.stringify(plugin.id)})`, {timeoutMs: 60_000, label: `${plugin.id} installation result`});
          await ctx.navigateHash(`/settings/extensions/plugin/${plugin.id}`);
          await ctx.waitForText(plugin.name, {timeoutMs: 30_000});
          await ctx.waitForText('卸载插件', {timeoutMs: 30_000});
        },
        assert: async () => {
          const proof = await ctx.eval(`window.__socialReleaseProof`);
          const latest = proof.catalog.find(item => item.pluginId === plugin.id);
          const installed = proof.installs.find(result => result.data.item?.pluginId === plugin.id);
          ctx.assert(installed.status === 200 && installed.data.item.version === latest.version, 'Installed version differs from the current local package release');
          ctx.assert(installed.data.item.integrity.status === 'verified', 'Installed checksum was not verified');
          ctx.assert(installed.data.item.manifest.package.signature.keyId === 'social-plugins-2026', 'Installed publisher signature was not retained');
          await ctx.output(`${plugin.id}-installed`, JSON.stringify(installed.data.item, null, 2));
        },
        screenshot: {name: `${plugin.id}-latest-installed`, requireText: [plugin.name, '卸载插件'], rejectText: ['Something went wrong'], hashIncludes: `/settings/extensions/plugin/${plugin.id}`, fromSurface: false},
      });
      await ctx.navigateHash('/settings/extensions');
    },
  })), {
    name: 'Restore the observation hook',
    run: async ctx => { await ctx.eval('window.__restoreSocialReleaseProof?.(); delete window.__restoreSocialReleaseProof; delete window.__socialReleaseProof;'); },
  }],
};
