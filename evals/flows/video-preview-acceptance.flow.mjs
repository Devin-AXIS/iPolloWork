import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

const execute = promisify(execFile);
export default {
  id: "video-preview-acceptance", title: "Studio runtime validation without MP4 export", kind: "internal", requiresApp: false,
  requiredEnv: ["IPOLLOWORK_EVAL_STUDIO_API", "IPOLLOWORK_EVAL_VIDEO_PROJECT", "IPOLLOWORK_EVAL_WORKSPACE_ROOT"],
  steps: [{ name: "Real Studio checks and export side effects", async run(ctx) {
    const repo = resolve(import.meta.dirname, "../.."), witness = join(ctx.outDir, "preview-witness.json");
    await ctx.prove("真实 Studio 验收检查动作时间和反向拖动，验证过程没有 MP4 或渲染任务", {
      voiceover: "验收直接检查现有 Studio 时间轴。正常动作通过，时间错误仍被发现，全程不生成审片视频或 MP4；声音和表达仍需实际播放校对。",
      action: async () => {
        const script = `
          import{readFile,writeFile,readdir}from'node:fs/promises';import{join}from'node:path';
          import{videoPreviewCheck,videoRenderAction}from ${JSON.stringify(pathToFileURL(join(repo, "apps/server/src/extensions/video-render.ts")).href)};
          const workspace={id:'preview-proof',path:${JSON.stringify(ctx.env.IPOLLOWORK_EVAL_WORKSPACE_ROOT)}};
          const sourcePath='video/'+${JSON.stringify(ctx.env.IPOLLOWORK_EVAL_VIDEO_PROJECT)}+'/index.html',directory=join(workspace.path,sourcePath,'..');
          const api=${JSON.stringify(ctx.env.IPOLLOWORK_EVAL_STUDIO_API)},calls=[];
          const proxy=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){const url=new URL(request.url);calls.push({method:request.method,path:url.pathname+url.search});if(url.pathname.endsWith('/render'))return new Response('Unexpected export',{status:500});return fetch(new URL(url.pathname+url.search,new URL(api).origin));}});
          const bridge=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json({ok:true,port:proxy.port});}});
          const discovery=join(workspace.path,'preview-bridge.json');await writeFile(discovery,JSON.stringify({baseUrl:'http://127.0.0.1:'+bridge.port,token:'isolated-proof'}));process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY=discovery;
          const path=join(workspace.path,sourcePath),original=await readFile(path,'utf8');
          try{
            const valid=await videoPreviewCheck(workspace,{sourcePath});
            const current=await readFile(path,'utf8');if(!current.includes('"end":1.5'))throw new Error('Expected isolated proof motion');
            await writeFile(path,current.replace('"end":1.5','"end":2.5'));
            const invalid=await videoRenderAction(workspace,'video_render_start',{sourcePath,operationKey:'legacy-review',reviewOnly:true});
            const files=await readdir(directory,{recursive:true});
            await writeFile(${JSON.stringify(witness)},JSON.stringify({valid,invalid,calls,exportFiles:files.filter(name=>/\\.mp4$|\\.export-/i.test(name))},null,2));
          }finally{await writeFile(path,original);proxy.stop(true);bridge.stop(true);}
        `;
        const result = await execute(process.env.BUN_BINARY || "bun", ["--eval", script], { cwd: repo, timeout: 120000, maxBuffer: 1024 * 1024 });
        if (result.stdout || result.stderr) ctx.output("Native Studio output", result.stdout + result.stderr);
      }, assert: async () => {
        const state = JSON.parse(await readFile(witness, "utf8"));
        ctx.output("Real Studio validation and filesystem witness", JSON.stringify(state, null, 2));
        ctx.assert(state.valid.status === "complete" && state.valid.previewReview.valid, "Actual executed timing/layout passed");
        ctx.assert(state.valid.previewReview.deterministicSeek.valid, "Direct/reverse seeking was actually checked");
        ctx.assert(state.invalid.status === "failed" && state.invalid.previewReview.issues.some(issue => issue.code.includes("end-mismatch")), "Legacy validation detects real executed timing mismatch");
        ctx.assert(state.valid.playback === "unverified", "Technical inspection does not claim unheard/unwatched approval");
        ctx.assert(state.calls.every(call => call.method === "GET" && call.path.endsWith("?review=runtime")), "Only runtime inspection requests reached Studio");
        ctx.assert(state.exportFiles.length === 0 && !state.valid.outputPath && !state.invalid.outputPath, "No MP4 or export receipt was created");
      },
    });
  } }],
};
