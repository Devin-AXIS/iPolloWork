export default {
  id: "enterprise-empty-projects",
  title: "Entering an Enterprise starts with no projects and keeps project creation available",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_ENTERPRISE_EMPTY_PROJECTS"],
  steps: [{
    name: "Enter an Enterprise without creating an implicit project",
    run: async ctx => {
      await ctx.prove("首次进入企业时项目列表为空，不自动生成以企业命名的项目", {
        voiceover: "进入企业后，项目列表保持为空。需要项目时，再点击加号创建。",
        action: async () => {
          await ctx.waitFor("Boolean(window.__ipolloworkControl && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop)", { timeoutMs: 60_000 });
          // Use the real sign-in activation path and desktop IPC. Only the
          // already-verified external account is seeded in this isolated profile.
          const result = await ctx.eval(`(async () => {
            const connections = await import('/src/app/lib/enterprise-connections.ts');
            const contexts = await import('/src/app/lib/work-context.ts');
            localStorage.setItem('ipollowork.den.baseUrl', 'http://127.0.0.1:9');
            localStorage.setItem('ipollowork.den.authToken', 'isolated-enterprise-proof');
            connections.setEnterpriseConnectionAccount({ userId: 'enterprise-proof', baseUrl: 'http://127.0.0.1:9', token: 'isolated-enterprise-proof' });
            const connection = { id: 'ent_empty_projects', name: 'Enterprise Project Proof', shortName: 'Enterprise', origin: 'http://127.0.0.1:9', logoUrl: null, accent: 'blue', authMode: 'ipollo_oidc', membership: { id: 'proof-member', role: 'member', status: 'active' }, session: { token: 'isolated-member-proof', expiresAt: '2099-01-01T00:00:00.000Z' } };
            connections.saveEnterpriseConnection(connection);
            window.__enterpriseProjectsBefore = (await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('workspaceBootstrap')).workspaces.map(workspace => workspace.id).sort();
            const result = await contexts.activateEnterpriseWorkContext(connection);
            location.hash = '#/session';
            return { workspaceId: result, contextId: contexts.readActiveWorkContextId() };
          })()`, { awaitPromise: true });
          ctx.assert(result.workspaceId === null && result.contextId === "enterprise:ent_empty_projects", "The verified Enterprise becomes active without creating a workspace");
          await ctx.waitFor(`(() => {
            const route = window.__ipollowork?.slice?.('route');
            return route && !route.loading && !route.selectedWorkspaceId
              && !document.querySelector('[data-testid="startup-logo-animation"]')
              && Boolean(document.querySelector('[data-testid="new-project-button"]'));
          })()`, { timeoutMs: 60_000, label: "Enterprise empty project screen" });
        },
        assert: async () => {
          const state = await ctx.eval(`(async () => {
            const after = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('workspaceBootstrap');
            return { before: window.__enterpriseProjectsBefore, after: after.workspaces.map(workspace => workspace.id).sort(), projects: document.querySelectorAll('[data-testid="project-row"]').length, contextId: localStorage.getItem('ipollowork.work-context.v1') };
          })()`, { awaitPromise: true });
          ctx.assert(state.contextId === "enterprise:ent_empty_projects" && state.projects === 0 && JSON.stringify(state.before) === JSON.stringify(state.after), "No project row or workspace is added by entering the Enterprise");
          ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Enterprise activation leaves both the sidebar and native workspace registry unchanged", actual: state });
        },
        screenshot: { name: "enterprise-no-default-project", requireText: ["Projects"], rejectText: ["Something went wrong", "Workspace was not found"] },
      });
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
          const projects = await ctx.eval(`(async () => (await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('workspaceBootstrap')).workspaces.filter(workspace => workspace.workContextId === 'enterprise:ent_empty_projects').map(workspace => ({ name: workspace.name, contextId: workspace.workContextId })))()`, { awaitPromise: true });
          ctx.assert(projects.length === 1 && projects[0].name === "Customer Project", "Only the explicitly created project belongs to the Enterprise");
          ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "The user creates their first Enterprise project from the empty state", actual: projects });
        },
        screenshot: { name: "enterprise-created-project", requireText: ["Customer Project"], rejectText: ["Something went wrong"] },
      });
    },
  }],
};
