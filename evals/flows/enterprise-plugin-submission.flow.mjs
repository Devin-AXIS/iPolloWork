import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requireFromApp = createRequire(new URL("../../apps/app/package.json", import.meta.url));
const JSZip = requireFromApp("jszip");
const dialog = '[data-testid="enterprise-resource-management"]';
const submitButton = `${dialog} input[type="file"] ~ button:last-child`;

export default {
  id: "enterprise-plugin-submission",
  title: "普通员工投稿企业插件（隔离企业传输）",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [{ name: "员工上传插件并等待审核", async run(ctx) {
    await ctx.client.send("Page.reload");
    await ctx.waitForText("企业协作功能验证");
    await ctx.trustedClick('[data-testid="proof-member"]');
    const directory = await mkdtemp(join(tmpdir(), "ipollowork-plugin-submission-"));
    const packagePath = join(directory, "plugin-workshop.ipollowork-plugin");
    try {
      const archive = new JSZip();
      for (const path of ["ipollowork.plugin.json", "skills/plugin-workshop/SKILL.md"]) {
        archive.file(path, await readFile(new URL(`../../examples/plugin-packages/plugin-workshop/${path}`, import.meta.url)));
      }
      await writeFile(packagePath, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      await ctx.prove("普通员工可投稿插件并查看待审核结果，没有资源管理权限", {
        voiceover: "员工打开我的插件投稿，选择插件包并提交，随后可以查看待审核状态；审核和权限分配仍由管理员处理。",
        action: async () => {
          ctx.assert(await ctx.eval('Boolean(document.querySelector(\'[data-testid="enterprise-extension-manage"]\'))'), "employee plugin submission entry is visible");
          await ctx.trustedClick('[data-testid="enterprise-extension-manage"]');
          await ctx.waitForText("我的插件投稿");
          await ctx.waitFor(`Boolean(document.querySelector('${dialog} input[type="file"]'))`);
          const document = await ctx.client.send("DOM.getDocument");
          const input = await ctx.client.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: `${dialog} input[type="file"]` });
          await ctx.client.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [packagePath] });
          await ctx.waitForText("plugin-workshop.ipollowork-plugin");
          // Fail only the isolated enterprise transport, preserving the real form and request client.
          await ctx.eval(`(() => {
            const original = window.fetch;
            window.fetch = async (input, init) => {
              if (String(input).endsWith('/extension-submissions') && init?.method === 'POST') {
                window.fetch = original;
                return Response.json({ error: 'temporary_unavailable' }, { status: 503 });
              }
              return original(input, init);
            };
          })()`);
          await ctx.trustedClick(submitButton);
          await ctx.waitFor(`Boolean(document.querySelector('${dialog} [role="alert"]'))`);
          await ctx.expectText("plugin-workshop.ipollowork-plugin");
          ctx.assert(await ctx.eval(`document.querySelector('${dialog} input[type="file"]').files.length === 1`), "failed upload retains the selected file for retry");
          await ctx.trustedClick(submitButton);
          await ctx.waitForText("投稿已提交，可在我的投稿中查看审核状态。");
        },
        assert: async () => {
          await ctx.expectText("我的企业插件 · v1.0.0");
          await ctx.expectText("待审核");
          await ctx.expectNoText("全部企业插件");
          await ctx.expectNoText("分配权限");
          ctx.assert(await ctx.eval(`!Array.from(document.querySelectorAll('${dialog} button')).some(button => ['审核', '通过并发布', '下架'].includes(button.textContent.trim()))`), "employee has no review, publish or archive controls");
          ctx.assert(await ctx.eval(`document.querySelectorAll('${dialog} article').length === 1`), "retry displays exactly one pending submission from the isolated enterprise service");
        },
        screenshot: { name: "employee-plugin-pending", requireText: ["我的插件投稿", "我的企业插件", "待审核", "投稿已提交"], rejectText: ["全部企业插件", "分配权限"] },
      });
    } finally {
      await unlink(packagePath).catch(() => undefined);
      await rmdir(directory);
    }
  } }],
};
