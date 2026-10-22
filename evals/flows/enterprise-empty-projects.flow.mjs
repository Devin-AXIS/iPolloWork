import { createServer } from "node:http";

export default {
  id: "enterprise-empty-projects",
  title: "Entering an Enterprise starts with no projects and keeps project creation available",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_ENTERPRISE_EMPTY_PROJECTS"],
  steps: [{
    name: "Enter an Enterprise without showing the internal runtime as a project",
    run: async ctx => {
      // Only the external Enterprise catalog is a fixture; navigation, source
      // selection, workspace storage and the packaged local collection are real.
      const catalogRequests = [];
      const catalogServer = createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.url?.startsWith('/api/v1/resources?')) {
          catalogRequests.push({ path: request.url, authorized: request.headers.authorization === 'Bearer isolated-member-proof' });
          response.end(JSON.stringify({ items: [{ id: 'enterprise-plugin-proof', type: 'extension', status: 'published', slug: 'enterprise-plugin-proof', name: 'Enterprise Catalog Proof', description: 'Authorized Enterprise plugin', category: 'productivity-collaboration', enterpriseCategory: 'Tools', updatedAt: new Date().toISOString(), latestVersion: { version: '1.0.0', digest: 'a'.repeat(64), downloadPath: '/api/v1/resources/enterprise-plugin-proof/download' } }], nextCursor: null }));
        } else { response.statusCode = 404; response.end('{}'); }
      });
      await new Promise(resolve => catalogServer.listen(0, '127.0.0.1', resolve));
      const enterpriseOrigin = 'http://127.0.0.1:' + catalogServer.address().port;
      try {
      await ctx.prove("首次进入企业时项目列表为空，不显示以企业命名的默认项目", {
        voiceover: "进入企业后，项目列表保持为空。需要项目时，再点击加号创建。",
        action: async () => {
          await ctx.waitFor("Boolean(window.__ipolloworkControl && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop)", { timeoutMs: 60_000 });
          await ctx.waitFor(`!document.querySelector('#ipollowork-startup-splash, [data-testid="startup-logo-animation"]')`, { timeoutMs: 60_000 });
          // Use the real sign-in activation path and desktop IPC. Only the
          // already-verified external account is seeded in this isolated profile.
          const result = await ctx.eval(`(async () => {
            const connections = await import('/src/app/lib/enterprise-connections.ts');
            const contexts = await import('/src/app/lib/work-context.ts');
            const den = await import('/src/app/lib/den.ts');
            // Desktop settings read the native bootstrap, not the web URL key.
            await den.setDenBootstrapConfig({ baseUrl: 'http://127.0.0.1:9', requireSignin: false });
            localStorage.setItem('ipollowork.den.authToken', 'isolated-enterprise-proof');
            connections.setEnterpriseConnectionAccount({ userId: 'enterprise-proof', baseUrl: 'http://127.0.0.1:9', token: 'isolated-enterprise-proof' });
            const connection = { id: 'ent_empty_projects', name: 'Enterprise Project Proof', shortName: 'Enterprise', origin: ${JSON.stringify(enterpriseOrigin)}, logoUrl: null, accent: 'blue', authMode: 'ipollo_oidc', membership: { id: 'proof-member', role: 'member', status: 'active' }, session: { token: 'isolated-member-proof', expiresAt: '2099-01-01T00:00:00.000Z' } };
            connections.saveEnterpriseConnection(connection);
            const result = await contexts.activateEnterpriseWorkContext(connection);
            window.__enterpriseRuntimeWorkspaceId = result;
            location.hash = '#/session';
            return { workspaceId: result, contextId: contexts.readActiveWorkContextId() };
          })()`, { awaitPromise: true });
          ctx.assert(Boolean(result.workspaceId) && result.contextId === "enterprise:ent_empty_projects", "The verified Enterprise has an internal runtime without exposing a default project");
          await ctx.waitFor(`(() => {
            const route = window.__ipollowork?.slice?.('route');
            return route && !route.loading && route.selectedWorkspaceId === window.__enterpriseRuntimeWorkspaceId
              && !document.querySelector('[data-testid="startup-logo-animation"]')
              && Boolean(document.querySelector('[data-testid="new-project-button"]'));
          })()`, { timeoutMs: 60_000, label: "Enterprise empty project screen" });
        },
        assert: async () => {
          const state = await ctx.eval(`(async () => {
            const after = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('workspaceBootstrap');
            const runtime = after.workspaces.find(workspace => workspace.id === window.__enterpriseRuntimeWorkspaceId);
            return { projects: document.querySelectorAll('[data-testid="project-row"]').length, contextId: localStorage.getItem('ipollowork.work-context.v1'), runtimeContextId: runtime?.workContextId, userProjectCount: after.workspaces.filter(workspace => workspace.workContextId === 'enterprise:ent_empty_projects' && workspace.id !== window.__enterpriseRuntimeWorkspaceId).length };
          })()`, { awaitPromise: true });
          ctx.assert(state.contextId === "enterprise:ent_empty_projects" && state.projects === 0 && state.userProjectCount === 0 && state.runtimeContextId === state.contextId, "Entering the Enterprise shows no project rows while retaining its isolated runtime");
          ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Enterprise activation keeps the user project list empty and its internal runtime available", actual: state });
        },
        screenshot: { name: "enterprise-no-default-project", requireText: ["Projects"], rejectText: ["Something went wrong", "Workspace was not found"] },
      });
      await ctx.prove("尚未创建项目时仍可查看包含插件工坊的最新本地插件集", {
        voiceover: "还没有创建项目时，扩展页的个人资源中仍能看到本地插件集和插件工坊。",
        action: async () => {
          await ctx.navigateHash('/settings/extensions');
          await ctx.waitFor(`Array.from(document.querySelectorAll('button')).some(button => /^(?:Personal|个人)$/.test(button.textContent.trim()))`, { timeoutMs: 60_000 });
          await ctx.eval(`Array.from(document.querySelectorAll('button')).find(button => /^(?:Personal|个人)$/.test(button.textContent.trim())).click()`);
          await ctx.waitFor(`document.querySelectorAll('[data-testid="plugin-package-list-item"]').length >= 20`, { timeoutMs: 60_000, label: "local plugin collection without user projects" });
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.body.innerText.includes('Plugin Workshop') || document.body.innerText.includes('插件工坊')`), "Plugin Workshop remains available before a user creates their first Enterprise project");
        },
        screenshot: { name: "enterprise-plugins-before-projects", requireText: ["Figma"], rejectText: ["Install targets already exist with different content", "Something went wrong"] },
      });
      await ctx.prove("插件的个人、公开和企业来源集中在已安装列表下方", {
        voiceover: "插件来源统一放在已安装列表下面，可以直接切换个人、公开和当前企业。",
        action: async () => {
          await ctx.trustedClick('[data-testid="plugin-library-source"] [role="tab"]:nth-child(2)');
          await ctx.waitFor(`document.querySelector('[data-testid="plugin-library-source"] [role="tab"]:nth-child(2)')?.getAttribute('aria-selected') === 'true' && !document.querySelectorAll('[data-testid="plugin-package-list-item"]').length`);
        },
        assert: async () => {
          const placement = await ctx.eval(`(() => {
            const section = document.querySelector('[data-testid="plugin-library-source"]');
            const installed = document.querySelector('[data-testid="plugin-library-installed"]');
            return { count: section.querySelectorAll('[role="tab"]').length, belowInstalled: section.getBoundingClientRect().top >= installed.getBoundingClientRect().bottom, oldSwitchCount: document.querySelectorAll('[aria-label="Resource source"], [aria-label="资源来源"]').length };
          })()`);
          ctx.assert(placement.count === 3 && placement.belowInstalled && placement.oldSwitchCount === 0, 'One source selector contains all three scopes below installed plugins');
          ctx.recordEvidence({ type: 'assertion', status: 'passed', assertion: 'The lower source selector replaces the separate upper resource scope control', actual: placement });
        },
        screenshot: { name: 'plugins-public-source', requireText: ['Public', 'Enterprise Project Proof'], rejectText: ['Something went wrong'] },
      });
      await ctx.prove("切换企业后显示该企业授权的插件，个人目录仍可切回", {
        voiceover: "选择企业，就会显示当前企业授权的插件；个人目录仍然可以随时切回。",
        action: async () => {
          await ctx.trustedClick('[data-testid="plugin-library-source"] [role="tab"]:nth-child(3)');
          await ctx.waitForText('Enterprise Catalog Proof', { timeoutMs: 60_000 });
          await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
          await ctx.waitFor(`window.innerWidth === 900 && document.querySelector('[data-testid="plugin-library-source"]')?.clientWidth > 0`);
        },
        assert: async () => {
          ctx.assert(catalogRequests.some(request => request.path.includes('type=extension') && request.authorized), 'Enterprise plugins are requested with the current Enterprise account');
          ctx.assert(await ctx.eval(`(() => { const source = document.querySelector('[data-testid="plugin-library-source"]'); return source.querySelector('[role="tab"]:nth-child(3)').getAttribute('aria-selected') === 'true' && source.scrollWidth <= source.clientWidth; })()`), 'Enterprise is selected without horizontal overflow at 900px');
          ctx.recordEvidence({ type: 'assertion', status: 'passed', assertion: 'Enterprise source uses its bound account and displays the authorized catalog', actual: { authorized: true, width: 900 } });
        },
        screenshot: { name: 'plugins-enterprise-source', requireText: ['Enterprise Catalog Proof', 'Enterprise Project Proof'], rejectText: ['Something went wrong'] },
      });
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      await ctx.trustedClick('[data-testid="plugin-library-source"] [role="tab"]:nth-child(1)');
      await ctx.waitFor(`document.querySelectorAll('[data-testid="plugin-package-list-item"]').length >= 20`, { timeoutMs: 60_000 });
      await ctx.navigateHash('/session');
      await ctx.waitFor(`Boolean(document.querySelector('[data-testid="new-project-button"]')) && document.querySelectorAll('[data-testid="project-row"]').length === 0 && window.__ipollowork?.slice?.('route')?.loading === false`, { timeoutMs: 60_000 });
      await ctx.prove("企业的空项目页仍能创建自己的项目", {
        voiceover: "点击项目旁的加号，创建自己的项目，列表中只显示这个新项目。",
        action: async () => {
          await ctx.trustedClick('[data-testid="new-project-button"]');
          await ctx.fill('#create-project-name', 'Customer Project');
          await ctx.eval(`(() => {
            const dialog = document.querySelector('[data-testid="create-project-dialog"]');
            const button = [...dialog.querySelectorAll('button')].find(button => /^(?:New project|新建项目)$/.test(button.textContent.trim()));
            if (!button || button.disabled) throw new Error('Create project is unavailable');
            button.click();
          })()`);
          await ctx.waitFor(`document.querySelectorAll('[data-testid="project-row"]').length === 1 && document.body.innerText.includes('Customer Project') && !document.querySelector('[data-testid="create-project-dialog"]')`, { timeoutMs: 60_000, label: "user-created Enterprise project" });
        },
        assert: async () => {
          const projects = await ctx.eval(`(async () => (await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('workspaceBootstrap')).workspaces.filter(workspace => workspace.workContextId === 'enterprise:ent_empty_projects' && workspace.id !== window.__enterpriseRuntimeWorkspaceId).map(workspace => ({ name: workspace.name, contextId: workspace.workContextId })))()`, { awaitPromise: true });
          ctx.assert(projects.length === 1 && projects[0].name === "Customer Project", "Only the explicitly created project belongs to the Enterprise");
          ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "The user creates their first Enterprise project from the empty state", actual: projects });
        },
        screenshot: { name: "enterprise-created-project", requireText: ["Customer Project"], rejectText: ["Something went wrong"] },
      });
      } finally {
        await new Promise(resolve => { catalogServer.close(resolve); catalogServer.closeAllConnections(); });
      }
    },
  }],
};
