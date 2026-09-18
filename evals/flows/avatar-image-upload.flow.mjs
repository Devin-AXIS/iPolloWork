// Set IPOLLOWORK_AVATAR_TEST_IMAGE to a valid PNG/JPG/WebP larger than 5 MB.
// Open apps/app/tests/video-avatar-proof.html in the app dev server first.
async function chooseImage(ctx) {
  const { root } = await ctx.client.send("DOM.getDocument");
  const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="video-avatar-panel"] input[type="file"]' });
  ctx.assert(nodeId, "Image picker exists");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [process.env.IPOLLOWORK_AVATAR_TEST_IMAGE] });
}

export default {
  id: "avatar-image-upload",
  title: "Avatar image preview, multipart upload and retry (simulated server)",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "video-avatar-proof.html" },
  preserveTheme: true,
  steps: [{ name: "Upload and retry an avatar reference", run: async ctx => {
    ctx.assert(Boolean(process.env.IPOLLOWORK_AVATAR_TEST_IMAGE), "Provide a local test image");
    await ctx.client.send("Page.reload");
    await ctx.waitFor("Boolean(document.querySelector('[role=tab]'))");
    await ctx.clickText("数字人视频", { selector: "[role=tab]" });
    await ctx.clickText("切换 Key 配置", { selector: "button" });
    await ctx.prove("A reference larger than 5 MB previews before upload completes", {
      voiceover: "选择人物图片后立即看到预览和上传状态，上传完成后显示确认提示。",
      action: async () => {
        await chooseImage(ctx);
        await ctx.waitFor("document.querySelector('[data-testid=video-avatar-panel] img')?.naturalWidth > 0 && document.body.innerText.includes('正在上传图片…')");
        await ctx.waitForText("图片已上传");
      },
      assert: async () => {
        ctx.assert(await ctx.eval("window.avatarProof.requests.some(r => r.action === 'upload' && r.size > 5000000 && r.path.startsWith('video/avatar-proof/assets/'))"), "Image uses multipart upload beyond the old binary limit");
        ctx.assert(await ctx.eval("document.querySelector('[data-testid=video-avatar-panel] img')?.naturalWidth > 0"), "Preview decodes successfully");
        await ctx.expectText("音效");
        ctx.assert(await ctx.eval("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '生成数字人')"), "Generate button has the requested exact name");
        ctx.assert(await ctx.eval("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '生成数字人')?.disabled === false"), "Successfully uploaded reference enables generation");
      },
      screenshot: { name: "avatar-image-uploaded", requireText: ["图片已上传", "生成数字人", "音效"] },
    });
    await ctx.prove("Upload errors appear beside the image and the same file can be retried", {
      voiceover: "上传失败时图片下方会提示原因，重新选择同一张图片即可重试。",
      action: async () => {
        await ctx.clickText("切换上传失败", { selector: "button" });
        await chooseImage(ctx);
        await ctx.waitForText("图片上传失败");
        ctx.assert(await ctx.eval("document.querySelector('[data-testid=video-avatar-panel] img')?.naturalWidth > 0"), "Failed upload retains a visible local preview");
      },
      assert: async () => {
        ctx.assert(await ctx.eval("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '生成数字人')?.disabled"), "Failed reference cannot be submitted");
      },
      screenshot: { name: "avatar-upload-error", requireText: ["图片上传失败", "模拟上传失败"] },
    });
    await ctx.clickText("切换上传失败", { selector: "button" });
    await chooseImage(ctx);
    await ctx.waitForText("图片已上传");
    ctx.assert(await ctx.eval("window.avatarProof.requests.filter(r => r.action === 'upload').length === 3"), "The same file uploads again after failure");
  } }],
};
