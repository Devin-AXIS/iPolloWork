// plugins/short-video-studio/business/src/service.mjs
import { readFile as readFile2, writeFile as writeFile2, open, lstat as lstat2, mkdir as mkdir2, rename as rename2 } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";

// plugins/short-video-studio/business/src/file-store.mjs
import { mkdir, readFile, writeFile, rename, readdir, lstat, realpath, copyFile, unlink } from "node:fs/promises";
import { join, resolve, dirname, sep } from "node:path";
import { randomUUID } from "node:crypto";

// plugins/short-video-studio/business/src/native-video.mjs
var kinds = /* @__PURE__ */ new Set(["video", "image", "audio", "caption"]);
var escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[char]);
var seconds = (value) => String(Number(value.toFixed(9)));
function fail(message) {
  throw new Error(message);
}
function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(value)) fail(`${label} \u65E0\u6548`);
}
function text(value, label, maximum = 1e3) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`${label} \u65E0\u6548`);
}
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} \u8D85\u51FA\u8303\u56F4`);
}
function number(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} \u8D85\u51FA\u8303\u56F4`);
}
function assetPath(value, kind) {
  if (typeof value !== "string" || value.length > 512 || !/^assets\/[A-Za-z0-9_./-]+$/.test(value) || value.split("/").some((part) => !part || part === "." || part === "..")) fail("\u7D20\u6750\u5FC5\u987B\u662F\u5DE5\u7A0B assets \u5185\u7684\u672C\u5730\u76F8\u5BF9\u8DEF\u5F84");
  const extension = value.split(".").at(-1).toLowerCase();
  const allowed = kind === "image" ? ["png", "jpg", "jpeg", "webp"] : kind === "video" ? ["mp4", "webm", "mov"] : ["mp3", "wav", "m4a", "ogg", "mp4", "webm", "mov"];
  if (!allowed.includes(extension)) fail("\u7D20\u6750\u683C\u5F0F\u4E0E\u8F68\u9053\u7C7B\u578B\u4E0D\u5339\u914D");
  return value;
}
function compileNativeVideo(project) {
  if (!project || typeof project !== "object") fail("\u7F3A\u5C11\u89C6\u9891\u5DE5\u7A0B");
  identifier(project.id, "\u5DE5\u7A0B ID");
  text(project.title, "\u5DE5\u7A0B\u540D\u79F0", 96);
  integer(project.width, "\u753B\u9762\u5BBD\u5EA6", 16, 7680);
  integer(project.height, "\u753B\u9762\u9AD8\u5EA6", 16, 7680);
  integer(project.fps?.numerator, "\u5E27\u7387\u5206\u5B50", 1, 12e4);
  integer(project.fps?.denominator, "\u5E27\u7387\u5206\u6BCD", 1, 1e4);
  const fps = project.fps.numerator / project.fps.denominator;
  number(fps, "\u5E27\u7387", 1, 120);
  if (!Array.isArray(project.tracks) || !project.tracks.length || project.tracks.length > 64) fail("\u8F68\u9053\u6570\u91CF\u5FC5\u987B\u5728 1\u201364 \u4E4B\u95F4");
  const trackIds = /* @__PURE__ */ new Set();
  const clipIds = /* @__PURE__ */ new Set();
  const assetPaths = /* @__PURE__ */ new Set();
  const elements = [];
  let lastFrame = 0;
  project.tracks.forEach((track, trackIndex) => {
    identifier(track.id, "\u8F68\u9053 ID");
    text(track.label, "\u8F68\u9053\u540D\u79F0", 96);
    if (trackIds.has(track.id)) fail("\u8F68\u9053 ID \u91CD\u590D");
    trackIds.add(track.id);
    if (!kinds.has(track.kind)) fail("\u672A\u77E5\u8F68\u9053\u7C7B\u578B");
    if (!Array.isArray(track.clips) || track.clips.length > 1e3) fail("\u5355\u8F68\u7247\u6BB5\u6570\u91CF\u8D85\u51FA\u8303\u56F4");
    const ordered = track.clips.slice();
    for (const clip of ordered) {
      identifier(clip.id, "\u7247\u6BB5 ID");
      text(clip.label, "\u7247\u6BB5\u540D\u79F0", 96);
      if (clipIds.has(clip.id)) fail("\u7247\u6BB5 ID \u91CD\u590D");
      clipIds.add(clip.id);
      if (clipIds.size > 5e3) fail("\u5DE5\u7A0B\u7247\u6BB5\u6570\u91CF\u8D85\u51FA\u8303\u56F4");
      integer(clip.startFrame, "\u7247\u6BB5\u8D77\u70B9", 0, Math.floor(fps * 3600));
      integer(clip.durationFrames, "\u7247\u6BB5\u65F6\u957F", 1, Math.floor(fps * 3600));
      if (clip.muted !== void 0 && typeof clip.muted !== "boolean") fail("\u9759\u97F3\u503C\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
    }
    ordered.sort((a, b) => a.startFrame - b.startFrame);
    let endFrame = 0;
    for (const clip of ordered) {
      if (clip.startFrame < endFrame) fail("\u540C\u4E00\u8F68\u9053\u4E0A\u7684\u7247\u6BB5\u4E0D\u80FD\u91CD\u53E0\uFF0C\u8BF7\u4F7F\u7528\u53E6\u4E00\u8F68\u9053");
      endFrame = clip.startFrame + clip.durationFrames;
      if (endFrame > fps * 3600) fail("\u5DE5\u7A0B\u6700\u957F\u652F\u6301\u4E00\u5C0F\u65F6");
      lastFrame = Math.max(lastFrame, endFrame);
      const duration = clip.durationFrames / fps;
      const common = `id="clip-${clip.id}" class="clip clip-${track.kind}" data-start="${seconds(clip.startFrame / fps)}" data-duration="${seconds(duration)}" data-track-index="${trackIndex}" data-timeline-clip-label="${escapeHtml(clip.label)}" data-short-video-track-id="${track.id}" data-short-video-track-label="${escapeHtml(track.label)}"`;
      if (track.kind === "caption") {
        text(clip.text, "\u5B57\u5E55\u5185\u5BB9", 5e3);
        if (clip.source !== void 0) fail("\u5B57\u5E55\u5FC5\u987B\u4FDD\u6301\u53EF\u7F16\u8F91\u6587\u5B57\uFF0C\u4E0D\u80FD\u7528\u5A92\u4F53\u66FF\u4EE3");
        elements.push(`<div ${common} data-timeline-kind="text" data-ipw-caption="true" data-ipw-caption-style="transparent-bottom" style="position:absolute;inset:auto 5% 5%;height:auto;display:flex;align-items:flex-end;justify-content:center;background:transparent;pointer-events:none;z-index:${trackIndex}"><span id="caption-${clip.id}" class="caption-text" data-ipw-caption-text="true">${escapeHtml(clip.text)}</span></div>`);
        continue;
      }
      const source = assetPath(clip.source, track.kind);
      assetPaths.add(source);
      if (track.kind === "image") {
        elements.push(`<img ${common} src="${source}" alt="${escapeHtml(clip.label)}" style="z-index:${trackIndex}">`);
        continue;
      }
      const offset = clip.sourceStartSeconds ?? 0;
      const rate = clip.playbackRate ?? 1;
      const volume = clip.volume ?? 1;
      number(offset, "\u5A92\u4F53\u5165\u70B9", 0, 86400);
      number(rate, "\u64AD\u653E\u901F\u5EA6", 0.25, 4);
      number(volume, "\u97F3\u91CF", 0, 1);
      number(clip.sourceDurationSeconds, "\u6E90\u7D20\u6750\u65F6\u957F", Number.EPSILON, 86400);
      if (offset + duration * rate > clip.sourceDurationSeconds + 1e-7) fail("\u7247\u6BB5\u8D85\u51FA\u6E90\u7D20\u6750\u65F6\u957F");
      const media = `src="${source}" data-media-start="${seconds(offset)}" data-playback-rate="${rate}" data-source-duration="${clip.sourceDurationSeconds}" data-volume="${track.kind === "video" || clip.muted ? 0 : volume}"`;
      elements.push(track.kind === "video" ? `<video ${common} ${media} muted playsinline data-has-audio="false" style="z-index:${trackIndex}"></video>` : `<audio ${common} ${media}${clip.muted ? " muted" : ""}></audio>`);
    }
  });
  if (!clipIds.size) fail("\u4E0D\u80FD\u4EA4\u63A5\u7A7A\u5DE5\u7A0B");
  const durationSeconds = lastFrame / fps;
  const variables = escapeHtml(JSON.stringify([{ id: "captionColor", type: "color", label: "\u5B57\u5E55\u989C\u8272", default: "#ffffff" }]));
  const html = `<!doctype html>
<html lang="zh-CN" data-composition-variables="${variables}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${project.width}, height=${project.height}">
<title>${escapeHtml(project.title)}</title>
<style>
body { margin:0; font-family:system-ui,sans-serif; }
#root { position:relative; width:${project.width}px; height:${project.height}px; overflow:hidden; }
.clip-video,.clip-image { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.caption-text { max-width:100%; white-space:pre-wrap; overflow-wrap:anywhere; text-align:center; color:var(--captionColor,#fff); font-size:${Math.max(18, Math.round(project.height * 0.045))}px; line-height:1.35; text-shadow:0 1px 4px #000; }
</style>
</head>
<body>
<div id="root" data-composition-id="${project.id}" data-start="0" data-duration="${seconds(durationSeconds)}" data-width="${project.width}" data-height="${project.height}" data-fps="${seconds(fps)}">
<div class="canvas-background" style="position:absolute;inset:0;background:#000"></div>
${elements.join("\n")}
</div>
</body>
</html>
`;
  return { html, assetPaths: [...assetPaths].sort(), durationSeconds, clipCount: clipIds.size };
}

// plugins/short-video-studio/business/src/project.mjs
var NODE_KINDS = ["text", "image", "video", "audio", "script", "storyboard"];
var uuid = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(value)) throw new Error("\u65E0\u6548\u7684 ID");
  return value;
}
function boundedText(value, max = 8e3) {
  if (typeof value !== "string" || value.length > max) throw new Error("\u6587\u5B57\u957F\u5EA6\u6216\u683C\u5F0F\u65E0\u6548");
  return value;
}
function finite(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error("\u6570\u503C\u8D85\u51FA\u8303\u56F4");
  return value;
}
function newProject(title = "\u672A\u547D\u540D\u77ED\u7247") {
  return {
    schemaVersion: 1,
    id: uuid("p"),
    title,
    revision: 0,
    updatedAt: Date.now(),
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    script: "",
    nodes: [],
    edges: [],
    shots: [],
    roles: [],
    assets: [],
    tracks: [],
    jobs: [],
    exports: []
  };
}
var array = (value, max) => {
  if (!Array.isArray(value) || value.length > max) throw new Error("\u5217\u8868\u8D85\u51FA\u4E0A\u9650");
  return value;
};
function unique(items) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    id(item.id);
    if (ids.has(item.id)) throw new Error("ID \u91CD\u590D");
    ids.add(item.id);
  }
  return ids;
}
function validateProject(input) {
  if (!input || JSON.stringify(input).length > 2e6 || input.schemaVersion !== 1) throw new Error("\u5DE5\u7A0B\u683C\u5F0F\u65E0\u6548");
  id(input.id);
  boundedText(input.title, 96);
  if (!input.title.trim()) throw new Error("\u8BF7\u586B\u5199\u5DE5\u7A0B\u540D\u79F0");
  for (const v of [input.width, input.height]) {
    finite(v, 16, 7680);
    if (!Number.isInteger(v)) throw new Error("\u5C3A\u5BF8\u5FC5\u987B\u4E3A\u6574\u6570");
  }
  finite(input.fps?.numerator, 1, 12e4);
  finite(input.fps?.denominator, 1, 1e4);
  finite(input.fps.numerator / input.fps.denominator, 1, 120);
  boundedText(input.script, 1e5);
  const nodes = unique(array(input.nodes, 500));
  for (const node of input.nodes) {
    if (!NODE_KINDS.includes(node.kind)) throw new Error("\u4E0D\u652F\u6301\u7684\u8282\u70B9\u7C7B\u578B");
    boundedText(node.title, 96);
    boundedText(node.prompt);
    finite(node.x, -1e4, 1e4);
    finite(node.y, -1e4, 1e4);
    if (node.assetId) id(node.assetId);
  }
  unique(array(input.edges, 1e3));
  for (const edge of input.edges) if (edge.from === edge.to || !nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error("\u8FDE\u7EBF\u5F15\u7528\u4E0D\u5B58\u5728");
  unique(array(input.shots, 500));
  for (const shot of input.shots) {
    boundedText(shot.title, 96);
    boundedText(shot.prompt);
    boundedText(shot.narration ?? "", 5e3);
    finite(shot.duration, 0.1, 3600);
    if (shot.assetId) id(shot.assetId);
  }
  unique(array(input.roles, 100));
  for (const role of input.roles) {
    boundedText(role.name, 96);
    boundedText(role.description);
  }
  unique(array(input.assets, 2e3));
  unique(array(input.tracks, 64));
  array(input.jobs, 500);
  array(input.exports, 100);
  if (input.tracks.some((t) => Array.isArray(t.clips) && t.clips.length)) compileNativeVideo(input);
  return structuredClone(input);
}
function arrangeShots(project) {
  const fps = project.fps.numerator / project.fps.denominator;
  const tracks = ["video", "image", "audio", "caption"].map((kind, i) => ({ id: `track_${kind}`, label: ["\u89C6\u9891", "\u56FE\u7247", "\u539F\u58F0", "\u5B57\u5E55"][i], kind, clips: [] }));
  let cursor = 0;
  for (const shot of project.shots) {
    const asset = project.assets.find((a) => a.id === shot.assetId);
    if (!asset || !["video", "image"].includes(asset.kind)) throw new Error(`\u5206\u955C\u300C${shot.title}\u300D\u9700\u8981\u56FE\u7247\u6216\u89C6\u9891\u7D20\u6750`);
    if (asset.kind === "video" && typeof asset.hasAudio !== "boolean") throw new Error(`\u65E0\u6CD5\u786E\u8BA4\u300C${asset.name}\u300D\u662F\u5426\u5305\u542B\u539F\u58F0\uFF1B\u8BF7\u901A\u8FC7 Work \u91CD\u65B0\u5BFC\u5165\u5E76\u8BFB\u53D6\u5A92\u4F53\u4FE1\u606F`);
    const seconds2 = asset.kind === "video" ? Math.min(shot.duration, asset.durationSeconds) : shot.duration;
    const durationFrames = Math.floor(seconds2 * fps);
    if (!durationFrames) throw new Error("\u7247\u6BB5\u5C0F\u4E8E\u4E00\u5E27");
    const clip = { id: uuid("c"), label: shot.title || asset.name, startFrame: cursor, durationFrames, source: `assets/${asset.file}`, sourceDurationSeconds: asset.durationSeconds, sourceStartSeconds: 0, volume: 1, playbackRate: 1 };
    tracks.find((t) => t.kind === asset.kind).clips.push(clip);
    if (asset.kind === "video" && asset.hasAudio === true) tracks[2].clips.push({ ...clip, id: uuid("c"), label: `${shot.title} \xB7 \u539F\u58F0` });
    if (shot.narration?.trim()) tracks[3].clips.push({ id: uuid("c"), label: shot.title, startFrame: cursor, durationFrames, text: shot.narration });
    cursor += durationFrames;
  }
  if (!cursor) throw new Error("\u5148\u6DFB\u52A0\u81F3\u5C11\u4E00\u4E2A\u5DF2\u5C31\u7EEA\u7684\u5206\u955C");
  return tracks.filter((t) => t.clips.length);
}

// plugins/short-video-studio/business/src/file-store.mjs
async function within(root, relative, createParents = false) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.startsWith("/") || relative.split("/").some((p) => !p || p === "." || p === "..")) throw new Error("\u6587\u4EF6\u8DEF\u5F84\u65E0\u6548");
  const base = await realpath(root);
  const parts = relative.split("/");
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    if (!current.startsWith(`${base}${sep}`)) throw new Error("\u6587\u4EF6\u4E0D\u5728\u5F53\u524D\u9879\u76EE\u5185");
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("\u4E0D\u5141\u8BB8\u7B26\u53F7\u94FE\u63A5");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (createParents && i < parts.length - 1) await mkdir(current);
    }
  }
  return current;
}
async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 384 });
  await rename(temp, path);
}
var ProjectStore = class {
  #locks = /* @__PURE__ */ new Map();
  constructor(root) {
    this.root = resolve(root);
  }
  async exclusive(key, task) {
    const prior = this.#locks.get(key) ?? Promise.resolve();
    const pending = prior.catch(() => {
    }).then(task);
    this.#locks.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.#locks.get(key) === pending) this.#locks.delete(key);
    }
  }
  path(projectId, file = "project.json", create = false) {
    return within(this.root, `short-video/${id(projectId)}/${file}`, create);
  }
  async read(projectId) {
    const path = await this.path(projectId);
    const info = await lstat(path);
    if (info.size > 2e6) throw new Error("\u5DE5\u7A0B\u8FC7\u5927");
    return validateProject(JSON.parse(await readFile(path, "utf8")));
  }
  async list() {
    const dir = await within(this.root, "short-video");
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    const projects = [];
    for (const entry of entries.filter((e) => e.isDirectory() && /^p_/.test(e.name)).slice(0, 1e3)) {
      try {
        const p = await this.read(entry.name);
        projects.push({ id: p.id, title: p.title, updatedAt: p.updatedAt, revision: p.revision });
      } catch {
      }
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async create(title) {
    const p = validateProject(newProject(title));
    await atomicJson(await this.path(p.id, "project.json", true), p);
    return p;
  }
  async update(projectId, revision, mutate) {
    return this.exclusive(projectId, async () => {
      const before = await this.read(projectId);
      if (revision !== void 0 && before.revision !== revision) throw new Error("\u9879\u76EE\u5DF2\u88AB\u5BF9\u8BDD\u6216\u53E6\u4E00\u4E2A\u7A97\u53E3\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u8F7D\u5165\u540E\u518D\u4FDD\u5B58");
      const after = validateProject(await mutate(structuredClone(before)));
      if (after.id !== before.id) throw new Error("\u4E0D\u80FD\u66F4\u6539\u5DE5\u7A0B ID");
      after.revision = before.revision + 1;
      after.updatedAt = Date.now();
      await atomicJson(await this.path(projectId, `history/r${before.revision}.json`, true), before);
      await atomicJson(await this.path(projectId), after);
      const history = await this.path(projectId, "history");
      const snapshots = (await readdir(history)).filter((name) => /^r\d+\.json$/.test(name)).sort((a, b) => Number(b.slice(1, -5)) - Number(a.slice(1, -5)));
      await Promise.all(snapshots.slice(50).map((file) => unlink(join(history, file))));
      return after;
    });
  }
  async save(input) {
    const candidate = validateProject(input);
    return this.update(candidate.id, candidate.revision, (before) => ({
      ...candidate,
      // Asset ownership, generation receipts, and handoffs are service-owned.
      assets: before.assets,
      jobs: before.jobs,
      exports: before.exports
    }));
  }
  async copyMedia(source, target) {
    await copyFile(await within(this.root, source), await within(this.root, target, true), 1);
  }
};

// plugins/short-video-studio/business/src/service.mjs
var MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg" };
var MAX_MEDIA = 256 * 1024 * 1024;
function mediaInfo(name) {
  const ext = extname(name).slice(1).toLowerCase();
  if (!MIME[ext]) throw new Error("\u652F\u6301 PNG/JPG/WebP\u3001MP4/WebM/MOV\u3001MP3/WAV/M4A/OGG");
  return { ext, mime: MIME[ext], kind: MIME[ext].split("/")[0] };
}
function hostResult(value) {
  if (!value?.ok || !value.result) throw new Error(value?.message || "Work \u6E20\u9053\u6682\u4E0D\u53EF\u7528");
  return value.result;
}
function selected(object, keys) {
  return Object.fromEntries(keys.filter((k) => object[k] !== void 0 && object[k] !== "").map((k) => [k, object[k]]));
}
async function createService(runtime) {
  const store = new ProjectStore(runtime.workspace.root);
  const active = /* @__PURE__ */ new Map();
  const host = async (name, args) => hostResult(await runtime.host.callAction(name, args));
  async function attach(projectId, sourcePath, name, metadata = {}) {
    const info = mediaInfo(sourcePath);
    const source = await within(store.root, sourcePath);
    const stat = await lstat2(source);
    if (!stat.isFile() || !stat.size || stat.size > MAX_MEDIA) throw new Error("\u7D20\u6750\u4E3A\u7A7A\u6216\u8D85\u8FC7 256 MB");
    const assetId = uuid("a"), file = `${assetId}.${info.ext}`;
    await store.copyMedia(sourcePath, `short-video/${id(projectId)}/assets/${file}`);
    const safeMetadata = selected(metadata, ["durationSeconds", "width", "height", "hasAudio"]);
    if (safeMetadata.durationSeconds !== void 0) finite(safeMetadata.durationSeconds, 1e-3, 86400);
    for (const key of ["width", "height"]) if (safeMetadata[key] !== void 0) finite(safeMetadata[key], 1, 16384);
    const asset = { id: assetId, name: boundedText(name || file, 180), file, kind: info.kind, mime: info.mime, size: stat.size, ...safeMetadata };
    if (info.kind === "video") {
      try {
        const probe = await host("video-generation/inspect", { path: `short-video/${projectId}/assets/${file}` });
        const duration = probe.duration ?? probe.durationSeconds;
        if (Number.isFinite(duration)) asset.durationSeconds = duration;
        if (typeof probe.hasAudio === "boolean") asset.hasAudio = probe.hasAudio;
      } catch {
      }
    }
    const project = await store.update(projectId, void 0, (p) => {
      p.assets.push(asset);
      return p;
    });
    return { asset, project };
  }
  async function mark(projectId, requestId, patch) {
    return store.update(projectId, void 0, (p) => {
      Object.assign(p.jobs.find((j) => j.id === requestId), patch);
      return p;
    });
  }
  async function runGeneration(args, context, node, job) {
    try {
      const settings = node.settings ?? {};
      const prompt = [node.prompt, settings.style && `\u98CE\u683C\uFF1A${settings.style}`, settings.camera && `\u955C\u5934\uFF1A${settings.camera}`].filter(Boolean).join("\n");
      if (node.kind === "audio") {
        const outputPath = `short-video/${args.projectId}/generated/${job.id}.mp3`;
        const result = await host("media/speech_synthesize_workspace_file", {
          text: node.prompt,
          sceneId: node.id,
          sceneText: node.prompt,
          sceneStart: 0,
          sceneDuration: 1,
          outputPath,
          model: "cosyvoice-v3-flash",
          ...selected(settings, ["voice"])
        });
        const output = result.output;
        const attached = await attach(args.projectId, output.sourcePath, `${node.title}.mp3`, { durationSeconds: output.durationSeconds });
        await store.update(args.projectId, void 0, (doc) => {
          const current = doc.nodes.find((n) => n.id === node.id);
          if (current) current.assetId = attached.asset.id;
          Object.assign(doc.jobs.find((j) => j.id === job.id), { status: "succeeded", assetId: attached.asset.id });
          return doc;
        });
      } else if (node.kind === "image") {
        const input = { prompt, ...selected(settings, ["model", "size", "quality"]) };
        const p = await store.read(args.projectId);
        const asset = p.assets.find((a) => a.id === settings.referenceId);
        const result = asset ? await host("openai-image-generation/image_edit", {
          ...input,
          sourcePath: `short-video/${p.id}/assets/${asset.file}`,
          ...selected(settings, ["maskDataUrl"])
        }) : await host("openai-image-generation/image_generate", input);
        const attached = await attach(args.projectId, result.path, `${node.title}.png`);
        await store.update(args.projectId, void 0, (doc) => {
          const current = doc.nodes.find((n) => n.id === node.id);
          if (current) current.assetId = attached.asset.id;
          Object.assign(doc.jobs.find((j) => j.id === job.id), { status: "succeeded", assetId: attached.asset.id });
          return doc;
        });
      } else {
        const p = await store.read(args.projectId);
        const referencePath = (assetId) => {
          const a = p.assets.find((a2) => a2.id === assetId);
          if (!a) throw new Error("\u8BF7\u5148\u9009\u62E9\u53C2\u8003\u7D20\u6750");
          return `short-video/${p.id}/assets/${a.file}`;
        };
        const input = { requestId: job.id, prompt, ...selected(settings, ["model", "operation", "resolution", "duration", "ratio", "generateAudio", "watermark"]) };
        if (["first", "first-last"].includes(input.operation)) input.firstFrame = referencePath(settings.referenceId);
        if (input.operation === "first-last") input.lastFrame = referencePath(settings.lastFrameId);
        if (["reference", "edit", "extend"].includes(input.operation)) {
          for (const [key, kind] of [["imageRefs", "image"], ["videoRefs", "video"], ["audioRefs", "audio"]]) {
            input[key] = (settings.referenceIds ?? []).map((assetId) => p.assets.find((a) => a.id === assetId)).filter((a) => a?.kind === kind).map((a) => referencePath(a.id)).join("\n");
          }
        }
        const result = await host("video-generation/submit", input);
        await mark(args.projectId, job.id, { status: result.job.status, upstreamJobId: result.job.id, message: result.job.message });
      }
    } catch (e) {
      const rejected = [400, 401, 402, 403, 404, 422].includes(e.status) || ["provider_unauthorized", "provider_authentication_failed", "provider_insufficient_balance"].includes(e.code);
      const message = String(e.message).slice(0, 550).replace(/[。.!！]+$/, "");
      await mark(args.projectId, job.id, { status: rejected ? "failed" : "uncertain", message: `${message}\u3002${rejected ? "\u4FEE\u590D\u6E20\u9053\u914D\u7F6E\u540E\uFF0C\u53EF\u91CD\u65B0\u53D1\u8D77\u751F\u6210\u3002" : "\u8BF7\u5148\u68C0\u67E5\u6E20\u9053\u4EFB\u52A1\uFF0C\u63D2\u4EF6\u4E0D\u4F1A\u81EA\u52A8\u91CD\u65B0\u63D0\u4EA4\u3002"}` });
    } finally {
      active.delete(job.id);
    }
  }
  return { actions: {
    "project-list": async () => ({ projects: await store.list() }),
    "project-create": async (a) => ({ project: await store.create(a.title || "\u672A\u547D\u540D\u77ED\u7247") }),
    "project-read": async (a) => ({ project: await store.read(a.projectId) }),
    "project-save": async (a) => ({ project: await store.save(a.project) }),
    "project-restore": async (a) => {
      if (!Number.isSafeInteger(a.snapshot) || a.snapshot < 0) throw new Error("\u5386\u53F2\u7248\u672C\u65E0\u6548");
      const snapshot = JSON.parse(await readFile2(await store.path(a.projectId, `history/r${a.snapshot}.json`), "utf8"));
      const current = await store.read(a.projectId);
      return { project: await store.save({ ...snapshot, revision: a.revision, assets: current.assets }) };
    },
    "capabilities": async () => {
      const [images, videos, audio] = await Promise.allSettled([host("openai-image-generation/status", {}), host("video-generation/status", {}), host("media/status", {})]);
      return {
        images: images.status === "fulfilled" ? images.value : { models: [], error: images.reason.message },
        videos: videos.status === "fulfilled" ? videos.value : { models: [], error: videos.reason.message },
        audio: { configured: audio.status === "fulfilled" && audio.value.output?.configured === true }
      };
    },
    "asset-import": async (a) => attach(a.projectId, boundedText(a.path, 1e3), a.name || a.path.split("/").at(-1), a.metadata || {}),
    "asset-upload": async (a) => {
      id(a.projectId);
      id(a.uploadId);
      mediaInfo(a.filename);
      boundedText(a.filename, 180);
      finite(a.total, 1, MAX_MEDIA);
      finite(a.offset, 0, a.total);
      if (!Number.isSafeInteger(a.total) || !Number.isSafeInteger(a.offset) || typeof a.data !== "string" || a.data.length > 14e5 || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) throw new Error("\u4E0A\u4F20\u5206\u5757\u65E0\u6548");
      const chunk = Buffer.from(a.data, "base64");
      if (!chunk.length || chunk.length > 1024 * 1024 || a.offset + chunk.length > a.total) throw new Error("\u4E0A\u4F20\u5206\u5757\u5927\u5C0F\u65E0\u6548");
      await store.read(a.projectId);
      await mkdir2(runtime.storage.dataDir, { recursive: true });
      const temp = await within(runtime.storage.dataDir, `uploads/${a.projectId}-${a.uploadId}.part`, true);
      return store.exclusive(a.uploadId, async () => {
        const existing = await lstat2(temp).catch((e) => {
          if (e.code !== "ENOENT") throw e;
          return null;
        });
        if ((existing?.size ?? 0) !== a.offset) throw new Error("\u4E0A\u4F20\u4F4D\u7F6E\u4E0D\u540C\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u5165\u6587\u4EF6");
        const fd = await open(temp, a.offset ? "a" : "wx");
        try {
          await fd.writeFile(chunk);
        } finally {
          await fd.close();
        }
        const nextOffset = a.offset + chunk.length;
        if (nextOffset !== a.total) return { nextOffset };
        const info = mediaInfo(a.filename), assetId = uuid("a"), file = `${assetId}.${info.ext}`;
        if (info.kind !== "image") finite(a.durationSeconds, 1e-3, 86400);
        const asset = {
          id: assetId,
          name: a.filename,
          file,
          ...info,
          size: a.total,
          durationSeconds: a.durationSeconds,
          hasAudio: a.hasAudio
        };
        await rename2(temp, await store.path(a.projectId, `assets/${file}`, true));
        if (info.kind === "video") {
          try {
            const probe = await host("video-generation/inspect", { path: `short-video/${a.projectId}/assets/${file}` });
            if (Number.isFinite(probe.duration)) asset.durationSeconds = probe.duration;
            if (typeof probe.hasAudio === "boolean") asset.hasAudio = probe.hasAudio;
          } catch {
          }
        }
        const project = await store.update(a.projectId, void 0, (p) => {
          p.assets.push(asset);
          return p;
        });
        return { nextOffset, asset, project };
      });
    },
    "asset-read": async (a) => {
      const p = await store.read(a.projectId), asset = p.assets.find((item) => item.id === a.assetId);
      if (!asset) throw new Error("\u7D20\u6750\u4E0D\u5B58\u5728");
      const path = await store.path(p.id, `assets/${asset.file}`), info = await lstat2(path);
      if (!info.isFile() || info.size > MAX_MEDIA) throw new Error("\u7D20\u6750\u4E0D\u5408\u6CD5");
      const offset = a.offset ?? 0;
      finite(offset, 0, info.size);
      if (!Number.isSafeInteger(offset)) throw new Error("\u8BFB\u53D6\u4F4D\u7F6E\u65E0\u6548");
      const buffer = Buffer.alloc(Math.min(1024 * 1024, info.size - offset));
      const fd = await open(path, "r");
      let bytesRead;
      try {
        ({ bytesRead } = await fd.read(buffer, 0, buffer.length, offset));
      } finally {
        await fd.close();
      }
      return { data: buffer.subarray(0, bytesRead).toString("base64"), nextOffset: offset + bytesRead, size: info.size, mime: asset.mime };
    },
    "generate": async (a, context) => {
      const requestId = a.requestId;
      if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/.test(requestId)) throw new Error("\u7F3A\u5C11\u751F\u6210\u8BF7\u6C42 ID");
      if (!context.sessionId) throw new Error("\u8BF7\u4ECE Work \u5BF9\u8BDD\u6253\u5F00\u77ED\u7247\u5DE5\u4F5C\u53F0\u540E\u751F\u6210");
      let node, receipt, created = false;
      const project = await store.update(a.projectId, a.revision, (p) => {
        receipt = p.jobs.find((j) => j.id === requestId);
        if (receipt) return p;
        node = p.nodes.find((n) => n.id === a.nodeId);
        if (!node || !["image", "video", "audio"].includes(node.kind) || !node.prompt.trim()) throw new Error("\u9009\u62E9\u56FE\u7247/\u89C6\u9891/\u914D\u97F3\u8282\u70B9\u5E76\u586B\u5199\u5185\u5BB9");
        if (p.jobs.some((j) => j.nodeId === node.id && !["succeeded", "failed"].includes(j.status))) throw new Error("\u8BE5\u8282\u70B9\u5DF2\u6709\u4EFB\u52A1\uFF1B\u8BF7\u5148\u68C0\u67E5\u4EFB\u52A1\u72B6\u6001\uFF0C\u4E0D\u8981\u91CD\u590D\u6263\u8D39");
        receipt = { id: requestId, kind: node.kind, nodeId: node.id, title: node.title, status: "submitting", sessionId: context.sessionId, createdAt: Date.now() };
        p.jobs.push(receipt);
        created = true;
        return p;
      });
      if (created) {
        const task = runGeneration(a, context, structuredClone(node), receipt);
        active.set(requestId, task);
      }
      return { project, job: receipt };
    },
    "generation-status": async (a, context) => store.exclusive(`status-${id(a.projectId)}`, async () => {
      let p = await store.read(a.projectId);
      const live = p.jobs.filter((j) => !["succeeded", "failed"].includes(j.status) && j.sessionId === context.sessionId);
      if (live.some((j) => j.kind === "video" && j.upstreamJobId)) {
        const result = await host("video-generation/jobs", {});
        for (const job of live.filter((j) => j.upstreamJobId)) {
          const remote = result.jobs.find((j) => j.id === job.upstreamJobId);
          if (!remote) continue;
          if (remote.status === "succeeded" && remote.path) {
            const { asset } = await attach(p.id, remote.path, `${job.title}.mp4`);
            p = await store.update(p.id, void 0, (doc) => {
              const n = doc.nodes.find((n2) => n2.id === job.nodeId);
              if (n) n.assetId = asset.id;
              Object.assign(doc.jobs.find((j) => j.id === job.id), { status: "succeeded", assetId: asset.id });
              return doc;
            });
          } else if (remote.status !== job.status || remote.message !== job.message) p = await mark(p.id, job.id, { status: remote.status, message: remote.message });
        }
      }
      for (const job of live.filter((j) => !j.upstreamJobId && !active.has(j.id) && j.status === "submitting")) {
        p = await mark(p.id, job.id, { status: "uncertain", message: "\u751F\u6210\u4E2D\u65AD\uFF0C\u7ED3\u679C\u672A\u77E5\uFF1B\u8BF7\u68C0\u67E5\u6E20\u9053\u8D26\u5355/\u4EFB\u52A1\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u65B0\u6263\u8D39\u3002" });
      }
      return { project: await store.read(p.id) };
    }),
    "arrange": async (a) => ({ project: await store.update(a.projectId, a.revision, (p) => {
      p.tracks = arrangeShots(p);
      return p;
    }) }),
    "handoff": async (a) => store.exclusive(`export-${a.projectId}`, async () => {
      const p = await store.read(a.projectId);
      if (p.revision !== a.revision) throw new Error("\u9879\u76EE\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u8F7D\u5165");
      const compiled = compileNativeVideo(p);
      const digest = createHash("sha256").update(compiled.html).digest("hex");
      const existing = p.exports.find((e) => e.digest === digest);
      if (existing && await lstat2(await within(store.root, existing.path)).then((s) => s.isFile()).catch(() => false)) return { project: p, ...existing, absolutePath: `${store.root}/${existing.path}`, reused: true };
      const videoId = uuid("shortvideo"), path = `video/${videoId}/index.html`;
      for (const file of compiled.assetPaths) {
        if (!p.assets.some((asset) => `assets/${asset.file}` === file)) throw new Error("\u8F68\u9053\u5F15\u7528\u4E86\u672A\u767B\u8BB0\u7684\u7D20\u6750");
        await store.copyMedia(`short-video/${p.id}/${file}`, `video/${videoId}/${file}`);
      }
      await writeFile2(await within(store.root, path, true), compiled.html, { flag: "wx" });
      const receipt = { path, digest, videoId, title: p.title, createdAt: Date.now(), clipCount: compiled.clipCount };
      const project = await store.update(p.id, void 0, (doc) => {
        doc.exports.push(receipt);
        return doc;
      });
      return { project, ...receipt, absolutePath: `${store.root}/${path}` };
    })
  }, dispose: async () => {
    await Promise.allSettled(active.values());
  } };
}
export {
  createService as default
};
