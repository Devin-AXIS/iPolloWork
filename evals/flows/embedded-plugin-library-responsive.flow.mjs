export default {
  id: "embedded-plugin-library-responsive",
  title: "Embedded plugin library responsive width",
  kind: "user-facing",
  steps: [
    {
      name: "Open Extensions from the primary sidebar",
      run: async (ctx) => {
        await ctx.prove("The embedded plugin library fits the remaining workspace width", {
          action: async () => {
            const viewport = await ctx.eval(`({ height: innerHeight })`);
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {
              width: 800,
              height: viewport.height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await ctx.navigateHash("/");
            await ctx.waitFor(`(() => {
              const sidebar = [...document.querySelectorAll('[data-slot="sidebar"][data-side="left"]')]
                .find((entry) => entry.querySelector('[data-testid="brand-logo"]'));
              return Boolean([...sidebar?.querySelectorAll('[data-slot="sidebar-menu-button"]') ?? []]
                .find((entry) => ['扩展', 'Extensions'].includes(entry.textContent?.trim() ?? '')));
            })()`, {
              timeoutMs: 30_000,
              label: "loaded primary sidebar",
            });
            await ctx.eval(`(() => {
              const sidebar = [...document.querySelectorAll('[data-slot="sidebar"][data-side="left"]')]
                .find((entry) => entry.querySelector('[data-testid="brand-logo"]'));
              if (sidebar?.getAttribute('data-state') !== 'collapsed') return true;
              const trigger = document.querySelector('button[aria-label="展开"], button[aria-label="Expand"]')
                ?? document.querySelector('[data-testid="embedded-sidebar-restore"]')
                ?? sidebar.querySelector('[data-sidebar="trigger"]');
              trigger?.click();
              return Boolean(trigger);
            })()`);
            await ctx.waitFor(`[...document.querySelectorAll('[data-slot="sidebar"][data-side="left"]')]
              .find((entry) => entry.querySelector('[data-testid="brand-logo"]'))?.getAttribute('data-state') === 'expanded'`, {
              timeoutMs: 5_000,
              label: "expanded primary sidebar",
            });
            await ctx.waitFor(`(() => {
              const sidebar = [...document.querySelectorAll('[data-slot="sidebar"][data-side="left"]')]
                .find((entry) => entry.querySelector('[data-testid="brand-logo"]'));
              return Boolean([...sidebar?.querySelectorAll('[data-slot="sidebar-menu-button"]') ?? []]
                .find((entry) => ['扩展', 'Extensions'].includes(entry.textContent?.trim() ?? '') && entry.getClientRects().length > 0));
            })()`, {
              timeoutMs: 30_000,
              label: "primary extensions entry",
            });
            const opened = await ctx.eval(`(() => {
              const sidebar = [...document.querySelectorAll('[data-slot="sidebar"][data-side="left"]')]
                .find((entry) => entry.querySelector('[data-testid="brand-logo"]'));
              const button = [...sidebar?.querySelectorAll('[data-slot="sidebar-menu-button"]') ?? []]
                .find((entry) => ['扩展', 'Extensions'].includes(entry.textContent?.trim() ?? '') && entry.getClientRects().length > 0);
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(opened, "The primary Extensions entry could not be opened.");
            await new Promise((resolve) => setTimeout(resolve, 300));
            await ctx.eval(`(() => {
              if (document.querySelector('[data-settings-shell]')) return true;
              const sidebar = [...document.querySelectorAll('[data-slot="sidebar"][data-side="left"]')]
                .find((entry) => entry.querySelector('[data-testid="brand-logo"]'));
              const button = [...sidebar?.querySelectorAll('[data-slot="sidebar-menu-button"]') ?? []]
                .find((entry) => ['扩展', 'Extensions'].includes(entry.textContent?.trim() ?? '') && entry.getClientRects().length > 0);
              button?.click();
              return Boolean(button);
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-settings-shell]')
              && document.querySelector('[data-testid="plugin-installed-row"]'))`, {
              timeoutMs: 30_000,
              label: "embedded plugin library",
            });
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 799, y: 760 });

            const layout = await ctx.eval(`(() => {
              const shell = document.querySelector('[data-settings-shell]');
              const content = document.querySelector('[data-settings-content]');
              const safeArea = document.querySelector('[data-settings-safe-area]');
              const row = document.querySelector('[data-testid="plugin-installed-row"]');
              const installedSection = document.querySelector('[data-testid="plugin-library-installed"]');
              const installedHeader = installedSection?.firstElementChild;
              const tiles = [...document.querySelectorAll('[data-testid="plugin-installed-tile"]')];
              const expand = document.querySelector('[data-testid="plugin-installed-expand"]');
              const primaryNavigationButtons = [...document.querySelectorAll('[data-slot="sidebar-menu-button"]')]
                .filter((button) => ['新建对话', 'New conversation', '模版', '模板', 'Templates', '扩展', 'Extensions']
                  .includes(button.textContent?.trim() ?? ''));
              const primaryNavigationIcons = primaryNavigationButtons
                .map((button) => button.querySelector('[aria-hidden="true"]'))
                .filter(Boolean);
              const primaryExtensionsButton = primaryNavigationButtons.find((button) =>
                ['扩展', 'Extensions'].includes(button.textContent?.trim() ?? ''));
              const selectedProjectRow = document.querySelector('[data-testid="project-row"][aria-current="page"]');
              const selectedProjectGroup = selectedProjectRow?.closest('[data-slot="sidebar-group"]');
              const selectedConversationRow = selectedProjectGroup?.querySelector(
                '[data-slot="sidebar-menu-sub-button"]:not([aria-disabled="true"]), [data-slot="sidebar-menu-sub"] [data-slot="context-menu-trigger"]',
              );
              const selectedProjectIcon = selectedProjectRow?.querySelector('[aria-hidden="true"]');
              if (!shell || !content || !safeArea || !row || !installedHeader || tiles.length === 0) return null;
              const shellRect = shell.getBoundingClientRect();
              const contentRect = content.getBoundingClientRect();
              const safeAreaRect = safeArea.getBoundingClientRect();
              const rowRect = row.getBoundingClientRect();
              const remaining = Number(expand?.getAttribute('data-remaining-count') ?? '0');
              const capacity = Math.max(1, Math.floor((rowRect.width + 8) / 56));
              return {
                shellWidthMatchesWorkspace: Math.abs(shellRect.width - (innerWidth - shellRect.left)) <= 1,
                rightEdgesFit: [shellRect, contentRect, safeAreaRect, rowRect]
                  .every((rect) => rect.right <= innerWidth + 1),
                tilesFitRow: tiles.every((tile) => tile.getBoundingClientRect().right <= rowRect.right + 1),
                dividerToModuleGap: Math.round(rowRect.top - installedHeader.getBoundingClientRect().bottom),
                previewCountFits: tiles.length <= capacity && tiles.length + remaining > 0,
                rightPanelToggleHidden: ![...document.querySelectorAll('button')]
                  .some((button) => button.getClientRects().length > 0
                    && button.querySelector('img[src*="sidebar-right-"]')),
                closeButtonHidden: !document.querySelector(
                  'button[aria-label="关闭设置"], button[aria-label="Close settings"]',
                ),
                primaryNavigationIconsAligned: primaryNavigationIcons.length === 3
                  && primaryNavigationIcons.every((icon) => Math.round(icon.getBoundingClientRect().width) === 16)
                  && primaryNavigationIcons.every((icon) => Math.abs(icon.getBoundingClientRect().left - primaryNavigationIcons[0].getBoundingClientRect().left) < 1)
                  && primaryNavigationIcons.every((icon) => {
                    const artwork = icon.querySelector('img');
                    if (!artwork) return false;
                    const iconRect = icon.getBoundingClientRect();
                    const artworkRect = artwork.getBoundingClientRect();
                    return Math.round(Math.max(artworkRect.width, artworkRect.height)) === 14
                      && Math.abs((iconRect.left + iconRect.width / 2) - (artworkRect.left + artworkRect.width / 2)) < 1;
                  })
                  && primaryExtensionsButton?.querySelector('img')?.getAttribute('src')?.includes('sidebar-icon/toy-brick.svg'),
                projectIconAligned: selectedProjectIcon
                  && Math.round(selectedProjectIcon.getBoundingClientRect().width) === 16
                  && Math.abs(selectedProjectIcon.getBoundingClientRect().left - primaryNavigationIcons[0].getBoundingClientRect().left) < 1
                  && Math.round(Math.max(
                    selectedProjectIcon.querySelector('img')?.getBoundingClientRect().width ?? 0,
                    selectedProjectIcon.querySelector('img')?.getBoundingClientRect().height ?? 0,
                  )) === 14,
                navigationHoverAreasMatch: selectedProjectRow
                  && primaryNavigationButtons.every((button) => {
                    const buttonRect = button.getBoundingClientRect();
                    const projectRect = selectedProjectRow.getBoundingClientRect();
                    return Math.abs(buttonRect.left - projectRect.left) < 1
                      && Math.abs(buttonRect.right - projectRect.right) < 1
                      && Math.round(buttonRect.height) === Math.round(projectRect.height);
                  }),
                conversationHoverAreaMatches: selectedProjectRow && selectedConversationRow
                  && Math.abs(selectedConversationRow.getBoundingClientRect().left - selectedProjectRow.getBoundingClientRect().left) < 1
                  && Math.abs(selectedConversationRow.getBoundingClientRect().right - selectedProjectRow.getBoundingClientRect().right) < 1
                  && Math.round(selectedConversationRow.getBoundingClientRect().height) === Math.round(selectedProjectRow.getBoundingClientRect().height),
                selectedProjectUsesExpansionOnly: selectedProjectRow
                  && selectedProjectRow.getAttribute('aria-expanded') === 'true'
                  && getComputedStyle(selectedProjectRow).backgroundColor === 'rgba(0, 0, 0, 0)',
                dimensions: {
                  viewport: innerWidth,
                  shellLeft: Math.round(shellRect.left),
                  shellWidth: Math.round(shellRect.width),
                  shellRight: Math.round(shellRect.right),
                  rowWidth: Math.round(rowRect.width),
                  visibleTiles: tiles.length,
                  remaining,
                  capacity,
                  projectRow: selectedProjectRow ? {
                    left: Math.round(selectedProjectRow.getBoundingClientRect().left),
                    right: Math.round(selectedProjectRow.getBoundingClientRect().right),
                    height: Math.round(selectedProjectRow.getBoundingClientRect().height),
                  } : null,
                  conversationRow: selectedConversationRow ? {
                    left: Math.round(selectedConversationRow.getBoundingClientRect().left),
                    right: Math.round(selectedConversationRow.getBoundingClientRect().right),
                    height: Math.round(selectedConversationRow.getBoundingClientRect().height),
                  } : null,
                },
              };
            })()`);
            ctx.assert(
              layout?.shellWidthMatchesWorkspace,
              `Embedded settings should shrink to the remaining workspace (${JSON.stringify(layout?.dimensions)}).`,
            );
            ctx.assert(layout?.rightEdgesFit, "Embedded plugin content should remain inside the window.");
            ctx.assert(layout?.tilesFitRow, "Installed plugin previews should remain inside their visible row.");
            ctx.assert(layout?.dividerToModuleGap === 12, "The installed plugin divider should sit 12px above the icon module.");
            ctx.assert(layout?.previewCountFits, "Installed plugin preview count should use the embedded row width.");
            ctx.assert(layout?.rightPanelToggleHidden, "Embedded Extensions should not show the right-panel toggle.");
            ctx.assert(layout?.closeButtonHidden, "Embedded Extensions should not show a redundant close button.");
            ctx.assert(layout?.primaryNavigationIconsAligned, "Primary navigation icons should share aligned 16px slots with 14px artwork.");
            ctx.assert(layout?.projectIconAligned, "Project icons should share the primary navigation alignment and 14px artwork size.");
            ctx.assert(layout?.navigationHoverAreasMatch, "Primary navigation and project rows should share one hover width and height.");
            ctx.assert(layout?.conversationHoverAreaMatches, `Conversation and project rows should share one hover width and height (${JSON.stringify(layout?.dimensions)}).`);
            ctx.assert(layout?.selectedProjectUsesExpansionOnly, "The selected project should expand its conversations without a persistent background.");

            const hoverTargets = await ctx.eval(`(() => {
              const primary = [...document.querySelectorAll('[data-slot="sidebar-menu-button"]')]
                .find((button) => ['模板', '模版', 'Templates'].includes(button.textContent?.trim() ?? ''));
              const project = document.querySelector('[data-testid="project-row"][aria-current="page"]');
              const center = (entry) => {
                const rect = entry?.getBoundingClientRect();
                return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
              };
              return { primary: center(primary), project: center(project) };
            })()`);
            ctx.assert(hoverTargets?.primary && hoverTargets?.project, "Sidebar hover targets were unavailable.");
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverTargets.primary });
            const primaryHoverColor = await ctx.eval(`getComputedStyle([...document.querySelectorAll('[data-slot="sidebar-menu-button"]')]
              .find((button) => ['模板', '模版', 'Templates'].includes(button.textContent?.trim() ?? ''))).backgroundColor`);
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverTargets.project });
            const projectHoverColor = await ctx.eval(`getComputedStyle(document.querySelector('[data-testid="project-row"][aria-current="page"]')).backgroundColor`);
            ctx.assert(
              primaryHoverColor === projectHoverColor && projectHoverColor !== 'rgba(0, 0, 0, 0)',
              `Project hover should use the same visible color as primary navigation (${primaryHoverColor} / ${projectHoverColor}).`,
            );

            const collapsedProject = await ctx.eval(`(() => {
              const row = document.querySelector('[data-testid="project-row"][aria-current="page"]');
              row?.click();
              return Boolean(row);
            })()`);
            ctx.assert(collapsedProject, "The selected project row could not be collapsed.");
            await ctx.waitFor(`document.querySelector('[data-testid="project-row"][aria-current="page"]')?.getAttribute('aria-expanded') === 'false'`, {
              timeoutMs: 5_000,
              label: "collapsed project with one click",
            });
            await ctx.eval(`document.querySelector('[data-testid="project-row"][aria-current="page"]')?.click()`);
            await ctx.waitFor(`document.querySelector('[data-testid="project-row"][aria-current="page"]')?.getAttribute('aria-expanded') === 'true'`, {
              timeoutMs: 5_000,
              label: "expanded project with one click",
            });
          },
          assert: async () => {
            const copy = await ctx.eval(`document.body.innerText`);
            ctx.assert(copy.includes("插件") || copy.includes("Plugins"), "The plugin library heading should be visible.");
            ctx.assert(copy.includes("已安装") || copy.includes("Installed"), "The installed plugin section should be visible.");
          },
          screenshot: {
            name: "plugin-library-embedded-responsive",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Preview and toggle installed plugins",
      run: async (ctx) => {
        await ctx.prove("Installed plugin previews stay compact and can be expanded or collapsed as a group", {
          action: async () => {
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-installed-row"]')
              && document.querySelector('[data-testid="plugin-installed-expand"]'))`, {
              timeoutMs: 5_000,
              label: "installed plugin overflow toggle",
            });

            const hoverPoint = await ctx.eval(`(() => {
              const tile = [...document.querySelectorAll('[data-testid="plugin-installed-tile"]')].at(-1);
              if (!tile) return null;
              const rect = tile.getBoundingClientRect();
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            })()`);
            ctx.assert(hoverPoint, "No installed plugin preview was available to hover.");
            await ctx.client.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: hoverPoint.x,
              y: hoverPoint.y,
            });
            await ctx.waitFor(`(() => {
              const tiles = [...document.querySelectorAll('[data-testid="plugin-installed-tile"]')];
              const gaps = tiles.slice(1).map((tile, index) =>
                Math.round(tile.getBoundingClientRect().left - tiles[index].getBoundingClientRect().right));
              return tiles.length > 0
                && tiles.every((tile) => Math.round(tile.getBoundingClientRect().width) === 48)
                && gaps.every((gap) => gap === 8)
                && getComputedStyle(tiles.at(-1)).borderColor === 'rgb(31, 186, 192)'
                && getComputedStyle(tiles.at(-1)).borderTopWidth === '2px'
                && !tiles.at(-1).hasAttribute('title')
                && Boolean(document.querySelector('[data-testid="plugin-installed-tooltip"]')?.getClientRects().length)
                && !document.querySelector('[data-testid="plugin-installed-details"]');
            })()`, {
              timeoutMs: 5_000,
              label: "fixed compact installed plugin previews",
            });
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });

            const collapsedCount = await ctx.eval(`document.querySelectorAll('[data-testid="plugin-installed-tile"]').length`);
            const expanded = await ctx.eval(`(() => {
              const toggle = document.querySelector('[data-testid="plugin-installed-expand"]');
              toggle?.click();
              return Boolean(toggle);
            })()`);
            ctx.assert(expanded, "The installed plugin overflow toggle could not be expanded.");
            await ctx.waitFor(`(() => {
              const toggle = document.querySelector('[data-testid="plugin-installed-expand"]');
              return toggle?.getAttribute('aria-expanded') === 'true'
                && ['收起', 'Collapse'].includes(toggle.textContent?.trim() ?? '')
                && document.querySelectorAll('[data-testid="plugin-installed-tile"]').length > ${collapsedCount};
            })()`, {
              timeoutMs: 5_000,
              label: "expanded installed plugins",
            });
          },
          assert: async () => {
            const copy = await ctx.eval(`document.body.innerText`);
            ctx.assert(copy.includes("已安装") || copy.includes("Installed"), "The installed plugin section should be visible.");
          },
          screenshot: {
            name: "plugin-library-installed-previews",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Collapse installed plugins",
      run: async (ctx) => {
        await ctx.prove("The expanded installed plugin group can return to its compact row", {
          action: async () => {
            const expandedCount = await ctx.eval(`document.querySelectorAll('[data-testid="plugin-installed-tile"]').length`);
            const collapsed = await ctx.eval(`(() => {
              const toggle = document.querySelector('[data-testid="plugin-installed-expand"]');
              toggle?.click();
              return Boolean(toggle);
            })()`);
            ctx.assert(collapsed, "The installed plugin overflow toggle could not be collapsed.");
            await ctx.waitFor(`document.querySelector('[data-testid="plugin-installed-expand"]')?.getAttribute('aria-expanded') === 'false'
              && document.querySelectorAll('[data-testid="plugin-installed-tile"]').length < ${expandedCount}`, {
              timeoutMs: 5_000,
              label: "collapsed installed plugins",
            });
          },
        });
      },
    },
    {
      name: "Open the settings select menu",
      run: async (ctx) => {
        await ctx.prove("Settings selects reuse the compact design-panel menu states", {
          action: async () => {
            const opened = await ctx.eval(`(() => {
              const trigger = document.querySelector('[data-testid="plugin-category-filter"]');
              trigger?.click();
              return Boolean(trigger);
            })()`);
            ctx.assert(opened, "The plugin category select could not be opened.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-slot="select-content"]')?.getClientRects().length)`, {
              timeoutMs: 5_000,
              label: "settings select menu",
            });
            const hoverPoint = await ctx.eval(`(() => {
              const item = [...document.querySelectorAll('[data-slot="select-item"]')].find((entry) => entry.getAttribute('aria-selected') !== 'true');
              if (!item) return null;
              const rect = item.getBoundingClientRect();
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            })()`);
            ctx.assert(hoverPoint, "No unselected settings option was available to hover.");
            await ctx.client.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: hoverPoint.x,
              y: hoverPoint.y,
            });
            await ctx.waitFor(`(() => {
              const trigger = document.querySelector('[data-testid="plugin-category-filter"]');
              const popup = document.querySelector('[data-slot="select-content"]');
              const items = [...document.querySelectorAll('[data-slot="select-item"]')];
              const hovered = items.find((item) => item.hasAttribute('data-highlighted'));
              const selected = items.find((item) => item.getAttribute('aria-selected') === 'true');
              const indicator = selected?.querySelector('svg');
              if (!trigger || !popup || !hovered || !indicator || items.length === 0) return false;
              return Math.round(trigger.getBoundingClientRect().height) === 34
                && popup.getBoundingClientRect().width > trigger.getBoundingClientRect().width
                && popup.getBoundingClientRect().right <= innerWidth
                && items.every((item) => item.scrollWidth <= item.clientWidth)
                && getComputedStyle(trigger).borderRadius === '8px'
                && getComputedStyle(popup).borderRadius === '8px'
                && getComputedStyle(popup).backgroundColor === 'rgb(255, 255, 255)'
                && items.every((item) => Math.round(item.getBoundingClientRect().height) === 32)
                && items.every((item) => getComputedStyle(item).borderRadius === '6px')
                && getComputedStyle(hovered).backgroundColor === 'rgb(246, 247, 251)'
                && getComputedStyle(indicator).color === 'rgb(31, 186, 192)';
            })()`, {
              timeoutMs: 5_000,
              label: "design-panel settings select states",
            });
          },
          screenshot: {
            name: "settings-select-design-panel-states",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Restore the primary sidebar from Extensions",
      run: async (ctx) => {
        await ctx.prove("The Extensions navigation keeps a way to reopen the collapsed primary sidebar", {
          action: async () => {
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
            const collapsed = await ctx.eval(`(() => {
              const sidebar = document.querySelector('[data-slot="sidebar-container"]');
              const trigger = sidebar?.querySelector('[data-sidebar="trigger"]');
              trigger?.click();
              return Boolean(trigger);
            })()`);
            ctx.assert(collapsed, "The primary sidebar collapse action was unavailable.");
            await ctx.waitFor(`(() => {
              const restore = document.querySelector('[data-testid="embedded-sidebar-restore"]');
              const sidebar = document.querySelector('[data-slot="sidebar"][data-side="left"]');
              return Boolean(restore?.getClientRects().length)
                && sidebar?.getAttribute('data-state') === 'collapsed';
            })()`, {
              timeoutMs: 5_000,
              label: "embedded sidebar restore action",
            });
            const restored = await ctx.eval(`(() => {
              const restore = document.querySelector('[data-testid="embedded-sidebar-restore"]');
              restore?.click();
              return Boolean(restore);
            })()`);
            ctx.assert(restored, "The embedded Extensions navigation could not restore the primary sidebar.");
            await ctx.waitFor(`(() => {
              const sidebar = document.querySelector('[data-slot="sidebar"][data-side="left"]');
              return sidebar?.getAttribute('data-state') === 'expanded'
                && !document.querySelector('[data-testid="embedded-sidebar-restore"]');
            })()`, {
              timeoutMs: 5_000,
              label: "restored primary sidebar",
            });
          },
          screenshot: {
            name: "plugin-library-sidebar-restored",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Clamp plugin descriptions",
      run: async (ctx) => {
        await ctx.prove("Plugin card descriptions stop after two lines and use an ellipsis", {
          action: async () => {
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
            const opened = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[data-testid="plugin-library-source"] [role="tab"]')]
                .find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(opened, "The Personal plugin source could not be opened.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-package-list-item"]'))`, {
              timeoutMs: 5_000,
              label: "personal plugin cards",
            });
            const descriptions = await ctx.eval(`[...document.querySelectorAll('[data-testid="plugin-package-card-copy"]')]
              .map((copy) => {
                const description = copy.children[1];
                if (!description) return null;
                const style = getComputedStyle(description);
                const lineHeight = Number.parseFloat(style.lineHeight);
                return {
                  lineClamp: style.webkitLineClamp,
                  overflow: style.overflow,
                  height: description.getBoundingClientRect().height,
                  maxHeight: lineHeight * 2 + 1,
                };
              })`);
            ctx.assert(
              descriptions.length > 0 && descriptions.every((entry) =>
                entry?.lineClamp === '2' && entry.overflow === 'hidden' && entry.height <= entry.maxHeight),
              `Plugin descriptions should clamp to two lines (${JSON.stringify(descriptions)}).`,
            );
          },
          assert: async () => {
            const copy = await ctx.eval(`document.body.innerText`);
            ctx.assert(copy.includes("个人") || copy.includes("Personal"), "The Personal plugin source should be visible.");
          },
          screenshot: {
            name: "plugin-library-two-line-descriptions",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Keep skill section spacing consistent",
      run: async (ctx) => {
        await ctx.prove("Skill sections use the same 12px divider-to-content spacing", {
          action: async () => {
            const opened = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['技能', 'Skills'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(opened, "The embedded Skills tab could not be opened.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="skills-installed-section"]')
              && document.querySelector('[data-testid="skills-cloud-section"]')
              && document.querySelector('[data-testid="skills-hub-section"]'))`, {
              timeoutMs: 30_000,
              label: "embedded skill sections",
            });
            const gaps = await ctx.eval(`['skills-installed-section', 'skills-cloud-section', 'skills-hub-section']
              .map((testId) => {
                const header = document.querySelector('[data-testid="' + testId + '"]');
                const content = header?.nextElementSibling;
                return header && content
                  ? Math.round(content.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
                  : null;
              })`);
            ctx.assert(gaps.every((gap) => gap === 12), `Skill section spacing should be 12px (${JSON.stringify(gaps)}).`);
          },
          assert: async () => {
            const copy = await ctx.eval(`document.body.innerText`);
            ctx.assert(copy.includes("技能") || copy.includes("Skills"), "The skill library heading should be visible.");
            ctx.assert(copy.includes("已安装") || copy.includes("Installed"), "The installed skill section should be visible.");
          },
          screenshot: {
            name: "skill-library-section-spacing",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Restore the desktop viewport",
      run: async (ctx) => {
        await ctx.prove("The responsive check leaves the desktop viewport unchanged", {
          action: async () => {
            await ctx.client.send("Emulation.clearDeviceMetricsOverride");
            const viewportReady = await ctx.eval(`innerWidth > 0 && innerHeight > 0`);
            ctx.assert(viewportReady, "The desktop viewport was not restored after the responsive check.");
          },
        });
      },
    },
  ],
};
