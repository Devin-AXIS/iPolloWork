import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEnhancementCues, enhancementHtml, placeEnhancementCues } from "./video-enhancement-layout.js";
import { callVideoEnhancementAction } from "./video-enhancement.js";
import type { VideoEnhancementJob, VideoEnhancementResult } from "@ipollowork/types/video-enhancement";
import type { ServerConfig } from "../types.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const base = { duration: 8, width: 1280, height: 720, segments: [{ start: 1, end: 4, text: "今年增长了30%" }],
  people: [{ time: 1, boxes: [{ x: .45, y: .1, width: .5, height: .9 }] }, { time: 3, boxes: [{ x: .5, y: .1, width: .45, height: .9 }] }], warnings: [] };
test("quotes numeric evidence and keeps measured speech windows", () => {
  expect(buildEnhancementCues(base.segments, 8)).toEqual([{ id: "enhance-1", kind: "number", text: "30%", start: 1, end: 4, enabled: true }]);
  expect(buildEnhancementCues([{ start: 0, end: 7, text: "这是一段很长的讲话，不应该被截断成为意义不完整的断言或者新事实" }], 8)).toEqual([]);
  expect(buildEnhancementCues([{ start: 0, end: 2, text: "变化是-30%" }], 8)[0]?.text).toBe("-30%");
  const splitList = buildEnhancementCues([{ start: 0, end: 1, text: "第一" }, { start: 1, end: 3, text: "提高质量" }], 8);
  expect(splitList[0]).toMatchObject({ kind: "list", text: "第一，提高质量", start: 0, end: 3 });
});
test("uses the whole person movement window and skips occupied frames", () => {
  const cues = buildEnhancementCues(base.segments, 8);
  const [left] = placeEnhancementCues(cues, base);
  expect(left?.rect?.x).toBe(.04);
  const [skipped] = placeEnhancementCues(cues, { ...base, people: [...base.people, { time: 2, boxes: [{ x: 0, y: 0, width: 1, height: 1 }] }] });
  expect(skipped?.enabled).toBe(false); expect(skipped?.rect).toBeNull();
  expect(placeEnhancementCues(cues, { ...base, people: [] })[0]?.enabled).toBe(false);
  expect(() => placeEnhancementCues([{ ...cues[0]!, end: 9 }], base)).toThrow("超出");
  expect(() => placeEnhancementCues([...cues, { ...cues[0]!, id: "enhance-2", start: 2, end: 5 }], base)).toThrow("不能重叠");
});
test("generated composition contains local assets, editable clips and escaped transcript", () => {
  const cues = placeEnhancementCues([{ id: "enhance-1", kind: "keyword", text: "<img onerror=1>", start: 1, end: 4, enabled: true }], base);
  const html = enhancementHtml({ ...base, cues }, "enhancement/test/original.mp4");
  expect(html).toContain("&lt;img onerror=1&gt;");
  expect(html).not.toContain("<img onerror"); expect(html).not.toMatch(/https?:\/\//);
  expect(html).toContain('data-track-index="1"'); expect(html).toContain('data-volume="1"');
  expect(html).toContain('data-has-audio="true"');
  expect(html).toContain('src:local("Microsoft YaHei")');
  expect(html).toContain('window.__timelines["enhanced-video"]');
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipw-enhancement-test-")); roots.push(root);
  const jobId = randomUUID();
  const directory = join(root, "video", "proof", "enhancement", jobId);
  await mkdir(directory, { recursive: true }); await mkdir(join(root, "video/proof/assets"));
  const before = "<!doctype html><p>Original timeline</p>";
  await writeFile(join(root, "video/proof/index.html"), before);
  await writeFile(join(directory, "before.html"), before);
  await writeFile(join(directory, "original.mp4"), "local-video-fixture");
  const result: VideoEnhancementResult = { ...base, cues: placeEnhancementCues(buildEnhancementCues(base.segments, 8), base) };
  const job: VideoEnhancementJob = { id: jobId, sessionId: "proof", sourcePath: "video/proof/assets/source.mp4", status: "ready", progress: 100, message: "ready", createdAt: Date.now(), baseRevision: createHash("sha256").update(before).digest("hex"), result };
  await writeFile(join(directory, "job.json"), JSON.stringify(job));
  const config = { readOnly: false, workspaces: [{ id: "workspace", path: root }] } as ServerConfig;
  const context = { workspaceId: "workspace", sessionId: "proof" };
  const cues = result.cues.map(({ id, kind, text, start, end, enabled }) => ({ id, kind, text, start, end, enabled }));
  return { root, job, config, context, before, cues, args: { sessionId: "proof", jobId } };
}
test("rejects cross-session, unknown workspace and traversal before writing", async () => {
  const f = await fixture();
  await expect(callVideoEnhancementAction(f.config, "read", f.args, { ...f.context, sessionId: "other" })).rejects.toThrow("当前视频会话");
  await expect(callVideoEnhancementAction(f.config, "read", f.args, { ...f.context, workspaceId: "missing" })).rejects.toThrow("does not exist");
  await expect(callVideoEnhancementAction(f.config, "start", { sessionId: "../escape", sourcePath: "x" }, f.context)).rejects.toThrow();
  expect(await readFile(join(f.root, "video/proof/index.html"), "utf8")).toBe(f.before);
});
test("apply preserves original, is idempotent, and undo restores exact timeline", async () => {
  const f = await fixture();
  const output = await callVideoEnhancementAction(f.config, "apply", { ...f.args, cues: f.cues }, f.context);
  expect(output.result).toHaveProperty("status", "applied");
  const html = await readFile(join(f.root, "video/proof/index.html"), "utf8");
  expect(html).toContain("30%");
  await callVideoEnhancementAction(f.config, "apply", { ...f.args, cues: f.cues }, f.context);
  expect(await readFile(join(f.root, "video/proof/index.html"), "utf8")).toBe(html);
  await callVideoEnhancementAction(f.config, "undo", f.args, f.context);
  expect(await readFile(join(f.root, "video/proof/index.html"), "utf8")).toBe(f.before);
});
test("never overwrites intervening timeline edits or writes in read-only mode", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "video/proof/index.html"), "edited");
  await expect(callVideoEnhancementAction(f.config, "apply", { ...f.args, cues: f.cues }, f.context)).rejects.toThrow("时间轴已更改");
  await expect(callVideoEnhancementAction({ ...f.config, readOnly: true }, "apply", { ...f.args, cues: f.cues }, f.context)).rejects.toThrow("只读");
  expect(await readFile(join(f.root, "video/proof/index.html"), "utf8")).toBe("edited");
});
test("rejects duplicate IDs, unsafe timing and missing analyzed media", async () => {
  const f = await fixture();
  await expect(callVideoEnhancementAction(f.config, "apply", { ...f.args, cues: [...f.cues, ...f.cues] }, f.context)).rejects.toThrow("重复");
  await expect(callVideoEnhancementAction(f.config, "apply", { ...f.args, cues: f.cues.map(cue => ({ ...cue, end: 9 })) }, f.context)).rejects.toThrow("超出");
  await rm(join(f.root, "video/proof/enhancement", f.job.id, "original.mp4"));
  await expect(callVideoEnhancementAction(f.config, "apply", { ...f.args, cues: f.cues }, f.context)).rejects.toThrow();
  expect(await readFile(join(f.root, "video/proof/index.html"), "utf8")).toBe(f.before);
});
