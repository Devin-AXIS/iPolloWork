import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inspectNarrationDuration, mixAvatarNarration, inspectLocalVideo, localVideoEditSchema, localVideoFilters, saveLocalVideo } from "./video-local-edit.js";
import { listSessionArtifacts } from "../session-artifacts.js";
import type { ServerConfig } from "../types.js";
const exec = promisify(execFile);
const roots: string[] = [];
test("transparent avatar WebM keeps its alpha channel after editing", async () => {
  const { root, config, workspace, edit } = await fixture();
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
  await exec(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=green:s=64x64:r=10:d=1", "-vf", "format=rgba,colorkey=0x008000:0.1:0.1", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-threads", "1", join(root, "person.webm")], { windowsHide: true });
  const info = await inspectLocalVideo(workspace, "person.webm");
  const saved = await saveLocalVideo(config, workspace, "session", { ...edit, path: "person.webm", revision: info.revision, start: 0, end: .5, rotation: 0, speed: 1, crop: { x: 0, y: 0, width: 1, height: 1 } });
  const alpha = await exec(ffmpeg, ["-v", "error", "-c:v", "libvpx-vp9", "-i", join(root, saved.path), "-vf", "alphaextract", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { encoding: "buffer", windowsHide: true });
  expect(alpha.stdout.length).toBe(64 * 64);
  expect(Math.max(...alpha.stdout)).toBeLessThan(10);
});
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-local-video-test-")); roots.push(root);
  const workspace = { id: "test", name: "Test", path: root, preset: "starter", workspaceType: "local" } satisfies ServerConfig["workspaces"][number];
  const config: ServerConfig = { host:"127.0.0.1",port:0,token:"test",hostToken:"test",configPath:join(root,"server.json"),approval:{mode:"auto",timeoutMs:0},corsOrigins:[],workspaces:[workspace],authorizedRoots:[root],readOnly:false,startedAt:Date.now(),tokenSource:"generated",hostTokenSource:"generated",logFormat:"pretty",logRequests:false };
  await exec(process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:s=320x240:r=24:d=4", "-f", "lavfi", "-i", "sine=frequency=400:duration=4", "-vf", "drawbox=x=160:y=0:w=160:h=240:color=blue:t=fill", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", join(root,"source.mp4")], {windowsHide:true});
  const info = await inspectLocalVideo(workspace, "source.mp4");
  const edit = { requestId:randomUUID(),path:"source.mp4",revision:info.revision,mode:"copy",start:1,end:3,rotation:90,flip:false,speed:2,volume:0,crop:{x:0,y:0,width:.5,height:1} };
  return {root,config,workspace,edit};
}
test("rejects invalid edits before processing", () => {
  const valid={requestId:randomUUID(),path:"a.mp4",revision:"a".repeat(64),mode:"copy",start:0,end:2,rotation:0,flip:false,speed:1,volume:1,crop:{x:0,y:0,width:1,height:1}};
  for (const patch of [{end:0},{speed:0},{rotation:45},{volume:2},{crop:{x:.8,y:0,width:.5,height:1}},{extra:"-i https://host"}]) expect(localVideoEditSchema.safeParse({...valid,...patch}).success).toBe(false);
  expect(localVideoFilters(localVideoEditSchema.parse(valid)).video).toContain("setpts=(PTS-STARTPTS)/1");
});
test("real local render crops, rotates, trims, changes speed, removes audio and saves a distinct copy", async () => {
  const {root,config,workspace,edit}=await fixture(); const original=await readFile(join(root,"source.mp4"));
  const saved=await saveLocalVideo(config,workspace,"session",edit);
  expect(saved.path).toMatch(/^source-edited-.*\.mp4$/);expect(saved.saveMode).toBe("copy");
  expect(await readFile(join(root,"source.mp4"))).toEqual(original);
  const info=await inspectLocalVideo(workspace,saved.path);
  expect(info.width).toBe(240);expect(info.height).toBe(160);expect(info.duration).toBeCloseTo(1,1);expect(info.hasAudio).toBe(false);
  const pixels=await exec(process.env.HYPERFRAMES_FFMPEG_PATH||"ffmpeg",["-v","error","-i",join(root,saved.path),"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{encoding:"buffer",windowsHide:true,maxBuffer:1000000});
  expect(pixels.stdout[0]).toBeGreaterThan(240);expect(pixels.stdout[2]).toBeLessThan(15);
  expect((await saveLocalVideo(config,workspace,"session",edit)).path).toBe(saved.path);
  expect((await listSessionArtifacts(config,workspace.id,"session")).items).toHaveLength(2);
  expect((await readdir(root)).some(name=>name.includes(".partial"))).toBe(false);
},30000);

test("flip, slow motion and volume persist in real output; processing errors leave the source untouched", async()=>{
  const {root,config,workspace,edit}=await fixture();
  const original=await readFile(join(root,edit.path));
  const options={...edit,start:0,end:2,rotation:0,flip:true,speed:.5,volume:.5,crop:{x:0,y:0,width:1,height:1}};
  const saved=await saveLocalVideo(config,workspace,"session",options);
  const info=await inspectLocalVideo(workspace,saved.path);
  expect(info.duration).toBeCloseTo(4,1);expect(info.hasAudio).toBe(true);
  const pixels=await exec(process.env.HYPERFRAMES_FFMPEG_PATH||"ffmpeg",["-v","error","-i",join(root,saved.path),"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{encoding:"buffer",windowsHide:true,maxBuffer:1000000});
  expect(pixels.stdout[0]).toBeLessThan(15);expect(pixels.stdout[2]).toBeGreaterThan(240);
  const rms=async(path:string)=>{
    const output=await exec(process.env.HYPERFRAMES_FFMPEG_PATH||"ffmpeg",["-v","error","-i",join(root,path),"-t","1","-vn","-ac","1","-ar","8000","-f","f32le","pipe:1"],{encoding:"buffer",windowsHide:true,maxBuffer:100000});
    let squares=0;for(let i=0;i<output.stdout.length;i+=4)squares+=output.stdout.readFloatLE(i)**2;
    return Math.sqrt(squares/(output.stdout.length/4));
  };
  const volumeRatio=await rms(saved.path)/await rms(edit.path);expect(volumeRatio).toBeGreaterThan(.4);expect(volumeRatio).toBeLessThan(.6);
  await expect(saveLocalVideo(config,workspace,"session",{...options,mode:"overwrite"})).rejects.toThrow("请求已变化");
  await expect(saveLocalVideo(config,workspace,"session",{...edit,requestId:randomUUID(),end:5,mode:"overwrite"})).rejects.toThrow("超出");
  const ffmpeg=process.env.HYPERFRAMES_FFMPEG_PATH;
  try{
    process.env.HYPERFRAMES_FFMPEG_PATH=join(root,"missing-ffmpeg");
    await expect(saveLocalVideo(config,workspace,"session",{...edit,requestId:randomUUID(),mode:"overwrite"})).rejects.toThrow("FFmpeg");
  }finally{if(ffmpeg)process.env.HYPERFRAMES_FFMPEG_PATH=ffmpeg;else delete process.env.HYPERFRAMES_FFMPEG_PATH;}
  expect(await readFile(join(root,edit.path))).toEqual(original);
  expect((await readdir(root)).some(name=>name.includes(".partial"))).toBe(false);
},30000);
test("overwrite changes the same file, is retry-safe and rejects stale or read-only edits",async()=>{
  const {config,workspace,edit}=await fixture();const overwrite={...edit,mode:"overwrite"};
  await expect(saveLocalVideo({...config,readOnly:true},workspace,"session",overwrite)).rejects.toThrow("只读");
  await expect(saveLocalVideo(config,workspace,"session",{...overwrite,revision:"0".repeat(64)})).rejects.toThrow("发生变化");
  await expect(saveLocalVideo(config,workspace,"session",{...overwrite,path:"../escape.mp4"})).rejects.toThrow("工作区");
  const saved=await saveLocalVideo(config,workspace,"session",overwrite);expect(saved.path).toBe("source.mp4");expect(saved.revision).not.toBe(edit.revision);
  expect(await saveLocalVideo(config,workspace,"session",overwrite)).toEqual(saved);
  expect((await listSessionArtifacts(config,workspace.id,"session")).items).toHaveLength(1);
  await expect(saveLocalVideo(config,workspace,"session",{...overwrite,requestId:randomUUID()})).rejects.toThrow("发生变化");
  await writeFile(join(workspace.path,"source.mp4"),"changed");
  await expect(saveLocalVideo(config,workspace,"session",overwrite)).rejects.toThrow("发生了变化");
},30000);

test("avatar narration mixing preserves gaps, offsets and exact output duration", async()=>{
  const {root,workspace}=await fixture();
  await exec(process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg", ["-v","error","-f","lavfi","-i","sine=frequency=400:duration=5","-ac","2","-c:a","pcm_s16le",join(root,"voice.wav")],{windowsHide:true});
  await mixAvatarNarration(workspace,[{path:"voice.wav",start:0,duration:2,offset:1,volume:1},{path:"voice.wav",start:3,duration:1.2,offset:0,volume:.5}],"mixed.wav",4.2);
  expect(await inspectNarrationDuration(workspace,"mixed.wav")).toBeCloseTo(4.2,2);
  const raw=await exec(process.env.HYPERFRAMES_FFMPEG_PATH||"ffmpeg",["-v","error","-i",join(root,"mixed.wav"),"-ss","2.1","-t","0.5","-ac","1","-f","s16le","pipe:1"],{encoding:"buffer",windowsHide:true});
  expect(raw.stdout.every(byte=>byte===0)).toBe(true);
  const rms = async (path: string, start: number) => {
    const { stdout } = await exec(process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg", ["-v","error","-i",join(root,path),"-ss",String(start),"-t","0.5","-ac","1","-ar","24000","-f","f32le","pipe:1"], { encoding:"buffer", windowsHide:true });
    let squares = 0;
    for (let i = 0; i < stdout.length; i += 4) squares += stdout.readFloatLE(i) ** 2;
    return Math.sqrt(squares / (stdout.length / 4));
  };
  const sourceLevel = await rms("voice.wav", 1.2);
  expect(await rms("mixed.wav", .2) / sourceLevel).toBeCloseTo(1, 2);
  expect(await rms("mixed.wav", 3.2) / sourceLevel).toBeCloseTo(.5, 2);
});
