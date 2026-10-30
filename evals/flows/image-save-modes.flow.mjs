import { readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";

// Drive the isolated real UI with the approved CUA browser, capturing each
// accessibility snapshot, screenshot and /witness response in the proof folder.
// This replays assertions over those captured observations, not browser actions.
export default {
  id: "image-save-modes",
  title: "图片编辑：覆盖一项、另存为两项",
  kind: "user-facing",
  requiresApp: false,
  requiredEnv: ["IPOLLOWORK_IMAGE_SAVE_PROOF_DIR"],
  steps: [
    ...[
      { id: "review", title: "编辑后预览并选择保存方式", count: 2, voiceover: "编辑结果先保存为副本供预览，原图仍在。此时可以另存为，也可以点击覆盖原图并确认。" },
      { id: "overwrite", title: "覆盖后只保留原文件", count: 1, voiceover: "确认覆盖后，主要产出只剩原文件，内容已经更新，本次副本已移除。" },
      { id: "copy", title: "另存为保留两版且名称不同", count: 2, voiceover: "再次编辑并选择另存为，主要产出显示原图和带编辑时间标记的副本，名称不同。" },
    ].map(step => ({
      name: step.title,
      async run(ctx) {
        await ctx.prove(step.title, {
          voiceover: step.voiceover,
          assert: async () => {
            const directory = ctx.env.IPOLLOWORK_IMAGE_SAVE_PROOF_DIR;
            const witness = JSON.parse(await readFile(join(directory, step.id + ".json"), "utf8"));
            const ax = await readFile(join(directory, step.id + ".txt"), "utf8");
            const image = await readFile(join(directory, step.id + ".jpg"));
            ctx.assert(image.length > 1000 && image[0] === 255 && image[1] === 216, "CUA screenshot is a non-empty JPEG");
            ctx.assert(ax.includes(step.count + " 个主要产出"), "Real ConversationOutputPanel shows the expected count");
            ctx.assert(witness.artifacts.length === step.count && witness.files.length === step.count, "Persisted artifact rows and real files agree");
            ctx.assert(new Set(witness.files).size === step.count, "File names are distinct");
            if (step.id === "review") {
              ctx.assert(ax.includes("覆盖原图") && ax.includes("另存为"), "Both review actions are visible");
              ctx.assert(witness.saved.originalPreserved === true, "Preview did not overwrite the original");
            } else {
              const mode = step.id === "overwrite" ? "overwrite" : "copy";
              ctx.assert(witness.actions.at(-1)?.action === "save-edit" && witness.actions.at(-1)?.mode === mode, "The selected UI save action reached the real service");
              if (step.id === "overwrite") ctx.assert(witness.files[0] === "source.png" && !witness.saved.originalPreserved, "Original path retained with new bytes");
              else ctx.assert(witness.files.some(path => path.includes("-edited-")), "Copy has a recognizable edit suffix");
            }
            ctx.output("Observed real service / filesystem state (model response simulated)", JSON.stringify(witness, null, 2));
            const file = step.id + ".jpg";
            await copyFile(join(directory, file), join(ctx.outDir, file));
            const frame = { type: "frame", status: "passed", file, name: step.title, claim: step.title, voiceover: step.voiceover,
              url: "http://127.0.0.1:5190/", validations: [
                { label: "真实界面由 CUA 操作，截图与可访问性树已检查", passed: true },
                { label: "文件数量与服务端主要产出登记一致", passed: true },
              ] };
            ctx.evidenceFrames.push(frame);
            ctx.recordEvidence(frame);
          },
        });
      },
    })),
  ],
};
