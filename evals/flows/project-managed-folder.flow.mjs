export default {
  id: "project-managed-folder",
  title: "Create a local project without selecting a source folder",
  kind: "user-facing",
  steps: [
    {
      name: "Open the new project dialog",
      run: async (ctx) => {
        await ctx.prove("The source folder is a compact optional control", {
          action: async () => {
            await ctx.navigateHash("/");
            await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="create-project-dialog"]');
              dialog?.querySelector('[data-slot="dialog-close"]')?.click();
              return true;
            })()`);
            await ctx.waitFor(`!document.querySelector('[data-testid="create-project-dialog"]')`, {
              timeoutMs: 5_000,
              label: "closed stale new project dialog",
            });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="new-project-button"]'))`, {
              timeoutMs: 30_000,
              label: "new project action",
            });
            const opened = await ctx.eval(`(() => {
              const button = [...document.querySelectorAll('[data-testid="new-project-button"]')]
                .find((entry) => entry.getClientRects().length > 0);
              if (!button) return false;
              const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
              const onClick = propsKey ? button[propsKey]?.onClick : null;
              if (typeof onClick === 'function') {
                onClick({ currentTarget: button, target: button, preventDefault() {}, stopPropagation() {} });
              } else {
                button.click();
              }
              return true;
            })()`);
            ctx.assert(opened, "The visible new project action was not available.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="create-project-dialog"]'))`, {
              timeoutMs: 5_000,
              label: "new project dialog",
            });

            const initialLayout = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="create-project-dialog"]');
              const picker = dialog?.querySelector('[data-testid="project-folder-picker"]');
              const nameInput = dialog?.querySelector('#create-project-name');
              const nameIcon = dialog?.querySelector('[data-testid="project-name-icon"]');
              const folderIcon = dialog?.querySelector('[data-testid="project-folder-icon"]');
              const folderLabel = dialog?.querySelector('[data-testid="project-folder-label"]');
              const create = [...(dialog?.querySelectorAll('button') ?? [])]
                .find((button) => ['新建项目', 'Create project'].includes(button.textContent?.trim() ?? ''));
              if (!dialog || !picker || !nameInput || !nameIcon || !folderIcon || !folderLabel || !create) return null;
              const style = getComputedStyle(picker);
              const nameInputStyle = getComputedStyle(nameInput);
              const placeholderStyle = getComputedStyle(nameInput, '::placeholder');
              const folderLabelStyle = getComputedStyle(folderLabel);
              const center = (entry) => {
                const rect = entry.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
              };
              const nameIconCenter = center(nameIcon);
              const folderIconCenter = center(folderIcon);
              const nameInputCenter = center(nameInput);
              const pickerCenter = center(picker);
              return {
                pickerHeight: Math.round(picker.getBoundingClientRect().height),
                solidBorder: style.borderTopStyle === 'solid',
                createDisabledBeforeName: create.disabled,
                compactLabel: ['选择项目文件夹', 'Choose project folder'].includes(picker.textContent?.trim() ?? ''),
                iconColumnsAligned: Math.abs(nameIconCenter.x - folderIconCenter.x) <= 1,
                iconsVerticallyCentered: Math.abs(nameIconCenter.y - nameInputCenter.y) < 1
                  && Math.abs(folderIconCenter.y - pickerCenter.y) < 1,
                secondaryCopyAligned: nameInputStyle.fontSize === '13px'
                  && nameInputStyle.lineHeight === '20px'
                  && nameInputStyle.fontWeight === '400'
                  && folderLabelStyle.fontSize === '13px'
                  && folderLabelStyle.lineHeight === '20px'
                  && folderLabelStyle.fontWeight === '400'
                  && placeholderStyle.color === folderLabelStyle.color,
                flatInput: nameInputStyle.boxShadow === 'none'
                  || !/(?:[1-9]\d*|0?\.\d+)px/.test(nameInputStyle.boxShadow),
                secondaryCopyStyles: {
                  placeholder: {
                    fontSize: nameInputStyle.fontSize,
                    lineHeight: nameInputStyle.lineHeight,
                    fontWeight: nameInputStyle.fontWeight,
                    color: placeholderStyle.color,
                  },
                  folder: {
                    fontSize: folderLabelStyle.fontSize,
                    lineHeight: folderLabelStyle.lineHeight,
                    fontWeight: folderLabelStyle.fontWeight,
                    color: folderLabelStyle.color,
                  },
                },
              };
            })()`);
            ctx.assert(
              initialLayout?.pickerHeight >= 38 && initialLayout.pickerHeight <= 42,
              `The source folder control should be approximately 40px high (actual: ${initialLayout?.pickerHeight ?? 'missing'}px).`,
            );
            ctx.assert(initialLayout?.solidBorder, "The source folder control should not look like a drag-and-drop target.");
            ctx.assert(initialLayout?.createDisabledBeforeName, "A project name should remain required.");
            ctx.assert(initialLayout?.compactLabel, "The source folder control should use a concise selection label.");
            ctx.assert(initialLayout?.iconColumnsAligned, "The name and folder icons should share one horizontal center line.");
            ctx.assert(initialLayout?.iconsVerticallyCentered, "Each project icon should be vertically centered in its control.");
            ctx.assert(initialLayout?.flatInput, "The project name input should not have a drop shadow.");
            ctx.assert(
              initialLayout?.secondaryCopyAligned,
              `Empty project controls should share the 13px secondary-copy style (${JSON.stringify(initialLayout?.secondaryCopyStyles)}).`,
            );

            await ctx.eval(`(() => {
              const input = document.querySelector('#create-project-name');
              if (!input) return false;
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              setter?.call(input, 'Managed local project');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(`(() => {
              const dialog = document.querySelector('[data-testid="create-project-dialog"]');
              const create = [...(dialog?.querySelectorAll('button') ?? [])]
                .find((button) => ['新建项目', 'Create project'].includes(button.textContent?.trim() ?? ''));
              return Boolean(create && !create.disabled);
            })()`, {
              timeoutMs: 5_000,
              label: "create enabled without a selected folder",
            });
          },
          assert: async () => {
            await ctx.expectText("源文件夹");
            await ctx.expectText("选择项目文件夹");
            await ctx.expectNoText("添加可读取和可编辑的文件夹");
          },
          screenshot: {
            name: "project-managed-folder-optional",
            requireText: ["新建项目", "项目名称", "源文件夹", "选择项目文件夹"],
            rejectText: ["添加可读取和可编辑的文件夹", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Close without creating test data",
      run: async (ctx) => {
        await ctx.prove("Closing the dialog leaves the current project unchanged", {
          action: async () => {
            const closed = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="create-project-dialog"]');
              const close = dialog?.querySelector('[data-slot="dialog-close"]');
              close?.click();
              return Boolean(close);
            })()`);
            ctx.assert(closed, "The new project dialog close control was not found.");
            await ctx.waitFor(`!document.querySelector('[data-testid="create-project-dialog"]')`, {
              timeoutMs: 5_000,
              label: "closed new project dialog",
            });
          },
        });
      },
    },
  ],
};
