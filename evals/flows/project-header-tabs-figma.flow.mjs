import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "project-header-tabs-figma";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const state = {
  workspacePath: null,
  workspaceId: null,
  previousWorkspaceId: null,
  previousTheme: null,
  previousLanguage: null,
};

async function setupProject(ctx) {
  state.workspacePath = await mkdtemp(join(tmpdir(), "ipollowork-project-tabs-fraimz-"));
  state.previousTheme = await ctx.eval(`localStorage.getItem('ipollowork.react.settings.theme-mode')`);
  state.previousLanguage = await ctx.eval(`localStorage.getItem('ipollowork.language')`);
  await ctx.eval(`(() => {
    localStorage.setItem('ipollowork.react.settings.theme-mode', 'light');
    localStorage.setItem('ipollowork.language', 'zh');
    location.reload();
    return true;
  })()`);
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "control API after theme change" });

  const result = await ctx.eval(`(async () => {
    const port = localStorage.getItem('ipollowork.server.port');
    const token = localStorage.getItem('ipollowork.server.token');
    const hostToken = localStorage.getItem('ipollowork.server.hostToken');
    const previousWorkspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1]
      || localStorage.getItem('ipollowork.react.activeWorkspace')
      || '';
    if (!port || !token || !hostToken) return { ok: false, reason: 'missing local server context' };

    const baseUrl = 'http://127.0.0.1:' + port;
    const headers = {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      'x-ipollowork-host-token': hostToken,
    };
    const response = await fetch(baseUrl + '/workspaces/local', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        folderPath: ${JSON.stringify(state.workspacePath)},
        name: 'Template applied: Knowledge Architecture Blueprint',
        preset: 'starter',
      }),
    });
    const payloadText = await response.text();
    if (!response.ok) return { ok: false, reason: payloadText };
    const payload = JSON.parse(payloadText);
    const workspaceId = payload.activeId
      || payload.workspaces?.find((workspace) => workspace.path === ${JSON.stringify(state.workspacePath)})?.id;
    if (!workspaceId) return { ok: false, reason: 'workspace id missing' };

    const activated = await fetch(baseUrl + '/workspaces/' + encodeURIComponent(workspaceId) + '/activate?persist=true', {
      method: 'POST',
      headers,
    });
    if (!activated.ok) return { ok: false, reason: await activated.text() };
    localStorage.setItem('ipollowork.react.activeWorkspace', workspaceId);
    return { ok: true, workspaceId, previousWorkspaceId };
  })()`, { awaitPromise: true });

  ctx.assert(result?.ok && result.workspaceId, `Could not create the isolated project: ${JSON.stringify(result)}`);
  state.workspaceId = result.workspaceId;
  state.previousWorkspaceId = result.previousWorkspaceId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ctx.eval(`(async () => {
      const port = localStorage.getItem('ipollowork.server.port');
      const token = localStorage.getItem('ipollowork.server.token');
      const hostToken = localStorage.getItem('ipollowork.server.hostToken');
      if (!port || !token || !hostToken) return false;
      const response = await fetch('http://127.0.0.1:' + port + '/workspaces/' + encodeURIComponent(${JSON.stringify(result.workspaceId)}) + '/activate?persist=true', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'x-ipollowork-host-token': hostToken,
        },
      });
      if (response.ok) localStorage.setItem('ipollowork.react.activeWorkspace', ${JSON.stringify(result.workspaceId)});
      return response.ok;
    })()`, { awaitPromise: true });
    await ctx.navigateHash(`/workspace/${result.workspaceId}/session`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const routeStayed = await ctx.eval(`location.hash.includes(${JSON.stringify(`/workspace/${result.workspaceId}/session`)})`);
    if (routeStayed) break;
  }
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="session-header-work-navigation"]'))`, {
    timeoutMs: 90_000,
    label: "project header tabs",
  });
}

async function cleanupProject(ctx) {
  await ctx.client.send("Emulation.clearDeviceMetricsOverride");
  const result = await ctx.eval(`(async () => {
    const port = localStorage.getItem('ipollowork.server.port');
    const token = localStorage.getItem('ipollowork.server.token');
    const hostToken = localStorage.getItem('ipollowork.server.hostToken');
    if (!port || !token || !hostToken) return false;
    const baseUrl = 'http://127.0.0.1:' + port;
    const headers = {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      'x-ipollowork-host-token': hostToken,
    };
    const previousWorkspaceId = ${JSON.stringify(state.previousWorkspaceId)};
    if (previousWorkspaceId) {
      await fetch(baseUrl + '/workspaces/' + encodeURIComponent(previousWorkspaceId) + '/activate?persist=true', {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined);
      localStorage.setItem('ipollowork.react.activeWorkspace', previousWorkspaceId);
    }
    const removed = await fetch(baseUrl + '/workspaces/' + encodeURIComponent(${JSON.stringify(state.workspaceId)}), {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const previousTheme = ${JSON.stringify(state.previousTheme)};
    if (previousTheme === null) localStorage.removeItem('ipollowork.react.settings.theme-mode');
    else localStorage.setItem('ipollowork.react.settings.theme-mode', previousTheme);
    const previousLanguage = ${JSON.stringify(state.previousLanguage)};
    if (previousLanguage === null) localStorage.removeItem('ipollowork.language');
    else localStorage.setItem('ipollowork.language', previousLanguage);
    return removed.ok;
  })()`, { awaitPromise: true });
  ctx.assert(result === true, "The isolated project was not removed after validation.");
  if (state.workspacePath) {
    await rm(state.workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function readTabGeometry(ctx) {
  return ctx.eval(`(() => {
    const nav = document.querySelector('[data-testid="session-header-work-navigation"]');
    const header = nav?.closest('header');
    const buttons = nav ? [...nav.querySelectorAll('button')] : [];
    if (!nav || !header || buttons.length !== 3) return null;
    const navRect = nav.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const projectRegionRect = header.querySelector('[data-testid="session-header-project-region"]')?.getBoundingClientRect();
    const actionsRect = header.querySelector('[data-testid="session-header-actions"]')?.getBoundingClientRect();
    const projectTitle = header.querySelector('h1');
    const moreActions = header.querySelector('[data-testid="session-header-more-actions"]');
    const active = buttons.find((button) => button.getAttribute('aria-current') === 'page');
    const inactive = buttons.filter((button) => button !== active);
    const activeStyle = active ? getComputedStyle(active) : null;
    const inactiveStyle = inactive[0] ? getComputedStyle(inactive[0]) : null;
    return {
      viewportWidth: innerWidth,
      centerDelta: Math.abs((navRect.left + navRect.width / 2) - (headerRect.left + headerRect.width / 2)),
      gaps: buttons.slice(1).map((button, index) => Math.round(button.getBoundingClientRect().left - buttons[index].getBoundingClientRect().right)),
      activeHeight: active?.getBoundingClientRect().height || 0,
      inactiveHeights: inactive.map((button) => button.getBoundingClientRect().height),
      activeBackground: activeStyle?.backgroundColor || '',
      activeColor: activeStyle?.color || '',
      inactiveColor: inactiveStyle?.color || '',
      fontSize: activeStyle?.fontSize || '',
      lineHeight: activeStyle?.lineHeight || '',
      fontWeight: activeStyle?.fontWeight || '',
      activeTestId: active?.dataset.testid || '',
      leftClearance: projectRegionRect ? navRect.left - projectRegionRect.right : -1,
      rightClearance: actionsRect ? actionsRect.left - navRect.right : -1,
      projectTitleDisplay: projectTitle ? getComputedStyle(projectTitle).display : '',
      projectTitleClientWidth: projectTitle?.clientWidth || 0,
      projectTitleScrollWidth: projectTitle?.scrollWidth || 0,
      titleMenuGap: projectTitle && moreActions
        ? Math.round(moreActions.getBoundingClientRect().left - projectTitle.getBoundingClientRect().right)
        : -1,
      foregroundTestIds: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return document
          .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          ?.closest('button')
          ?.dataset.testid || '';
      }),
    };
  })()`);
}

async function readCompactGeometry(ctx) {
  return ctx.eval(`(() => {
    const compact = document.querySelector('[data-testid="session-header-work-navigation-compact"]');
    const nav = document.querySelector('[data-testid="session-header-work-navigation"]');
    const header = compact?.closest('header');
    const projectRegion = header?.querySelector('[data-testid="session-header-project-region"]');
    const actions = header?.querySelector('[data-testid="session-header-actions"]');
    const folder = header?.querySelector('[data-testid="session-header-project"]');
    const more = header?.querySelector('[data-testid="session-header-more-actions"]');
    if (!compact || !nav || !header || !projectRegion || !actions || !folder || !more) return null;
    const compactRect = compact.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const projectRegionRect = projectRegion.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const hit = document.elementFromPoint(
      compactRect.left + compactRect.width / 2,
      compactRect.top + compactRect.height / 2,
    );
    const compactStyle = getComputedStyle(compact);
    return {
      viewportWidth: innerWidth,
      label: compact.textContent?.trim() || '',
      compactDisplay: getComputedStyle(compact).display,
      fullNavigationDisplay: getComputedStyle(nav).display,
      folderDisplay: getComputedStyle(folder).display,
      moreDisplay: getComputedStyle(more).display,
      centerDelta: Math.abs((compactRect.left + compactRect.width / 2) - (headerRect.left + headerRect.width / 2)),
      leftClearance: compactRect.left - projectRegionRect.right,
      rightClearance: actionsRect.left - compactRect.right,
      foregroundTestId: hit?.closest('button')?.dataset.testid || '',
      borderTopWidth: compactStyle.borderTopWidth,
      boxShadow: compactStyle.boxShadow,
      backgroundColor: compactStyle.backgroundColor,
    };
  })()`);
}

async function applyFigmaTheme(ctx) {
  await ctx.eval(`(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';
    return true;
  })()`);
}

function assertFigmaGeometry(ctx, geometry) {
  ctx.assert(geometry, "Project tab geometry was not measurable.");
  ctx.assert(geometry.centerDelta <= 1, `Tabs are not centered in the header: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.gaps.every((gap) => gap === 8), `Confirmed tab gaps should be 8px: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.activeHeight === 28, `The selected tab should be 28px high: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.inactiveHeights.every((height) => height === 32), `Unselected tabs should be 32px high: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.activeBackground === "rgb(243, 243, 244)", `Selected background should match Figma #F3F3F4: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.activeColor === "rgb(22, 30, 36)", `Selected text should match Figma #161E24: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.inactiveColor === "rgb(90, 103, 116)", `Unselected text should match Figma #5A6774: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.fontSize === "13px" && geometry.lineHeight === "18px" && geometry.fontWeight === "500", `Tab typography should be 13/18 Medium: ${JSON.stringify(geometry)}`);
  ctx.assert(
    geometry.foregroundTestIds.join(',') === 'session-header-work-conversation,session-header-project-overview,session-header-work-tasks',
    `Every tab should remain visible and clickable above neighboring titlebar content: ${JSON.stringify(geometry)}`,
  );
  ctx.assert(geometry.leftClearance >= 0, `Project content overlaps the centered tabs: ${JSON.stringify(geometry)}`);
  ctx.assert(geometry.rightClearance >= 0, `Header actions overlap the centered tabs: ${JSON.stringify(geometry)}`);
}

export default {
  id: FLOW_ID,
  title: "Project header tabs match Figma and remain centered",
  kind: "user-facing",
  preserveTheme: true,
  steps: [
    {
      name: "Project navigation matches the Figma tab treatment",
      run: async (ctx) => {
        await ctx.prove("Project tabs use the exact Figma selected and default states", {
          voiceover: vo[0],
          action: async () => {
            await setupProject(ctx);
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 1280,
              height: 760,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.waitFor("innerWidth === 1280", { label: "desktop viewport" });
            await applyFigmaTheme(ctx);
          },
          assert: async () => {
            const geometry = await readTabGeometry(ctx);
            assertFigmaGeometry(ctx, geometry);
            ctx.assert(geometry.activeTestId === "session-header-work-conversation", `Conversation should be selected initially: ${JSON.stringify(geometry)}`);
            ctx.log(`desktop tab geometry: ${JSON.stringify(geometry)}`);
          },
          screenshot: {
            name: "figma-project-tabs-desktop",
            requireText: ["Template applied", "对话", "概览", "任务"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Tabs stay centered while the window narrows and views change",
      run: async (ctx) => {
        await ctx.prove("The tab group remains centered at narrow widths across every project view", {
          voiceover: vo[1],
          action: async () => {
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 640,
              height: 760,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.waitFor("innerWidth === 640", { label: "narrow viewport" });
            for (const testId of ["session-header-project-overview", "session-header-work-tasks"]) {
              await ctx.eval(`document.querySelector('[data-testid="${testId}"]')?.click()`);
              await ctx.waitFor(`document.querySelector('[data-testid="${testId}"]')?.getAttribute('aria-current') === 'page'`, {
                label: `${testId} selected`,
              });
              await new Promise((resolve) => setTimeout(resolve, 200));
              await applyFigmaTheme(ctx);
              const geometry = await readTabGeometry(ctx);
              assertFigmaGeometry(ctx, geometry);
              ctx.log(`${testId} geometry: ${JSON.stringify(geometry)}`);
            }
          },
          assert: async () => {
            const geometry = await readTabGeometry(ctx);
            ctx.assert(geometry.activeTestId === "session-header-work-tasks", `Tasks should remain selected for the narrow proof: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.centerDelta <= 1, `Narrow tabs drifted from the header center: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.projectTitleDisplay !== "none", `The medium titlebar should keep the project name visible: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.projectTitleClientWidth > 0 && geometry.projectTitleScrollWidth > geometry.projectTitleClientWidth, `The medium project name should truncate inside its region: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.titleMenuGap === 4, `More actions should follow the truncated project name by 4px: ${JSON.stringify(geometry)}`);
          },
          screenshot: {
            name: "figma-project-tabs-narrow",
            requireText: ["对话", "概览", "任务"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "The narrowest titlebar switches project views through a dropdown",
      run: async (ctx) => {
        await ctx.prove("Folder and more actions stay visible while the centered view switcher becomes a dropdown", {
          voiceover: vo[2],
          action: async () => {
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 520,
              height: 760,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.waitFor("innerWidth === 520", { label: "compact viewport" });
            await applyFigmaTheme(ctx);
            await ctx.waitFor(`getComputedStyle(document.querySelector('[data-testid="session-header-work-navigation-compact"]')).display === 'inline-flex'`, {
              label: "compact project navigation",
            });
            await ctx.eval(`document.querySelector('[data-testid="session-header-work-navigation-compact"]')?.click()`);
            await ctx.waitFor(`document.querySelector('[data-testid="session-header-project-overview-compact"]')?.getBoundingClientRect().height > 0`, {
              label: "project view dropdown",
            });
            await ctx.eval(`document.querySelector('[data-testid="session-header-project-overview-compact"]')?.click()`);
            await ctx.waitFor(`document.querySelector('[data-testid="session-header-work-navigation-compact"]')?.textContent?.includes('概览')`, {
              label: "overview selected through the dropdown",
            });
            await ctx.waitFor(`(() => {
              const item = document.querySelector('[data-testid="session-header-work-tasks-compact"]');
              if (!item) return true;
              const rect = item.getBoundingClientRect();
              return !item.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
            })()`, {
              label: "project view dropdown closed",
            });
            await ctx.eval(`document.querySelector('[data-testid="session-header-work-navigation-compact"]')?.click()`);
            await ctx.waitFor(`(() => {
              const item = document.querySelector('[data-testid="session-header-work-tasks-compact"]');
              if (!item) return false;
              const rect = item.getBoundingClientRect();
              return item.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
            })()`, {
              label: "project view dropdown reopened",
            });
          },
          assert: async () => {
            const geometry = await readCompactGeometry(ctx);
            ctx.assert(geometry, "Compact project navigation was not measurable.");
            ctx.assert(geometry.label.includes("概览"), `The compact trigger should show the current view: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.compactDisplay === "inline-flex" && geometry.fullNavigationDisplay === "none", `Only the compact switcher should show: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.folderDisplay !== "none" && geometry.moreDisplay !== "none", `Folder and more actions should remain visible: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.centerDelta <= 1, `The compact switcher is not centered: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.leftClearance >= 0 && geometry.rightClearance >= 0, `Compact titlebar controls overlap: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.foregroundTestId === "session-header-work-navigation-compact", `The compact switcher is covered by another titlebar control: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.borderTopWidth === "0px" && geometry.boxShadow === "none", `The compact switcher should have no border or shadow: ${JSON.stringify(geometry)}`);
            ctx.assert(geometry.backgroundColor === "rgba(0, 0, 0, 0)", `The compact switcher should remain transparent: ${JSON.stringify(geometry)}`);
            ctx.log(`compact navigation geometry: ${JSON.stringify(geometry)}`);
          },
          screenshot: {
            name: "figma-project-tabs-compact-dropdown",
            requireText: ["对话", "概览", "任务"],
            rejectText: ["Something went wrong"],
          },
        });
        await cleanupProject(ctx);
      },
    },
  ],
};
