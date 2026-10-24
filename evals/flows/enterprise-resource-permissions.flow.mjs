const dialog = '[data-testid="enterprise-resource-management"]';
const access = '[data-testid="enterprise-resource-access"]';
const types = [["template", "模板"], ["extension", "插件"], ["skill", "技能"]];

async function counts(ctx) {
  await ctx.eval(`document.querySelector('[data-testid="proof-stats"]').click(); true`);
  return ctx.eval(`(() => {
    const stats = document.querySelector('[data-testid="proof-result"]');
    return { requests: Number(stats.dataset.managementRequests), writes: Number(stats.dataset.managementWrites) };
  })()`);
}

async function expectMember(ctx) {
  await ctx.waitFor(`['template','extension','skill'].every((type, index) =>
    document.querySelector('[data-testid="enterprise-' + type + '-manage"]')?.textContent.includes(['我的模板投稿','我的插件投稿','我的技能投稿'][index]))`);
  await ctx.waitFor("!document.body.innerText.includes('分配资源权限') && !document.body.innerText.includes('通过并发布')");
  await ctx.expectNoText("分配资源权限");
  await ctx.expectNoText("通过并发布");
}

async function close(ctx) {
  await ctx.trustedClick(`${dialog} [data-slot="dialog-close"]`);
  await ctx.waitFor(`!document.querySelector('${dialog}')`);
}

export default {
  id: "enterprise-resource-permissions",
  title: "成员仅投稿，三类管理员分别审核对应资源（隔离企业服务）",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [{ name: "管理入口和已打开的管理操作重新校验角色", async run(ctx) {
    await ctx.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await ctx.client.send("Page.reload");
    await ctx.waitForText("企业协作功能验证");
    await ctx.prove("管理员在后台降为成员后，三类资源只能投稿，旧弹窗也不能继续管理", {
      voiceover: "后台把管理员降为成员后，再打开模板、插件或技能时只显示自己的投稿；已经打开的授权、审核和下架操作也会重新检查权限并停止。",
      action: async () => {
        for (const [type, label] of types) {
          await ctx.trustedClick('[data-testid="proof-owner"]');
          const entry = `[data-testid="enterprise-${type}-manage"]`;
          await ctx.waitFor(`document.querySelector('${entry}')?.textContent.includes('${label}管理')`);
          const before = await counts(ctx);
          // Changes only the isolated service role, leaving the cached administrator untouched.
          await ctx.eval(`document.querySelector('[data-testid="proof-demote-member"]').click()`);
          await ctx.trustedClick(entry);
          await ctx.waitFor(`Boolean(document.querySelector('${dialog}'))`);
          await expectMember(ctx);
          ctx.assert((await counts(ctx)).requests === before.requests, `${label} opens submissions without requesting the management catalog`);
          await close(ctx);
        }
        for (const [type, label] of types) {
          await ctx.trustedClick('[data-testid="proof-owner"]');
          const entry = `[data-testid="enterprise-${type}-manage"]`;
          await ctx.waitFor(`document.querySelector('${entry}')?.textContent.includes('${label}管理')`);
          await ctx.trustedClick(entry);
          await ctx.waitFor(`document.querySelectorAll('${dialog} article').length === 2`);
          if (type === "template") {
            await ctx.trustedClick(`${dialog} article:first-child button:first-of-type`);
            await ctx.waitFor(`Boolean(document.querySelector('${access} [aria-label="访问范围"]'))`);
          } else if (type === "extension") {
            await ctx.trustedClick(`${dialog} article:last-child button:last-child`);
            await ctx.waitForText("通过并发布");
          }
          const before = await counts(ctx);
          await ctx.eval(`document.querySelector('[data-testid="proof-demote-member"]').click()`);
          if (type === "template") await ctx.clickText("保存并下发");
          else if (type === "extension") await ctx.clickText("通过并发布");
          else await ctx.trustedClick(`${dialog} article:first-child button:last-child`);
          await expectMember(ctx);
          const after = await counts(ctx);
          ctx.assert(after.requests === before.requests && after.writes === before.writes, `Stale ${label} management operation sends no privileged request after demotion`);
          if (type !== "skill") await close(ctx);
        }
      },
      assert: async () => {
        await expectMember(ctx);
        await ctx.expectText("我的技能投稿");
        await ctx.expectNoText("全部企业技能");
        ctx.assert(await ctx.eval(`!document.querySelector('${dialog} [data-slot=file-upload] button').disabled`), "Member submission remains available");
        ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "All three stale management entries and open grant/review/archive dialogs recheck the service role; no privileged request is sent after demotion" });
        await close(ctx);
      },
      screenshot: { name: "member-submissions-only", requireText: ["我的模板投稿", "我的插件投稿", "我的技能投稿"], rejectText: ["分配资源权限", "通过并发布", "全部企业技能"] },
    });
  } }, { name: "成员和三类专管只显示各自有权使用的控件", async run(ctx) {
    for (const [role, managedType, roleLabel] of [
      ["template_admin", "template", "模板管理员"],
      ["extension_admin", "extension", "插件管理员"],
      ["skill_admin", "skill", "技能管理员"],
      ["member", null, "普通成员"],
    ]) {
      await ctx.prove(`${roleLabel}${managedType ? "只能审核对应类型，其他类型仅可投稿" : "只能投稿，看不到审核和管理控件"}`, {
        voiceover: managedType ? `${roleLabel}只在负责的资源中看到审核、授权和下架，其他资源保留自己的投稿入口。` : "普通成员可以投稿模板、插件和技能，界面不显示审核、授权或下架控件。",
        action: async () => {
          await ctx.trustedClick('[data-testid="proof-owner"]');
          await ctx.trustedClick(`[data-testid="proof-${role}"]`);
          for (const [type, label] of types) {
            const entry = `[data-testid="enterprise-${type}-manage"]`;
            const allowed = type === managedType;
            await ctx.waitFor(`document.querySelector('${entry}')?.textContent.includes('${allowed ? `${label}管理` : `我的${label}投稿`}')`);
            await ctx.trustedClick(entry);
            await ctx.waitFor(`Boolean(document.querySelector('${dialog}'))`);
            if (allowed) {
              await ctx.waitFor(`document.querySelectorAll('${dialog} article').length === 2`);
              ctx.assert(await ctx.eval(`['审核','分配权限','下架'].every(text => [...document.querySelectorAll('${dialog} button')].some(button => button.textContent === text))`), `${roleLabel} sees its assigned review, grant and archive controls`);
              await ctx.trustedClick(`${dialog} article:last-child button:last-child`);
              await ctx.waitForText("审核企业投稿");
              await ctx.expectText("通过并发布");
              await ctx.clickText('返回资源列表');
              await ctx.waitFor(`!document.body.innerText.includes('通过并发布')`);
            } else {
              await ctx.waitFor(`!document.querySelector('${dialog} [role="status"]')`);
              ctx.assert(await ctx.eval(`!document.querySelector('${entry} .lucide-shield-check')`), "Submission entry has no review icon");
              ctx.assert(await ctx.eval(`!['审核','分配权限','下架'].some(text => [...document.querySelectorAll('${dialog} button')].some(button => button.textContent === text))`), `${roleLabel} has no management controls for ${label}`);
              ctx.assert(await ctx.eval(`Boolean(document.querySelector('${dialog} input[type="file"]')) && !document.querySelector('${dialog} [data-slot=file-upload] button').disabled`), `${label} submission remains available`);
            }
            await close(ctx);
          }
          const previewType = managedType ?? "skill";
          await ctx.trustedClick(`[data-testid="enterprise-${previewType}-manage"]`);
          await ctx.waitFor(`Boolean(document.querySelector('${dialog}')) && !document.querySelector('${dialog} [role="status"]')`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`['template','extension','skill'].every(type => {
            const entry = document.querySelector('[data-testid="enterprise-' + type + '-manage"]');
            return Boolean(entry.querySelector('.lucide-shield-check')) === (type === ${JSON.stringify(managedType)});
          })`), "Only the assigned resource entry displays the management icon");
          await ctx.expectNoText("通过并发布");
          if (!managedType) await expectMember(ctx);
        },
        screenshot: { name: `role-${role}`, requireText: [managedType ? `企业${types.find(([type]) => type === managedType)[1]}管理` : "我的技能投稿"], rejectText: ["通过并发布", "分配资源权限"] },
      });
      await close(ctx);
    }
  } }],
};
