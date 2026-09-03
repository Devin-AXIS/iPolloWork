let forcedHoverNodeId = null;

async function clearForcedHover(ctx) {
  if (!forcedHoverNodeId) return;
  try {
    await ctx.client.send("CSS.forcePseudoState", {
      nodeId: forcedHoverNodeId,
      forcedPseudoClasses: [],
    });
  } catch (error) {
    if (!String(error).includes("Could not find node with given id")) throw error;
  } finally {
    forcedHoverNodeId = null;
  }
}

async function forceHover(ctx, selector) {
  await ctx.client.send("DOM.enable");
  await ctx.client.send("CSS.enable");
  await clearForcedHover(ctx);
  const { root } = await ctx.client.send("DOM.getDocument");
  const { nodeId } = await ctx.client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  ctx.assert(nodeId, `Unable to force hover for ${selector}.`);
  await ctx.client.send("CSS.forcePseudoState", {
    nodeId,
    forcedPseudoClasses: ["hover"],
  });
  forcedHoverNodeId = nodeId;
}

export default {
  id: "plugin-library",
  title: "Unified plugin library navigation and catalog",
  kind: "user-facing",
  steps: [
    {
      name: "Open the unified plugin library",
      run: async (ctx) => {
        await ctx.prove("Plugins open as one searchable capability-package library", {
          action: async () => {
            await ctx.client.send("Emulation.clearDeviceMetricsOverride");
            await ctx.navigateHash("/settings/extensions");
            const pluginsSelected = await ctx.waitFor(`Boolean([...document.querySelectorAll('[role="tab"]')]
              .find((entry) => ['插件', 'Plugins'].includes(entry.textContent?.trim() ?? '')))`, {
              timeoutMs: 30_000,
              label: "plugin library tab",
            });
            ctx.assert(pluginsSelected, "Plugins tab was not found.");
            await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['插件', 'Plugins'].includes(entry.textContent?.trim() ?? ''));
              if (tab?.getAttribute('aria-selected') !== 'true') tab?.click();
            })()`);
            await ctx.waitFor(`[...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
              .some((entry) => ['插件', 'Plugins'].includes(entry.textContent?.trim() ?? ''))`, {
              timeoutMs: 5_000,
              label: "selected plugin library tab",
            });
            await ctx.waitFor(`Boolean(document.querySelector('input[aria-label="搜索插件"], input[aria-label="Search plugins"]'))`, {
              timeoutMs: 30_000,
              label: "plugin library search",
            });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-installed-tile"]'))`, {
              timeoutMs: 30_000,
              label: "installed plugin previews",
            });
            await ctx.eval(`(() => {
              const publicTab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['公开', 'Public'].includes(entry.textContent?.trim() ?? ''));
              if (publicTab?.getAttribute('aria-selected') !== 'true') publicTab?.click();
            })()`);
            await ctx.waitFor(`[...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
              .some((entry) => ['公开', 'Public'].includes(entry.textContent?.trim() ?? ''))`, {
              timeoutMs: 5_000,
              label: "public plugin source",
            });
            await clearForcedHover(ctx);
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
            await ctx.waitFor(`[...document.querySelectorAll('[data-testid="plugin-installed-tile"]')]
              .every((entry) => Math.round(entry.getBoundingClientRect().width) === 48)`, {
              timeoutMs: 5_000,
              label: "collapsed installed plugin previews",
            });
            const libraryStructure = await ctx.eval(`(() => {
              const activeTabs = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
                .map((entry) => entry.textContent?.trim());
              const shellHeader = document.querySelector('main > header');
              const navigationActions = shellHeader?.querySelector('[data-testid="plugin-library-navigation-actions"]');
              const navigationTabs = shellHeader?.querySelector('[role="tablist"]');
              const navigationButtons = [...(navigationActions?.querySelectorAll('button') ?? [])];
              const refreshButton = navigationButtons.find((entry) => ['刷新', 'Refresh'].includes(entry.textContent?.trim() ?? ''));
              const addButton = navigationButtons.find((entry) => ['添加', 'Add'].includes(entry.textContent?.trim() ?? ''));
              const sidebarContainer = document.querySelector('[data-slot="sidebar-container"]');
              const settingsNavigationButtons = [...(sidebarContainer?.querySelectorAll('[data-slot="sidebar-menu-button"]') ?? [])];
              const settingsNavigationIcons = settingsNavigationButtons
                .map((button) => button.querySelector(':scope > span[aria-hidden="true"]'))
                .filter(Boolean);
              const extensionsNavigationButton = settingsNavigationButtons.find((button) =>
                ['扩展', 'Extensions'].includes(button.textContent?.trim() ?? ''));
              const heading = document.querySelector('[data-testid="plugin-library-heading"]');
              const installedHeading = document.querySelector('[data-testid="plugin-library-installed"] h2');
              const settingsContent = document.querySelector('[data-settings-content]');
              const settingsSafeArea = document.querySelector('[data-settings-safe-area]');
              const headerSafeArea = document.querySelector('[data-settings-header-safe-area]');
              const sourceTabs = document.querySelector('[data-testid="plugin-library-source"] [role="tablist"]');
              const selectedSourceTab = sourceTabs?.querySelector('[role="tab"][aria-selected="true"]');
              const defaultSourceTab = sourceTabs?.querySelector('[role="tab"][aria-selected="false"]');
              const selectedNavigationTab = navigationTabs?.querySelector('[role="tab"][aria-selected="true"]');
              const installedTiles = [...document.querySelectorAll('[data-testid="plugin-installed-tile"]')];
              const installedSection = document.querySelector('[data-testid="plugin-library-installed"]');
              const installedIconSources = installedTiles.map((entry) => entry.querySelector('img')?.getAttribute('src') ?? '');
              const ipolloIcons = installedTiles
                .map((entry) => entry.querySelector('img'))
                .filter((image) => image?.getAttribute('src')?.includes('ipollowork-mark.svg'));
              const verticalCenter = (entry) => {
                const rect = entry.getBoundingClientRect();
                return rect.top + rect.height / 2;
              };
              const hasNoVisibleShadow = (value) => {
                if (value === 'none') return true;
                const colors = [...value.matchAll(/rgba\\([^)]*,\\s*([\\d.]+)\\)/g)];
                return colors.length > 0 && colors.every(([, alpha]) => Number(alpha) === 0);
              };
              return {
                publicFirst: activeTabs.includes('公开') || activeTabs.includes('Public'),
                actionsInSettingsHeader: Boolean(shellHeader && navigationTabs && navigationActions),
                notificationRemoved: !document.querySelector('button[aria-label^="通知"], button[aria-label^="Notifications"]'),
                navigationDividersRemoved: shellHeader && sidebarContainer
                  && getComputedStyle(shellHeader).borderBottomWidth === '0px'
                  && getComputedStyle(sidebarContainer).borderRightWidth === '0px'
                  && getComputedStyle(sidebarContainer).borderLeftWidth === '0px',
                navigationSingleRow: navigationTabs && refreshButton && addButton
                  && Math.abs(verticalCenter(navigationTabs) - verticalCenter(refreshButton)) < 2
                  && Math.abs(verticalCenter(refreshButton) - verticalCenter(addButton)) < 2,
                typographyHierarchy: heading && installedHeading
                  && getComputedStyle(heading).fontSize === '24px'
                  && getComputedStyle(heading).lineHeight === '32px'
                  && getComputedStyle(heading).fontWeight === '600'
                  && getComputedStyle(installedHeading).fontSize === '14px'
                  && getComputedStyle(installedHeading).lineHeight === '20px'
                  && getComputedStyle(installedHeading).fontWeight === '600',
                navigationTabsMatchDesign: navigationTabs && selectedNavigationTab
                  && getComputedStyle(navigationTabs).height === '28px'
                  && getComputedStyle(navigationTabs).backgroundColor === 'rgba(0, 0, 0, 0)'
                  && getComputedStyle(selectedNavigationTab).height === '28px'
                  && getComputedStyle(selectedNavigationTab).borderRadius === '8px'
                  && getComputedStyle(selectedNavigationTab).fontWeight === '500',
                sourceTabsMatchDesign: selectedSourceTab && defaultSourceTab
                  && getComputedStyle(selectedSourceTab).height === '28px'
                  && getComputedStyle(selectedSourceTab).borderRadius === '8px'
                  && getComputedStyle(selectedSourceTab).fontWeight === '500'
                  && getComputedStyle(defaultSourceTab).height === '28px'
                  && getComputedStyle(defaultSourceTab).backgroundColor === 'rgba(0, 0, 0, 0)',
                settingsSafeArea: settingsContent && settingsSafeArea && headerSafeArea && heading
                  && getComputedStyle(settingsContent).paddingLeft === (innerWidth >= 1920 ? '64px' : innerWidth >= 1600 ? '48px' : '32px')
                  && getComputedStyle(settingsContent).paddingRight === (innerWidth >= 1920 ? '64px' : innerWidth >= 1600 ? '48px' : '32px')
                  && settingsSafeArea.getBoundingClientRect().width <= 1280
                  && Math.abs(heading.getBoundingClientRect().left - settingsSafeArea.getBoundingClientRect().left) < 1
                  && Math.abs(headerSafeArea.getBoundingClientRect().left - settingsSafeArea.getBoundingClientRect().left) < 1
                  && Math.abs(headerSafeArea.getBoundingClientRect().right - settingsSafeArea.getBoundingClientRect().right) < 1,
                installedTilesMatchDesign: installedTiles.every((entry) => Math.round(entry.getBoundingClientRect().width) === 48),
                redundantManageRemoved: ![...(installedSection?.querySelectorAll('button') ?? [])]
                  .some((entry) => ['管理', 'Manage'].includes(entry.textContent?.trim() ?? '')),
                installedOverflowMatchesDesign: (() => {
                  const row = document.querySelector('[data-testid="plugin-installed-row"]');
                  const expand = document.querySelector('[data-testid="plugin-installed-expand"]');
                  if (!expand) return true;
                  if (!row) return false;
                  const remaining = Number(expand.getAttribute('data-remaining-count') ?? '0');
                  const total = installedTiles.length + remaining;
                  const capacity = Math.max(1, Math.floor((row.getBoundingClientRect().width + 8) / 56));
                  const thumbnailCount = expand.querySelector('[data-testid="plugin-installed-overflow-thumbnails"]')?.children.length ?? 0;
                  return total > capacity
                    && expand.getBoundingClientRect().top >= row.getBoundingClientRect().bottom
                    && thumbnailCount === Math.min(3, remaining);
                })(),
                curatedIconsUpdated: installedIconSources.some((src) => src.includes('ext-figma.svg'))
                  && installedIconSources.some((src) => src.includes('ext-github.svg')),
                ipolloLogoUpdated: ipolloIcons.every((image) => image.naturalWidth === 281 && image.naturalHeight === 298),
                hasInstalledSection: Boolean(document.querySelector('[data-testid="plugin-library-installed"]')),
                hasMarketplaceFilters: Boolean(document.querySelector('[data-testid="plugin-category-filter"]'))
                  && Boolean(document.querySelector('[data-testid="plugin-status-filter"]')),
                controlsUseEightPixelCorners: addButton
                  && getComputedStyle(addButton).borderRadius === '8px'
                  && [...document.querySelectorAll('[data-testid="plugin-category-filter"], [data-testid="plugin-status-filter"]')]
                    .every((entry) => getComputedStyle(entry).borderRadius === '8px'),
                outlineButtonsAreFlat: refreshButton
                  && hasNoVisibleShadow(getComputedStyle(refreshButton).boxShadow)
                  && hasNoVisibleShadow(getComputedStyle(refreshButton, '::before').boxShadow),
                settingsNavigationIconsMatch: settingsNavigationIcons.length > 0
                  && settingsNavigationIcons.every((icon) => Math.round(icon.getBoundingClientRect().width) === 16)
                  && settingsNavigationIcons.every((icon) => Math.abs(icon.getBoundingClientRect().left - settingsNavigationIcons[0].getBoundingClientRect().left) < 1)
                  && settingsNavigationIcons.every((icon) => {
                    const artwork = icon.querySelector('svg, img');
                    if (!artwork) return false;
                    const iconRect = icon.getBoundingClientRect();
                    const artworkRect = artwork.getBoundingClientRect();
                    const expectedArtworkSize = artwork.tagName === 'IMG' ? 15 : 16;
                    return Math.round(Math.max(artworkRect.width, artworkRect.height)) === expectedArtworkSize
                      && Math.abs((iconRect.left + iconRect.width / 2) - (artworkRect.left + artworkRect.width / 2)) < 1;
                  })
                  && settingsNavigationIcons
                    .flatMap((icon) => [...icon.querySelectorAll('svg')])
                    .every((icon) => icon.getAttribute('stroke-width') === '1'
                      && [...icon.querySelectorAll('*')].every((part) => getComputedStyle(part).vectorEffect === 'non-scaling-stroke'))
                  && extensionsNavigationButton?.querySelector('img')?.getAttribute('src')?.includes('sidebar-icon/toy-brick.svg'),
                settingsIconDetails: settingsNavigationIcons.map((icon) => {
                  const artwork = icon.querySelector('svg, img');
                  const iconRect = icon.getBoundingClientRect();
                  const artworkRect = artwork?.getBoundingClientRect();
                  return {
                    slot: [Math.round(iconRect.width), Math.round(iconRect.height)],
                    artwork: artworkRect ? [Math.round(artworkRect.width), Math.round(artworkRect.height)] : null,
                    stroke: artwork?.getAttribute('stroke-width'),
                    source: artwork?.getAttribute('src'),
                  };
                }),
              };
            })()`);
            ctx.assert(libraryStructure.publicFirst, "Public plugins should be the default source.");
            ctx.assert(libraryStructure.actionsInSettingsHeader, "Plugin tabs and actions should be mounted in the settings navigation header.");
            ctx.assert(libraryStructure.notificationRemoved, "The notification bell should be removed from the plugin navigation header.");
            ctx.assert(libraryStructure.navigationDividersRemoved, "Settings navigation and content should not be separated by gray divider lines.");
            ctx.assert(libraryStructure.navigationSingleRow, "Plugin tabs and actions should share one navigation row.");
            ctx.assert(libraryStructure.typographyHierarchy, "The plugin page should use the 24px page-title and 14px section-title hierarchy.");
            ctx.assert(libraryStructure.navigationTabsMatchDesign, "Plugin navigation tabs should match the shared 28px Figma states.");
            ctx.assert(libraryStructure.sourceTabsMatchDesign, "Plugin source tabs should match the shared 28px Figma states.");
            ctx.assert(libraryStructure.settingsSafeArea, "Settings content and navigation should share the responsive 1280px safe area.");
            ctx.assert(libraryStructure.installedTilesMatchDesign, "Installed plugin tiles should use only the 48px gray icon surface.");
            ctx.assert(libraryStructure.redundantManageRemoved, "The installed section should not duplicate the Personal tab with a Manage button.");
            ctx.assert(libraryStructure.installedOverflowMatchesDesign, "Installed overflow should appear only when the row is full and render below it with thumbnails.");
            ctx.assert(libraryStructure.curatedIconsUpdated, "Featured third-party plugins should use curated SVGs.");
            ctx.assert(libraryStructure.ipolloLogoUpdated, "Installed iPollo agents should render the current 281×298 iPollo logo asset.");
            ctx.assert(libraryStructure.hasInstalledSection, "Installed plugin section was not found.");
            ctx.assert(libraryStructure.hasMarketplaceFilters, "Marketplace category and status filters were not found.");
            ctx.assert(libraryStructure.controlsUseEightPixelCorners, "Settings buttons and inputs should use 8px corners.");
            ctx.assert(libraryStructure.outlineButtonsAreFlat, "Settings outline buttons should not render outer or inset shadows.");
            ctx.assert(libraryStructure.settingsNavigationIconsMatch, `Settings navigation icons should share 16px slots, use 16px Lucide artwork with a 15px optically balanced Extensions icon, preserve non-scaling 1px strokes, and share the Extensions artwork (${JSON.stringify(libraryStructure.settingsIconDetails)}).`);
            await forceHover(ctx, '[data-testid="plugin-library-source"] [role="tab"][aria-selected="false"]');
            await ctx.waitFor(`(() => {
              const tab = document.querySelector('[data-testid="plugin-library-source"] [role="tab"][aria-selected="false"]');
              if (!tab) return false;
              const background = getComputedStyle(tab).backgroundColor;
              return document.documentElement.classList.contains('dark')
                ? background !== 'rgba(0, 0, 0, 0)'
                : background === 'rgb(246, 247, 251)';
            })()`, {
              timeoutMs: 5_000,
              label: "plugin source hover state",
            });
            const hoverTargetReady = await ctx.eval(`(() => {
              const tiles = [...document.querySelectorAll('[data-testid="plugin-installed-tile"]')];
              const tile = tiles.at(-1);
              if (!tile) return false;
              tile.setAttribute('data-fraimz-hover-target', 'installed-plugin');
              return true;
            })()`);
            ctx.assert(hoverTargetReady, "No installed plugin tile was available to hover.");
            await forceHover(ctx, '[data-fraimz-hover-target="installed-plugin"]');
            await ctx.waitFor(`(() => {
              const tiles = [...document.querySelectorAll('[data-testid="plugin-installed-tile"]')];
              const gaps = tiles.slice(1).map((tile, index) =>
                Math.round(tile.getBoundingClientRect().left - tiles[index].getBoundingClientRect().right));
              return tiles.length > 0
                && tiles.every((tile) => Math.round(tile.getBoundingClientRect().width) === 48)
                && gaps.every((gap) => gap === 8)
                && getComputedStyle(tiles.at(-1)).borderColor === 'rgb(31, 186, 192)'
                && getComputedStyle(tiles.at(-1)).borderTopWidth === '2px'
                && !document.querySelector('[data-testid="plugin-installed-details"]');
            })()`, {
              timeoutMs: 5_000,
              label: "fixed installed plugin previews",
            });
            await ctx.waitFor(`(() => {
              const text = document.body.innerText;
              const loading = text.includes('正在加载市场') || text.includes('Loading marketplace');
              const settled = Boolean(document.querySelector('[data-testid="plugin-package-list-item"]')) || [
                '市场暂无插件', 'No marketplace plugins',
                '登录后浏览插件市场', 'Sign in to browse the plugin marketplace',
              ].some((value) => text.includes(value)) || Boolean(document.querySelector('[role="alert"]'));
              const pluginIcons = [...document.querySelectorAll('button[aria-label^="打开"] img, button[aria-label^="Open"] img')];
              const iconsLoaded = pluginIcons.length === 0 || pluginIcons.every((image) => image.complete && image.naturalWidth > 0);
              return !loading && settled && iconsLoaded;
            })()`, {
              timeoutMs: 30_000,
              label: "settled marketplace catalog",
            });
            await clearForcedHover(ctx);
            await ctx.waitFor(`[...document.querySelectorAll('[data-testid="plugin-installed-tile"]')]
              .every((entry) => Math.round(entry.getBoundingClientRect().width) === 48)`, {
              timeoutMs: 5_000,
              label: "collapsed installed previews before marketplace hover",
            });
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
            const marketplaceCard = await ctx.eval(`(() => {
              const card = document.querySelector('[data-testid="plugin-package-list-item"]');
              if (!card) return null;
              const copy = card.querySelector('[data-testid="plugin-package-card-copy"]');
              const rect = card.getBoundingClientRect();
              const style = getComputedStyle(card);
              const columns = getComputedStyle(card.parentElement).gridTemplateColumns.split(' ').filter(Boolean);
              return {
                height: Math.round(rect.height),
                borderless: style.borderTopWidth === '0px'
                  && style.borderRightWidth === '0px'
                  && style.borderBottomWidth === '0px'
                  && style.borderLeftWidth === '0px',
                transparent: style.backgroundColor === 'rgba(0, 0, 0, 0)',
                columns: columns.length,
                viewportWide: innerWidth >= 1024,
                copyRows: copy?.children.length ?? 0,
                legacyMetadataRemoved: !/\bSkills\b|\bMCP\b|\bTools\b|工具/.test(card.textContent ?? ''),
              };
            })()`);
            ctx.assert(marketplaceCard, "No marketplace plugin card was available to validate.");
            ctx.assert(marketplaceCard.height === 74, "Marketplace plugin cards should be 74px tall.");
            ctx.assert(marketplaceCard.borderless && marketplaceCard.transparent, "Default marketplace cards should be transparent and borderless.");
            ctx.assert(!marketplaceCard.viewportWide || marketplaceCard.columns === 2, "Wide marketplace lists should use the Figma two-column grid.");
            ctx.assert(marketplaceCard.copyRows === 2 && marketplaceCard.legacyMetadataRemoved, "Marketplace cards should show only the Figma title and description copy.");
            await forceHover(ctx, '[data-testid="plugin-package-list-item"]');
            await ctx.waitFor(`(() => {
              const card = document.querySelector('[data-testid="plugin-package-list-item"]');
              if (!card) return false;
              const style = getComputedStyle(card);
              const backgroundMatches = document.documentElement.classList.contains('dark')
                ? style.backgroundColor !== 'rgba(0, 0, 0, 0)'
                : style.backgroundColor === 'rgb(246, 247, 251)';
              return backgroundMatches
                && style.borderTopWidth === '0px'
                && style.borderRightWidth === '0px'
                && style.borderBottomWidth === '0px'
                && style.borderLeftWidth === '0px';
            })()`, {
              timeoutMs: 5_000,
              label: "borderless marketplace card hover",
            });

            await clearForcedHover(ctx);
            const viewport = await ctx.eval(`({ width: innerWidth, height: innerHeight })`);
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 900,
              height: viewport.height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-installed-expand"]'))`, {
              timeoutMs: 5_000,
              label: "installed plugin overflow control",
            });
            const overflowPreview = await ctx.eval(`(() => {
              const row = document.querySelector('[data-testid="plugin-installed-row"]');
              const expand = document.querySelector('[data-testid="plugin-installed-expand"]');
              if (!row || !expand) return null;
              const remaining = Number(expand.getAttribute('data-remaining-count') ?? '0');
              return {
                belowRow: expand.getBoundingClientRect().top >= row.getBoundingClientRect().bottom,
                remaining,
                thumbnailCount: expand.querySelector('[data-testid="plugin-installed-overflow-thumbnails"]')?.children.length ?? 0,
              };
            })()`);
            ctx.assert(overflowPreview?.belowRow, "The installed overflow preview should sit below the plugin row.");
            ctx.assert(overflowPreview?.remaining > 0, "The installed overflow preview should represent hidden plugins.");
            ctx.assert(overflowPreview?.thumbnailCount === Math.min(3, overflowPreview.remaining), "The installed overflow preview should show up to three plugin thumbnails.");
          },
          assert: async () => {
            await ctx.expectText("插件");
            await ctx.expectText("技能");
            await ctx.expectText("已安装");
            await ctx.expectText("公开");
            await ctx.expectText("个人");
            await ctx.expectNoText("添加自定义应用");
            await ctx.expectNoText("你的应用");
          },
          screenshot: {
            name: "plugin-library-marketplace",
            requireText: ["插件", "技能", "已安装", "公开", "个人"],
            rejectText: ["添加自定义应用", "你的应用", "Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Open an installed marketplace plugin",
      run: async (ctx) => {
        await ctx.prove("Installed marketplace entries open the canonical installed plugin detail", {
          action: async () => {
            const collapsedPluginCount = await ctx.eval(`document.querySelectorAll('[data-testid="plugin-installed-tile"]').length`);
            const expanded = await ctx.eval(`(() => {
              const control = document.querySelector('[data-testid="plugin-installed-expand"]');
              control?.click();
              return Boolean(control);
            })()`);
            ctx.assert(expanded, "Installed plugin overflow control was not available to expand.");
            await ctx.waitFor(`document.querySelector('[data-testid="plugin-installed-expand"]')?.getAttribute('aria-expanded') === 'true'
              && document.querySelectorAll('[data-testid="plugin-installed-tile"]').length > ${collapsedPluginCount}`, {
              timeoutMs: 5_000,
              label: "expanded installed plugins",
            });
            await ctx.client.send("Emulation.clearDeviceMetricsOverride");
            const opened = await ctx.eval(`(() => {
              const installedLabels = ['已安装', 'Installed'];
              const rows = [...document.querySelectorAll('main div')]
                .filter((entry) => installedLabels.some((label) => entry.innerText?.includes(label)))
                .sort((left, right) => left.querySelectorAll('button').length - right.querySelectorAll('button').length);
              const openButton = rows.find((entry) => entry.querySelectorAll('button').length >= 2)?.querySelector('button');
              openButton?.click();
              return Boolean(openButton);
            })()`);
            ctx.assert(opened, "No installed marketplace plugin could be opened.");
            await ctx.waitFor(`location.hash.includes('/settings/extensions/plugin/')`, {
              timeoutMs: 30_000,
              label: "canonical installed detail from marketplace",
            });
            await ctx.waitFor(`document.body.innerText.includes('启用') || document.body.innerText.includes('Enable')`, {
              timeoutMs: 30_000,
              label: "canonical detail enable control",
            });
          },
          assert: async () => {
            await ctx.expectText("已安装");
            await ctx.expectText("启用");
          },
        });
      },
    },
    {
      name: "Switch to personal plugin packages",
      run: async (ctx) => {
        await ctx.prove("Personal packages stay in the same library without exposing raw MCP rows", {
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await ctx.waitFor(`Boolean([...document.querySelectorAll('[role="tab"]')]
              .find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? '')))`, {
              timeoutMs: 30_000,
              label: "personal plugin source tab",
            });
            const clicked = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(clicked, "Personal plugin source tab was not found.");
            await ctx.waitFor(`document.body.innerText.includes('管理全局安装或导入的插件') || document.body.innerText.includes('Manage globally installed or imported plugins.')`, {
              timeoutMs: 30_000,
              label: "personal plugin packages",
            });
          },
          assert: async () => {
            await ctx.expectNoText("可用应用");
            await ctx.expectNoText("你的应用");
          },
          screenshot: {
            name: "plugin-library-personal",
            requireText: ["个人", "已安装"],
            rejectText: ["可用应用", "你的应用", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Open the canonical installed plugin detail",
      run: async (ctx) => {
        await ctx.prove("Installed plugins share one detail page with enablement and authorization state", {
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-installed-tile"]'))`, {
              timeoutMs: 30_000,
              label: "installed plugin previews",
            });
            const opened = await ctx.eval(`(() => {
              const target = document.querySelector('[data-testid="plugin-installed-tile"]');
              target?.click();
              return Boolean(target);
            })()`);
            ctx.assert(opened, "No installed plugin could be opened.");
            await ctx.waitFor(`location.hash.includes('/settings/extensions/plugin/')`, {
              timeoutMs: 30_000,
              label: "canonical plugin detail route",
            });
            await ctx.waitFor(`(() => {
              const text = document.body.innerText;
              return (text.includes('已安装') || text.includes('Installed'))
                && (text.includes('启用') || text.includes('Enable'))
                && Boolean(document.querySelector('[role="switch"]'));
            })()`, {
              timeoutMs: 30_000,
              label: "installed status and enable switch",
            });
            if (opened.authorizationExpected) {
              await ctx.waitFor(`document.body.innerText.includes('需要授权') || document.body.innerText.includes('Authorization required')`, {
                timeoutMs: 30_000,
                label: "authorization required status",
              });
            }
          },
          assert: async () => {
            await ctx.expectText("已安装");
            await ctx.expectText("启用");
          },
          screenshot: {
            name: "plugin-library-detail",
            requireText: ["已安装", "启用"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/",
          },
        });
      },
    },
    {
      name: "Switch to the skills index",
      run: async (ctx) => {
        await ctx.prove("Skills use the Figma library hierarchy with compact actions, filters, and responsive cards", {
          action: async () => {
            await ctx.navigateHash("/settings/extensions/skills");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="skills-library-search"]'))`, {
              timeoutMs: 30_000,
              label: "skills index",
            });
            const skillsLayout = await ctx.eval(`(() => {
              const section = document.querySelector('[data-testid="settings-standard-page"]');
              const safeArea = document.querySelector('[data-settings-safe-area]');
              const headerActions = document.querySelector('[data-testid="skills-library-navigation-actions"]');
              const heading = section?.querySelector('h2');
              const description = heading?.nextElementSibling;
              const search = document.querySelector('[data-testid="skills-library-search"]');
              const source = document.querySelector('[data-testid="skills-library-source"]');
              const selectedSource = source?.querySelector('[role="tab"][aria-selected="true"]');
              const defaultSource = source?.querySelector('[role="tab"][aria-selected="false"]');
              const status = document.querySelector('[data-testid="skills-status-filter"]');
              const installed = document.querySelector('[data-testid="skills-installed-section"]');
              const installedHeading = installed?.querySelector('h3');
              const grid = document.querySelector('[data-testid="skills-installed-grid"]');
              const card = document.querySelector('[data-testid="skill-library-card"]');
              if (!section || !safeArea || !heading || !description || !search || !source || !selectedSource || !defaultSource || !status || !installed || !installedHeading || !grid || !card) return null;
              const sectionRect = section.getBoundingClientRect();
              const safeAreaRect = safeArea.getBoundingClientRect();
              const actionLabels = [...(headerActions?.querySelectorAll('button') ?? [])]
                .map((button) => button.textContent?.trim());
              return {
                centered: sectionRect.width <= 960
                  && Math.abs((sectionRect.left + sectionRect.width / 2)
                    - (safeAreaRect.left + safeAreaRect.width / 2)) < 1,
                actionsInHeader: Boolean(headerActions)
                  && ['刷新', 'Refresh'].some((label) => actionLabels.includes(label))
                  && ['导入', 'Import'].some((label) => actionLabels.includes(label))
                  && ['在聊天中创建', 'Create in chat'].some((label) => actionLabels.includes(label)),
                typography: getComputedStyle(heading).fontSize === '24px'
                  && getComputedStyle(heading).fontWeight === '600'
                  && getComputedStyle(description).fontSize === '13px'
                  && getComputedStyle(description).lineHeight === '20px'
                  && getComputedStyle(installedHeading).fontSize === '14px'
                  && getComputedStyle(installedHeading).lineHeight === '20px',
                searchMatches: Math.round(search.getBoundingClientRect().height) === 34
                  && getComputedStyle(search).borderRadius === '8px',
                filtersPresent: source.querySelectorAll('button').length === 3
                  && Math.round(status.getBoundingClientRect().height) === 34,
                sourceTabsMatchPlugins: Math.round(selectedSource.getBoundingClientRect().height) === 28
                  && getComputedStyle(selectedSource).borderRadius === '8px'
                  && getComputedStyle(selectedSource).fontWeight === '500'
                  && getComputedStyle(defaultSource).backgroundColor === 'rgba(0, 0, 0, 0)',
                installedDivider: getComputedStyle(installed).borderBottomWidth === '1px',
                twoColumnCards: innerWidth < 1024 || getComputedStyle(grid).gridTemplateColumns.split(' ').length === 2,
                flatCards: getComputedStyle(card).borderTopWidth === '0px'
                  && getComputedStyle(card).boxShadow === 'none'
                  && getComputedStyle(card).borderRadius === '8px',
                cardUninstallRemoved: ![...card.querySelectorAll('button')].some((button) =>
                  ['卸载', 'Uninstall'].includes(button.getAttribute('aria-label') ?? '')
                    || ['卸载', 'Uninstall'].includes(button.getAttribute('title') ?? '')),
              };
            })()`);
            ctx.assert(skillsLayout?.centered, "Skills should use the centered 960px settings content width.");
            ctx.assert(skillsLayout?.actionsInHeader, "Skills actions should share the settings navigation row.");
            ctx.assert(skillsLayout?.typography, "Skills should share the plugin page typography hierarchy.");
            ctx.assert(skillsLayout?.searchMatches, "Skills search should use the 34px borderless Figma field.");
            ctx.assert(skillsLayout?.filtersPresent, "Skills source and status filters should be present.");
            ctx.assert(skillsLayout?.sourceTabsMatchPlugins, "Skills source tabs should reuse the plugin tab states.");
            ctx.assert(skillsLayout?.installedDivider, "Installed skills should use the section divider from the design.");
            ctx.assert(skillsLayout?.twoColumnCards, "Installed skills should use a responsive two-column grid.");
            ctx.assert(skillsLayout?.flatCards, "Skill cards should be flat, borderless, and 8px rounded.");
            ctx.assert(skillsLayout?.cardUninstallRemoved, "Installed skill cards should not expose uninstall outside the editor.");
          },
          assert: async () => {
            await ctx.expectText("在聊天中创建");
            await ctx.expectNoText("添加自定义应用");
          },
          screenshot: {
            name: "plugin-library-skills",
            requireText: ["技能", "已安装"],
            rejectText: ["添加自定义应用", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Open an installed skill editor",
      run: async (ctx) => {
        await ctx.prove("Skill editing keeps save and uninstall in a clear bottom action area", {
          action: async () => {
            const opened = await ctx.eval(`(() => {
              const card = document.querySelector('[data-testid="skill-library-card"]');
              if (!card) return false;
              const edit = [...card.querySelectorAll('button')]
                .find((button) => ['编辑', 'Edit'].includes(button.textContent?.trim() ?? ''));
              edit?.click();
              return Boolean(edit);
            })()`);
            ctx.assert(opened, "No installed skill editor could be opened.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="skill-editor-actions"]'))`, {
              timeoutMs: 30_000,
              label: "skill editor bottom actions",
            });
            await ctx.waitFor(`Boolean(document.querySelector('[data-slot="dialog-content"] textarea'))`, {
              timeoutMs: 30_000,
              label: "loaded skill editor",
            });
            const editorLayout = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-slot="dialog-content"]');
              const close = dialog?.querySelector('[data-slot="dialog-close"]');
              const actions = dialog?.querySelector('[data-testid="skill-editor-actions"]');
              const uninstall = dialog?.querySelector('[data-testid="skill-editor-uninstall"]');
              const save = dialog?.querySelector('[data-testid="skill-editor-save"]');
              const textArea = dialog?.querySelector('textarea');
              if (!dialog || !close || !actions || !uninstall || !save || !textArea) return null;
              const dialogRect = dialog.getBoundingClientRect();
              const closeRect = close.getBoundingClientRect();
              const actionsRect = actions.getBoundingClientRect();
              const uninstallRect = uninstall.getBoundingClientRect();
              const saveRect = save.getBoundingClientRect();
              const overlaps = (left, right) => !(
                left.right <= right.left
                || left.left >= right.right
                || left.bottom <= right.top
                || left.top >= right.bottom
              );
              return {
                actionsAtBottom: actionsRect.top > textArea.getBoundingClientRect().top
                  && actionsRect.bottom <= dialogRect.bottom + 1,
                actionsSeparated: uninstallRect.right < saveRect.left,
                closeClear: !overlaps(closeRect, uninstallRect)
                  && !overlaps(closeRect, saveRect)
                  && closeRect.bottom < actionsRect.top,
                labels: [uninstall.textContent?.trim(), save.textContent?.trim()],
              };
            })()`);
            ctx.assert(editorLayout?.actionsAtBottom, "Skill editor actions should stay in the modal footer.");
            ctx.assert(editorLayout?.actionsSeparated, "Uninstall should stay left while Save stays right.");
            ctx.assert(editorLayout?.closeClear, "Footer actions should not overlap the dialog close button.");
            ctx.assert(editorLayout?.labels.some((label) => ['卸载', 'Uninstall'].includes(label)), "The editor footer should include Uninstall.");
            ctx.assert(editorLayout?.labels.some((label) => ['保存', 'Save'].includes(label)), "The editor footer should include Save.");
          },
          assert: async () => {
            await ctx.expectText("卸载");
            await ctx.expectText("保存");
          },
          screenshot: {
            name: "plugin-library-skill-editor-actions",
            requireText: ["卸载", "保存"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/skills",
          },
        });
      },
    },
    {
      name: "Handle an unavailable team skill catalog",
      run: async (ctx) => {
        await ctx.prove("Team skill failures use a localized message instead of raw request text", {
          action: async () => {
            await ctx.eval(`(() => {
              document.querySelector('[data-slot="dialog-content"] [data-slot="dialog-close"]')?.click();
            })()`);
            await ctx.waitFor(`!document.querySelector('[data-slot="dialog-content"]')`, {
              timeoutMs: 5_000,
              label: "closed skill editor",
            });
            const installedHeader = await ctx.eval(`(() => {
              const section = document.querySelector('[data-testid="skills-installed-section"]');
              const heading = section?.querySelector('h3');
              const description = section?.querySelector('p');
              if (!section || !heading || !description) return null;
              return {
                headingFontSize: getComputedStyle(heading).fontSize,
                headingLineHeight: getComputedStyle(heading).lineHeight,
                headingWeight: getComputedStyle(heading).fontWeight,
                descriptionFontSize: getComputedStyle(description).fontSize,
                descriptionLineHeight: getComputedStyle(description).lineHeight,
                borderBottomWidth: getComputedStyle(section).borderBottomWidth,
              };
            })()`);
            ctx.assert(installedHeader, "The installed skills section header was not available for comparison.");
            const openedTeam = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[data-testid="skills-library-source"] [role="tab"]')]
                .find((entry) => ['团队', 'Team'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(openedTeam, "The Team skills tab was not found.");
            await ctx.waitFor(`(() => {
              const text = document.body.innerText;
              return text.includes('团队 Skill 暂时无法加载，请稍后重试。')
                || text.includes('Team skills are temporarily unavailable. Please try again later.');
            })()`, {
              timeoutMs: 30_000,
              label: "localized team skill error",
            });
            const teamLayout = await ctx.eval(`(() => {
              const section = document.querySelector('[data-testid="skills-cloud-section"]');
              const heading = section?.querySelector('h3');
              const description = section?.querySelector('p');
              const workspace = section?.querySelector('span');
              const error = document.querySelector('[data-testid="skills-cloud-error"]');
              const topRefresh = [...(document.querySelector('[data-testid="skills-library-navigation-actions"]')?.querySelectorAll('button') ?? [])]
                .find((button) => ['刷新', 'Refresh'].includes(button.textContent?.trim() ?? ''));
              const duplicateRefresh = [...document.querySelectorAll('main button')]
                .some((button) => ['刷新团队skills', 'Refresh team skills'].includes(button.textContent?.trim() ?? ''));
              if (!section || !heading || !description || !workspace || !error) return null;
              const sectionRect = section.getBoundingClientRect();
              const workspaceRect = workspace.getBoundingClientRect();
              return {
                headingFontSize: getComputedStyle(heading).fontSize,
                headingLineHeight: getComputedStyle(heading).lineHeight,
                headingWeight: getComputedStyle(heading).fontWeight,
                descriptionFontSize: getComputedStyle(description).fontSize,
                descriptionLineHeight: getComputedStyle(description).lineHeight,
                borderBottomWidth: getComputedStyle(section).borderBottomWidth,
                workspaceRightAligned: Math.abs(workspaceRect.right - sectionRect.right) < 1,
                errorHeight: Math.round(error.getBoundingClientRect().height),
                errorColor: getComputedStyle(error).color,
                errorBackground: getComputedStyle(error).backgroundColor,
                topRefreshAvailable: Boolean(topRefresh),
                duplicateRefreshRemoved: !duplicateRefresh,
              };
            })()`);
            ctx.assert(teamLayout, "The Team skills section layout was not available.");
            ctx.assert(
              teamLayout.headingFontSize === installedHeader.headingFontSize
                && teamLayout.headingLineHeight === installedHeader.headingLineHeight
                && teamLayout.headingWeight === installedHeader.headingWeight
                && teamLayout.descriptionFontSize === installedHeader.descriptionFontSize
                && teamLayout.descriptionLineHeight === installedHeader.descriptionLineHeight
                && teamLayout.borderBottomWidth === installedHeader.borderBottomWidth,
              "Team skills should use the same section hierarchy as All skills.",
            );
            ctx.assert(teamLayout.workspaceRightAligned, "The active workspace should align to the right of the organization header.");
            ctx.assert(teamLayout.errorHeight === 36, "The Team skills error should be 36px high.");
            ctx.assert(teamLayout.errorColor === 'rgb(229, 72, 77)', "The Team skills error should use #E5484D text.");
            ctx.assert(teamLayout.errorBackground !== 'rgba(0, 0, 0, 0)', "The Team skills error should use the shared light error background.");
            ctx.assert(teamLayout.topRefreshAvailable, "The settings navigation should keep the shared Refresh action.");
            ctx.assert(teamLayout.duplicateRefreshRemoved, "The Team skills section should not duplicate the Refresh action.");
          },
          assert: async () => {
            await ctx.expectText("团队 Skill 暂时无法加载，请稍后重试。");
            await ctx.expectNoText("Request failed with 404");
            await ctx.expectNoText("刷新团队skills");
          },
          screenshot: {
            name: "plugin-library-team-skills-unavailable",
            requireText: ["团队 Skill 暂时无法加载，请稍后重试。"],
            rejectText: ["Request failed with 404", "Something went wrong"],
            hashIncludes: "/settings/extensions/skills",
          },
        });
      },
    },
    {
      name: "Keep the Skill Hub hierarchy consistent",
      run: async (ctx) => {
        await ctx.prove("The Skill Hub uses the shared section header and top Refresh action", {
          action: async () => {
            const openedAll = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[data-testid="skills-library-source"] [role="tab"]')]
                .find((entry) => ['全部', 'All'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(openedAll, "The All skills tab was not found.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="skills-installed-section"]'))`, {
              timeoutMs: 5_000,
              label: "installed skills section",
            });
            const installedHeader = await ctx.eval(`(() => {
              const section = document.querySelector('[data-testid="skills-installed-section"]');
              const heading = section?.querySelector('h3');
              const description = section?.querySelector('p');
              if (!section || !heading || !description) return null;
              return {
                headingFontSize: getComputedStyle(heading).fontSize,
                headingLineHeight: getComputedStyle(heading).lineHeight,
                headingWeight: getComputedStyle(heading).fontWeight,
                descriptionFontSize: getComputedStyle(description).fontSize,
                descriptionLineHeight: getComputedStyle(description).lineHeight,
                borderBottomWidth: getComputedStyle(section).borderBottomWidth,
              };
            })()`);
            ctx.assert(installedHeader, "The installed skills header was not available for comparison.");

            const openedHub = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[data-testid="skills-library-source"] [role="tab"]')]
                .find((entry) => ['技能中心', 'Hub'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(openedHub, "The Skill Hub tab was not found.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="skills-hub-section"]'))`, {
              timeoutMs: 5_000,
              label: "Skill Hub section",
            });

            const hubLayout = await ctx.eval(`(() => {
              const section = document.querySelector('[data-testid="skills-hub-section"]');
              const heading = section?.querySelector('h3');
              const description = section?.querySelector('p');
              const actions = section?.querySelector('[data-testid="skills-hub-header-actions"]');
              const error = document.querySelector('[data-testid="skills-hub-error"]');
              const topRefresh = [...(document.querySelector('[data-testid="skills-library-navigation-actions"]')?.querySelectorAll('button') ?? [])]
                .find((button) => ['刷新', 'Refresh'].includes(button.textContent?.trim() ?? ''));
              const duplicateRefresh = [...document.querySelectorAll('main button')]
                .some((button) => ['刷新Hub', 'Refresh hub'].includes(button.textContent?.trim() ?? ''));
              if (!section || !heading || !description || !actions) return null;
              const sectionRect = section.getBoundingClientRect();
              const actionsRect = actions.getBoundingClientRect();
              return {
                headingFontSize: getComputedStyle(heading).fontSize,
                headingLineHeight: getComputedStyle(heading).lineHeight,
                headingWeight: getComputedStyle(heading).fontWeight,
                descriptionFontSize: getComputedStyle(description).fontSize,
                descriptionLineHeight: getComputedStyle(description).lineHeight,
                borderBottomWidth: getComputedStyle(section).borderBottomWidth,
                actionsRightAligned: Math.abs(actionsRect.right - sectionRect.right) < 1,
                headerSourceLabelRemoved: !section.textContent?.includes('different-ai/ipollowork-hub@main'),
                topRefreshAvailable: Boolean(topRefresh),
                duplicateRefreshRemoved: !duplicateRefresh,
                rawErrorHidden: !/Failed to fetch hub catalog|Request failed with 404/.test(document.body.innerText),
                errorStyleValid: !error || (
                  Math.round(error.getBoundingClientRect().height) >= 36
                  && getComputedStyle(error).color === 'rgb(229, 72, 77)'
                  && getComputedStyle(error).backgroundColor !== 'rgba(0, 0, 0, 0)'
                ),
              };
            })()`);
            ctx.assert(hubLayout, "The Skill Hub section layout was not available.");
            ctx.assert(
              hubLayout.headingFontSize === installedHeader.headingFontSize
                && hubLayout.headingLineHeight === installedHeader.headingLineHeight
                && hubLayout.headingWeight === installedHeader.headingWeight
                && hubLayout.descriptionFontSize === installedHeader.descriptionFontSize
                && hubLayout.descriptionLineHeight === installedHeader.descriptionLineHeight
                && hubLayout.borderBottomWidth === installedHeader.borderBottomWidth,
              "The Skill Hub should use the same section hierarchy as All skills.",
            );
            ctx.assert(hubLayout.actionsRightAligned, "The Hub actions should align to the section's right edge.");
            ctx.assert(hubLayout.headerSourceLabelRemoved, "The active Hub source should not be repeated in the section header.");
            ctx.assert(hubLayout.topRefreshAvailable, "The settings navigation should keep the shared Refresh action.");
            ctx.assert(hubLayout.duplicateRefreshRemoved, "The Skill Hub should not duplicate the Refresh action.");
            ctx.assert(hubLayout.rawErrorHidden, "The Skill Hub should not expose raw request failures.");
            ctx.assert(hubLayout.errorStyleValid, "Any Skill Hub error should reuse the shared light error style.");
          },
          assert: async () => {
            await ctx.expectNoText("刷新Hub");
            await ctx.expectNoText("Request failed with 404");
            await ctx.expectNoText("Failed to fetch hub catalog");
          },
          screenshot: {
            name: "plugin-library-skill-hub-hierarchy",
            requireText: ["从Hub获取"],
            rejectText: ["刷新Hub", "Request failed with 404", "Something went wrong"],
            hashIncludes: "/settings/extensions/skills",
          },
        });
      },
    },
  ],
};
