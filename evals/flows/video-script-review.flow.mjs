import { createRequire } from "node:module";

const requireStudio = createRequire(new URL("../../vendor/hyperframes/packages/studio/package.json", import.meta.url));
const puppeteer = requireStudio("puppeteer-core");

export default {
  id: "video-script-review",
  title: "Script review stays readable and separates saving from production",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "5173" },
  steps: [{
    name: "Review the active script without generating media",
    async run(ctx) {
      const browser = await puppeteer.connect({ browserURL: ctx.cdpBaseUrl, defaultViewport: null });
      try {
        const page = (await browser.pages()).find((candidate) => candidate.url().includes("5173"));
        ctx.assert(Boolean(page), "The development client is open");
        // A failed previous proof may leave its voice picker open; cancel it
        // before asserting visibility of iframe-owned dialogs.
        await page.evaluate(() => {
          const dialog = document.querySelector('[data-testid="storyboard-settings-dialog"]');
          Array.from(dialog?.querySelectorAll("footer button") ?? []).find(button => button.textContent === "取消")?.click();
        });
        await page.waitForFunction(() => !document.querySelector('[data-testid="storyboard-settings-dialog"]'));
        let frame = page.frames().find((candidate) => candidate.url().includes("view=storyboard"));
        if (!frame) {
          const opened = await page.evaluate(() => {
            const file = Array.from(document.querySelectorAll("button")).find((button) => button.textContent.trim() === "STORYBOARD.mdMD");
            if (!file) return false;
            file.click();
            return true;
          });
          ctx.assert(opened, "The current session has an editable storyboard file");
          frame = await page.waitForFrame((candidate) => candidate.url().includes("view=storyboard"), { timeout: 20_000 });
        }
        ctx.assert(Boolean(frame), "An active script table is open in the client");
        await frame.waitForFunction(() => document.querySelectorAll("thead th").length === 6);
        const unsaved = await frame.evaluate(() => document.body.innerText.includes("未保存修改"));
        ctx.assert(!unsaved, "Save current script edits before refreshing the validation surface");
        await page.setCacheEnabled(false);
        const url = new URL(frame.url());
        url.searchParams.set("uiRevision", Date.now());
        await frame.goto(url.toString());
        await frame.waitForFunction(() => document.querySelectorAll("thead th").length === 6);
        await ctx.prove("The review table prioritizes picture, narration and duration", {
          voiceover: "主表只展示审稿需要的内容，保存和确认生成是两个独立动作。",
          assert: async () => {
            const state = await frame.evaluate(() => ({
              columns: document.querySelectorAll("thead th").length,
              shots: document.querySelectorAll("tr[data-shot]").length,
              buttons: Array.from(document.querySelectorAll("button")).map((button) => button.textContent.trim()),
              scrolls: Array.from(document.querySelectorAll("tr[data-shot] textarea")).filter((input) => input.scrollHeight > input.clientHeight + 2).length,
            }));
            ctx.assert(state.columns === 6 && state.shots > 0, "Six focused columns display the existing shots");
            ctx.assert(state.buttons.includes("保存脚本") && state.buttons.includes("确认脚本并生成视频"), "Save and production have distinct buttons");
            ctx.assert(state.scrolls === 0, "Picture and narration fields have no internal vertical scroll");
          },
          screenshot: { name: "script-review" },
        });
        await ctx.prove("Whole-video settings follow theme, visual style and music with 8px buttons", {
          voiceover: "先选择主题，再编辑画面风格和配乐；按钮统一为八像素圆角，长文案完整显示。",
          action: async () => {
            await frame.evaluate(() => document.querySelector('[aria-controls="storyboard-global-settings-body"]').click());
          },
          assert: async () => {
            const state = await frame.evaluate(() => {
              const body = document.querySelector('#storyboard-global-settings-body');
              const buttons = Array.from(document.querySelectorAll('.hf-script-overview button, .hf-script-global button'));
              const fields = Array.from(body.querySelectorAll('textarea'));
              return {
                headings: Array.from(body.children).map((child) => child.querySelector('span')?.textContent.trim()),
                radii: buttons.map((button) => getComputedStyle(button).borderRadius),
                overflow: body.scrollWidth > body.clientWidth + 1,
                fieldsReadable: fields.every((field) => field.scrollHeight <= field.clientHeight + 2),
              };
            });
            ctx.assert(state.headings.join('|') === '视频主题|全片画面风格|全片配乐', "Settings follow the visual decision order");
            ctx.assert(state.radii.every((radius) => radius === '8px'), "Every overview and settings button has an 8px corner radius");
            ctx.assert(!state.overflow && state.fieldsReadable, "Settings fit the panel and long descriptions remain visible");
          },
          screenshot: { name: "whole-video-settings" },
        });
        await frame.evaluate(() => document.querySelector('[aria-controls="storyboard-global-settings-body"]').click());

        const dimensions = [];
        async function modalState() {
          return page.evaluate(async () => {
            const dialog = document.querySelector('[data-testid="storyboard-settings-dialog"]');
            await Promise.all(dialog.getAnimations().map(animation => animation.finished.catch(() => undefined)));
            const rect = dialog.getBoundingClientRect();
            const footer = dialog.querySelector("footer").getBoundingClientRect();
            return {
              kind: dialog.dataset.kind,
              title: dialog.innerText,
              width: rect.width, height: rect.height,
              radii: Array.from(dialog.querySelectorAll("button")).map(button => getComputedStyle(button).borderRadius),
              nativeSelects: dialog.querySelectorAll("select").length,
              fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
              footerVisible: footer.top >= rect.top && footer.bottom <= rect.bottom,
              fields: Array.from(dialog.querySelectorAll("textarea")).every(input => input.clientHeight >= 60),
            };
          });
        }
        async function cancel() {
          await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="storyboard-settings-dialog"] footer button')).find(button => button.textContent === "取消").click());
          await page.waitForFunction(() => !document.querySelector('[data-testid="storyboard-settings-dialog"]'));
        }
        await ctx.prove("Picture materials use the client dialog and form components", {
          voiceover: "画面素材使用客户端弹窗，镜头动画收进更多设置，底部操作始终可见。",
          action: async () => {
            await frame.evaluate(() => document.querySelector('[data-testid="storyboard-picture-picker-1"]').click());
            await page.waitForSelector('[data-testid="storyboard-settings-dialog"] textarea');
          },
          assert: async () => {
            const state = await modalState(); dimensions.push([state.width, state.height]);
            ctx.assert(state.kind === "picture" && state.title.includes("画面与素材"), "Independent material dialog is mounted in the client");
            ctx.assert(state.nativeSelects === 0 && state.fields, "Client Select and Textarea replace Studio native controls");
            ctx.assert(state.fits && state.footerVisible, "Dialog and pinned footer fit the viewport");
            ctx.assert(state.radii.every(radius => radius === "8px"), "Dialog buttons have 8px corners");
          },
          screenshot: { name: "picture-dialog" },
        });
        await page.click('[data-testid="storyboard-settings-dialog"] [aria-label="素材来源"]');
        await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="option"]')).some(option => option.textContent.includes("使用已有素材") && option.getBoundingClientRect().height > 0));
        await ctx.prove("Material dropdown receives mouse clicks above the modal", {
          voiceover: "素材来源下拉菜单显示在弹窗之上，鼠标直接命中选项。",
          assert: async () => {
            ctx.assert(await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).filter(option => option.getBoundingClientRect().height > 0).every(option => {
              const rect = option.getBoundingClientRect();
              return option.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
            })), "Visible select options receive mouse hits above the dialog and backdrop");
          },
          screenshot: { name: "material-dropdown" },
        });
        for (const option of await page.$$('[role="option"]')) {
          if (await option.evaluate(element => element.textContent.includes("使用已有素材") && element.getBoundingClientRect().height > 0)) { await option.click(); break; }
        }
        await page.waitForFunction(() => document.querySelector('[data-testid="storyboard-settings-dialog"]').innerText.includes("项目素材"));
        ctx.assert(await page.evaluate(() => document.querySelector('[data-testid="storyboard-settings-dialog"] [aria-label="素材来源"]').innerText.includes("已有")), "Client dropdown applies a staged selection without replacing the dialog");
        await cancel();
        await ctx.prove("Sound settings share the same dialog size and cancel semantics", {
          voiceover: "音效使用同样尺寸的弹窗，只编辑音效和触发时机，取消不会写进脚本。",
          action: async () => {
            await frame.evaluate(() => document.querySelector('[data-testid="storyboard-sound-picker-1"]').click());
            await page.waitForSelector("#shot-sound-effects");
          },
          assert: async () => {
            const state = await modalState(); dimensions.push([state.width, state.height]);
            ctx.assert(state.kind === "sound" && state.fields && state.footerVisible && state.fits, "Sound-only controls are readable with visible footer");
            ctx.assert(state.width === dimensions[0][0] && state.height === dimensions[0][1], "Sound and material dialogs have equal width and height");
          },
          screenshot: { name: "sound-dialog" },
        });
        const original = await page.$eval("#shot-sound-effects", input => input.value);
        await page.evaluate(() => {
          const input = document.querySelector("#shot-sound-effects");
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "Fraimz cancellation check");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await cancel();
        await frame.evaluate(() => document.querySelector('[data-testid="storyboard-sound-picker-1"]').click());
        await page.waitForSelector("#shot-sound-effects");
        ctx.assert(await page.$eval("#shot-sound-effects", input => input.value) === original, "Cancel discards dialog-local edits");
        await cancel();

        const voiceSummary = await frame.evaluate(() => document.querySelector('[data-testid="storyboard-voice-picker-1"]').textContent);
        await ctx.prove("Voice settings open as a standalone modal with inline choices and explicit apply", {
          voiceover: "声线也是独立弹窗，选择和试听在同一层；应用后才更新表格，取消不改脚本。",
          action: async () => {
            await frame.evaluate(() => document.querySelector('[data-testid="storyboard-voice-picker-1"]').click());
            await page.waitForSelector('[data-testid="storyboard-settings-dialog"] [data-testid="preset-voice-card"]');
          },
          assert: async () => {
            const common = await modalState(); dimensions.push([common.width, common.height]);
            ctx.assert(dimensions.every(size => size[0] === dimensions[0][0] && size[1] === dimensions[0][1]), "All three client dialogs have identical dimensions");
            const host = await page.evaluate(() => {
              const dialog = document.querySelector('[data-testid="storyboard-settings-dialog"]');
              const rect = dialog.getBoundingClientRect();
              return {
                dialogs: document.querySelectorAll('[data-testid="storyboard-settings-dialog"]').length,
                trigger: dialog.querySelector('[data-testid="voice-selection-trigger"]') !== null,
                radii: Array.from(dialog.querySelectorAll("button")).map(button => getComputedStyle(button).borderRadius),
                footer: dialog.querySelector("footer").innerText,
                fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
              };
            });
            ctx.assert(host.dialogs === 1 && !host.trigger && host.fits, "One voice modal displays the options directly and fits the viewport");
            ctx.assert(host.radii.every(radius => radius === "8px"), "Voice buttons use the same 8px radius");
            ctx.assert(host.footer.includes("取消") && host.footer.includes("应用到脚本"), "Voice has the same cancel/apply semantics");
            ctx.assert(await frame.evaluate(() => !document.querySelector("#storyboard-shot-settings")), "No Studio sidebar or second modal remains behind the voice dialog");
          },
          screenshot: { name: "voice-dialog" },
        });
        await ctx.prove("Voice filters and nested dropdown stay clickable above the dialog", {
          voiceover: "声线筛选浮层与其中的下拉菜单都显示在弹窗之上，不会被遮罩拦截。",
          action: async () => {
            await page.click('[data-testid="storyboard-settings-dialog"] [aria-label="筛选音色"]');
            await page.waitForSelector('[data-slot="popover-content"]', { visible: true });
            await page.click('[data-slot="popover-content"] [aria-label="语言"]');
            await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="option"]')).some(option => option.getBoundingClientRect().height > 0));
          },
          assert: async () => {
            ctx.assert(await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).filter(option => option.getBoundingClientRect().height > 0).every(option => {
              const rect = option.getBoundingClientRect();
              return option.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
            })), "Voice dropdown options receive mouse hits above both the popover and modal");
          },
          screenshot: { name: "voice-dropdown" },
        });
        for (const option of await page.$$('[role="option"]')) {
          if (await option.evaluate(element => element.getAttribute("aria-selected") === "true" && element.getBoundingClientRect().height > 0)) { await option.click(); break; }
        }
        await page.click('[data-testid="storyboard-settings-dialog"] [aria-label="筛选音色"]');
        await page.evaluate(() => document.querySelector('[data-testid="storyboard-settings-dialog"] [data-testid="preset-voice-card"]').click());
        await page.waitForFunction(() => document.querySelector('[data-testid="storyboard-settings-dialog"] [data-testid="preset-voice-card"]')?.getAttribute("aria-pressed") === "true");
        const selectedState = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="storyboard-settings-dialog"] [data-testid="preset-voice-card"]')).map(button => ({ id: button.dataset.voiceId, pressed: button.getAttribute("aria-pressed"), disabled: button.closest("fieldset")?.disabled })));
        ctx.log(JSON.stringify(selectedState));
        ctx.assert(selectedState[0]?.pressed === "true", "Preset selection is visibly staged in the modal");
        ctx.assert(await frame.evaluate(() => document.querySelector('[data-testid="storyboard-voice-picker-1"]').textContent) === voiceSummary, "Choosing a voice stays local until Apply");
        await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="storyboard-settings-dialog"] footer button')).find(button => button.textContent === "取消").click());
        ctx.assert(await frame.evaluate(() => document.querySelector('[data-testid="storyboard-voice-picker-1"]').textContent) === voiceSummary, "Cancel preserves the original narration voice");
        ctx.assert(await frame.evaluate(() => !document.body.innerText.includes("未保存修改")), "Validation has not left script edits or generated media");
      } finally {
        await browser.disconnect();
      }
    },
  }],
};
