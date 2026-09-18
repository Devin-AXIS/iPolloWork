import { fileURLToPath } from "node:url";

const origin = process.env.IPOLLOWORK_NARRATION_PROOF_ORIGIN || "http://127.0.0.1:5190";

async function openFixture(ctx, query) {
  await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 980, height: 950, deviceScaleFactor: 1, mobile: false });
  await ctx.client.send("Page.navigate", { url: `${origin}/tests/video-avatar-proof.html?${query}` });
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=video-avatar-panel]'))");
}

async function readStudio(ctx, expression) {
  const tree = await ctx.client.send("Page.getFrameTree");
  const frame = tree.frameTree.childFrames?.find(item => item.frame.url.includes(":5191"));
  ctx.assert(Boolean(frame), "Studio iframe did not load");
  const world = await ctx.client.send("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "narration-proof" });
  const result = await ctx.client.send("Runtime.evaluate", { expression, contextId: world.executionContextId, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function clickStudioButton(ctx, label) {
  const rect = await readStudio(ctx, `(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) return null; const bounds = button.getBoundingClientRect(); return {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2}; })()`);
  ctx.assert(Boolean(rect), `Studio button ${label} missing`);
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
}

async function uploadReference(ctx) {
  const { root } = await ctx.client.send("DOM.getDocument");
  const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="video-avatar-panel"] input[type="file"]' });
  ctx.assert(Boolean(nodeId), "Avatar image input missing");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [fileURLToPath(new URL("../../apps/app/public/default-brand-avatar.jpg", import.meta.url))] });
  await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"替换人物图片\"]')) && !document.querySelector('[data-testid=video-avatar-panel] input[type=file]').disabled");
}

export default {
  id: "video-narration-avatars",
  title: "Narration and independently configured avatars",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "video-avatar-proof.html" },
  preserveTheme: true,
  steps: [
    { name: "Six inspector tabs and narration subnavigation", run: async ctx => {
      await ctx.prove("The inspector keeps six main tabs and groups voiceover with avatars under Narration", {
        voiceover: "视频属性仍有六个主标签。讲解里先看到配音，再切到数字人；配音音色从一个选择框里打开。",
        action: async () => {
          await ctx.client.send("Page.navigate", { url: `${origin}/tests/video-avatar-proof.html?panel=role&studioPort=5191&profiles=1&audio=1` });
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=video-voice-panel]'))");
        },
        assert: async () => {
          const studio = await readStudio(ctx, `(() => {
            const labels = ['图层','主题','组件','动画','讲解','素材'];
            return {tabs: labels.map(label => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === label)), sub: [...document.querySelectorAll('button')].filter(button => ['配音','数字人'].includes(button.textContent.trim())).map(button => button.textContent.trim())};
          })()`);
          ctx.assert(studio.tabs.every(Boolean) && studio.sub.join(",") === "配音,数字人", JSON.stringify(studio));
          ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-testid=voice-selection-trigger]')) && !document.querySelector('[data-testid=voice-subtabs]')"), "Voice library tabs stay inside the selector");
        },
        screenshot: { name: "narration-default-voice" },
      });
    } },
    { name: "Avatar image survives the voice switch", run: async ctx => {
      await ctx.prove("Switching to voiceover and back keeps the avatar image and draft", {
        voiceover: "给数字人上传形象后，即使去调整配音再回来，人物图片和配置也不会丢失。",
        action: async () => {
          await clickStudioButton(ctx, "数字人");
          await ctx.waitFor("document.querySelector('[data-testid=video-avatar-panel]')?.checkVisibility()");
          await ctx.clickText("创建数字人", { selector: "button" });
          await uploadReference(ctx);
          await ctx.clickText("调整配音", { selector: "button" });
          await ctx.waitFor("document.querySelector('[data-testid=video-voice-panel]')?.checkVisibility()");
          await clickStudioButton(ctx, "数字人");
          await ctx.waitFor("document.querySelector('[data-testid=video-avatar-panel]')?.checkVisibility()");
          await ctx.waitFor("window.avatarProof.profiles.some(profile => profile.imageName === 'default-brand-avatar.jpg')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid=video-avatar-panel]');
            const link = [...panel.querySelectorAll('button')].find(button => button.textContent.trim() === '调整配音');
            return { image: panel.querySelector('img')?.naturalWidth > 0,
              saved: window.avatarProof.profiles.some(profile => profile.imageName === 'default-brand-avatar.jpg'),
              stillEditing: Boolean(panel.querySelector('input[maxlength="80"]')),
              linkOnRight: link && link.getBoundingClientRect().right >= panel.getBoundingClientRect().right - 32 };
          })()`);
          ctx.assert(state.image && state.saved && state.stillEditing && state.linkOnRight, JSON.stringify(state));
        },
        screenshot: { name: "avatar-restored-after-voice", requireText: ["default-brand-avatar.jpg", "配音片段"] },
      });
    } },
    { name: "Independent avatar profiles", run: async ctx => {
      await ctx.prove("Each avatar can be created and named independently", {
        voiceover: "可以创建多个数字人，每个人有自己的名称、形象和设置。返回列表后，已保存的配置仍在。",
        action: async () => {
          await openFixture(ctx, "panel=avatar&profiles=1");
          await ctx.clickText("创建数字人", { selector: "button" });
          await ctx.fill("input[maxlength='80']", "产品讲解人");
          await ctx.clickText("数字人列表", { selector: "button" });
          await ctx.waitFor("document.querySelectorAll('[data-testid=avatar-profile-card]').length === 1");
          await ctx.clickText("创建数字人", { selector: "button" });
          await ctx.clickText("数字人列表", { selector: "button" });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid=video-avatar-panel]');
            const create = [...panel.querySelectorAll('button')].find(button => button.textContent.includes('创建数字人'));
            const cards = [...panel.querySelectorAll('[data-testid=avatar-profile-card]')];
            return {
              saved: window.avatarProof.profiles.length === 2 && window.avatarProof.profiles.some(profile => profile.name === '产品讲解人'),
              count: panel.querySelector('p')?.textContent === '已创建 2 位',
              noDuplicateIntro: !panel.textContent.includes('每位数字人分别设置形象和配音片段。'),
              createShadow: getComputedStyle(create).boxShadow,
              cards: cards.length,
              cardHeight: cards[0]?.getBoundingClientRect().height,
            };
          })()`);
          ctx.assert(state.saved && state.count && state.noDuplicateIntro && state.cards === 2 && state.cardHeight <= 68 && !/[1-9]\d*px/.test(state.createShadow), JSON.stringify(state));
        },
        screenshot: { name: "two-avatar-profiles", requireText: ["已创建 2 位", "产品讲解人"] },
      });
    } },
    { name: "Save appearance before narration", run: async ctx => {
      await ctx.prove("Saving an avatar setup does not submit a video generation job", {
        voiceover: "名称、配音片段、画面设置和动作描述使用相同标题层级，相邻模块间隔 24 像素。没有配音时可以保存设置，但只有点击生成数字人片段才会提交生成任务。",
        action: async () => {
          await ctx.trustedClick('[data-testid=avatar-profile-card]:first-child');
          await uploadReference(ctx);
          await ctx.clickText("保存设置", { selector: "button" });
          await ctx.waitFor("document.querySelector('[data-testid=video-avatar-panel]')?.textContent.includes('设置已保存')");
          await ctx.eval("document.querySelector('[data-testid=video-avatar-panel]').scrollIntoView({ block: 'start' })");
        },
        assert: async () => {
          await ctx.waitFor("window.avatarProof.profiles.some(profile => profile.name === '产品讲解人' && profile.imagePath.includes('/assets/'))");
          const state = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid=video-avatar-panel]');
            const modules = [...panel.querySelector('.space-y-6').children].slice(0, 4);
            const titles = ['名称', '配音片段', '画面设置', '动作描述'].map(text =>
              [...panel.querySelectorAll('label, h3')].find(node => node.textContent.trim() === text));
            const gaps = modules.slice(1).map((node, index) =>
              Math.round(node.getBoundingClientRect().top - modules[index].getBoundingClientRect().bottom));
            return { gaps, sizes: titles.map(node => getComputedStyle(node).fontSize),
              weights: titles.map(node => getComputedStyle(node).fontWeight),
              disabled: [...panel.querySelectorAll('button')].find(button => button.textContent.trim() === '生成数字人片段')?.disabled,
              disabledOpacity: getComputedStyle([...panel.querySelectorAll('button')].find(button => button.textContent.trim() === '生成数字人片段')).opacity,
              image: Boolean(panel.querySelector('[aria-label="替换人物图片"] img')),
              saved: panel.textContent.includes('设置已保存'),
              noSubmit: !window.avatarProof.requests.some(request => request.action === 'submit') };
          })()`);
          ctx.assert(state.gaps.every(gap => gap === 24) && state.sizes.every(size => size === '13px')
            && state.weights.every(weight => weight === '600')
            && state.disabled && state.disabledOpacity === '1' && state.image && state.saved && state.noSubmit, JSON.stringify(state));
        },
        screenshot: { name: "avatar-waits-for-narration", requireText: ["当前视频没有配音素材", "保存设置", "生成数字人片段"] },
      });
    } },
    { name: "Generate from one bound clip", run: async ctx => {
      await ctx.prove("The avatar submission binds only its selected narration clip", {
        voiceover: "生成只使用当前数字人的配置和选中的配音片段；完成后可查看结果。",
        action: async () => {
          await ctx.clickText("切换视频配音", { selector: "button" });
          await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"配音片段\"]'))");
          await ctx.trustedClick('[aria-label="配音片段"]');
          await ctx.trustedClick('[data-slot="select-content"][data-open] [role="option"]:nth-child(2)');
          await ctx.waitFor("document.querySelector('[aria-label=\"配音片段\"]').textContent.includes('片段 1')");
          await ctx.clickText("生成数字人片段", { selector: "button" });
          await ctx.waitFor("window.avatarProof.requests.some(request => request.action === 'submit')");
          await ctx.waitFor("document.querySelector('[data-testid=avatar-task-dialog]')?.textContent.includes('预览数字人')");
        },
        assert: async () => {
          const result = await ctx.eval("(() => { const request = window.avatarProof.requests.find(request => request.action === 'submit'); const profile = window.avatarProof.profiles.find(item => item.name === '产品讲解人'); return { profile: request.args.avatarProfileId === profile.id, clip: request.args.avatarClipId === 'scene-one', revision: request.args.avatarProfileUpdatedAt === profile.updatedAt, preview: document.querySelector('[data-testid=avatar-task-dialog]')?.textContent.includes('预览数字人') }; })()");
          ctx.assert(result.profile && result.clip && result.revision && result.preview, JSON.stringify(result));
        },
        screenshot: { name: "avatar-selected-clip-result", requireText: ["预览数字人", "插入当前视频"] },
      });
    } },
    { name: "Changed narration marks its avatar stale", run: async ctx => {
      await ctx.prove("A changed audio clip marks only the linked result as needing update", {
        voiceover: "原配音片段发生变化时，这位数字人显示待更新，不会把旧视频误当作最新结果。",
        action: async () => {
          await ctx.clickText("数字人列表", { selector: "button" });
          await ctx.waitFor("document.querySelector('[data-testid=avatar-profile-card]')?.textContent.includes('已生成')");
          await ctx.clickText("更新配音片段", { selector: "button" });
          await ctx.waitFor("document.querySelector('[data-testid=avatar-profile-card]')?.textContent.includes('待更新')");
        },
        assert: async () => {
          const states = await ctx.eval("[...document.querySelectorAll('[data-testid=avatar-profile-card]')].map(card => card.textContent)");
          ctx.assert(states[0].includes("待更新") && states[1].includes("未生成"), JSON.stringify(states));
        },
        screenshot: { name: "one-avatar-needs-update", requireText: ["待更新", "未生成"] },
      });
    } },
    { name: "Missing narration points to voice setup on the right", run: async ctx => {
      await ctx.prove("The voice setup action sits to the right of the missing narration message", {
        voiceover: "没有配音时，去设置配音的入口放在提示右侧。保存设置仍可用，生成数字人片段要等配音就绪。",
        action: async () => {
          await ctx.client.send("Page.navigate", { url: `${origin}/tests/video-avatar-proof.html?panel=role&studioPort=5191&profiles=1` });
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=video-voice-panel]'))");
          await clickStudioButton(ctx, "数字人");
          await ctx.waitFor("document.querySelector('[data-testid=video-avatar-panel]')?.checkVisibility()");
          await ctx.clickText("创建数字人", { selector: "button" });
          await ctx.waitFor("document.querySelector('[data-testid=video-avatar-panel]')?.textContent.includes('去设置配音')");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid=video-avatar-panel]');
            const issue = panel.querySelector('[aria-label="绑定配音片段"] [role=status]');
            const link = [...panel.querySelectorAll('button')].find(button => button.textContent.trim() === '去设置配音');
            const save = [...panel.querySelectorAll('button')].find(button => button.textContent.trim() === '保存设置');
            const generate = [...panel.querySelectorAll('button')].find(button => button.textContent.trim() === '生成数字人片段');
            return { issue: issue?.textContent, linkOnRight: link.getBoundingClientRect().left >= issue.getBoundingClientRect().right,
              saveEnabled: !save.disabled, generateDisabled: generate.disabled };
          })()`);
          ctx.assert(state.issue.includes('当前视频没有配音素材') && state.linkOnRight
            && state.saveEnabled && state.generateDisabled, JSON.stringify(state));
        },
        screenshot: { name: "avatar-voice-setup-right", requireText: ["配音片段", "去设置配音", "保存设置"] },
      });
    } },
  ],
};
