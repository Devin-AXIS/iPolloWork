// Portable project document. UI and MCP edit the same revisioned document.
import { compileNativeVideo } from './native-video.mjs';
export const NODE_KINDS = ['text', 'image', 'video', 'audio', 'script', 'storyboard'];
export const uuid = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(value)) throw new Error('无效的 ID');
  return value;
}
export function boundedText(value, max = 8000) {
  if (typeof value !== 'string' || value.length > max) throw new Error('文字长度或格式无效');
  return value;
}
export function finite(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error('数值超出范围');
  return value;
}
export function newProject(title = '未命名短片') {
  return { schemaVersion: 1, id: uuid('p'), title, revision: 0, updatedAt: Date.now(),
    width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 },
    script: '', nodes: [], edges: [], shots: [], roles: [], assets: [], tracks: [], jobs: [], exports: [] };
}
const array = (value, max) => { if (!Array.isArray(value) || value.length > max) throw new Error('列表超出上限'); return value; };
function unique(items) { const ids = new Set(); for (const item of items) { id(item.id); if (ids.has(item.id)) throw new Error('ID 重复'); ids.add(item.id); } return ids; }
export function validateProject(input) {
  if (!input || JSON.stringify(input).length > 2_000_000 || input.schemaVersion !== 1) throw new Error('工程格式无效');
  id(input.id); boundedText(input.title, 96); if (!input.title.trim()) throw new Error('请填写工程名称');
  for (const v of [input.width, input.height]) { finite(v, 16, 7680); if (!Number.isInteger(v)) throw new Error('尺寸必须为整数'); }
  finite(input.fps?.numerator, 1, 120000); finite(input.fps?.denominator, 1, 10000);
  finite(input.fps.numerator / input.fps.denominator, 1, 120);
  boundedText(input.script, 100000);
  const nodes = unique(array(input.nodes, 500));
  for (const node of input.nodes) {
    if (!NODE_KINDS.includes(node.kind)) throw new Error('不支持的节点类型');
    boundedText(node.title, 96); boundedText(node.prompt); finite(node.x, -10000, 10000); finite(node.y, -10000, 10000);
    if (node.assetId) id(node.assetId);
  }
  unique(array(input.edges, 1000));
  for (const edge of input.edges) if (edge.from === edge.to || !nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error('连线引用不存在');
  unique(array(input.shots, 500));
  for (const shot of input.shots) { boundedText(shot.title, 96); boundedText(shot.prompt); boundedText(shot.narration ?? '', 5000); finite(shot.duration, .1, 3600); if (shot.assetId) id(shot.assetId); }
  unique(array(input.roles, 100));
  for (const role of input.roles) { boundedText(role.name, 96); boundedText(role.description); }
  unique(array(input.assets, 2000)); unique(array(input.tracks, 64)); array(input.jobs, 500); array(input.exports, 100);
  if (input.tracks.some(t => Array.isArray(t.clips) && t.clips.length)) compileNativeVideo(input);
  return structuredClone(input);
}

export function addNode(project, kind, position = {}) {
  const names = { text: '创意笔记', image: '图片', video: '视频', audio: '音频', script: '剧本', storyboard: '分镜' };
  const node = { id: uuid('n'), kind, title: names[kind], prompt: '', x: position.x ?? 80 + project.nodes.length % 3 * 280, y: position.y ?? 80 + Math.floor(project.nodes.length / 3) * 260 };
  project.nodes.push(node); return node;
}

// Sound is never baked into the visual track. Original video audio is explicit.
export function arrangeShots(project) {
  const fps = project.fps.numerator / project.fps.denominator;
  const tracks = ['video', 'image', 'audio', 'caption'].map((kind, i) => ({ id: `track_${kind}`, label: ['视频', '图片', '原声', '字幕'][i], kind, clips: [] }));
  let cursor = 0;
  for (const shot of project.shots) {
    const asset = project.assets.find(a => a.id === shot.assetId);
    if (!asset || !['video', 'image'].includes(asset.kind)) throw new Error(`分镜「${shot.title}」需要图片或视频素材`);
    if (asset.kind === 'video' && typeof asset.hasAudio !== 'boolean') throw new Error(`无法确认「${asset.name}」是否包含原声；请通过 Work 重新导入并读取媒体信息`);
    const seconds = asset.kind === 'video' ? Math.min(shot.duration, asset.durationSeconds) : shot.duration;
    const durationFrames = Math.floor(seconds * fps);
    if (!durationFrames) throw new Error('片段小于一帧');
    const clip = { id: uuid('c'), label: shot.title || asset.name, startFrame: cursor, durationFrames, source: `assets/${asset.file}`, sourceDurationSeconds: asset.durationSeconds, sourceStartSeconds: 0, volume: 1, playbackRate: 1 };
    tracks.find(t => t.kind === asset.kind).clips.push(clip);
    if (asset.kind === 'video' && asset.hasAudio === true) tracks[2].clips.push({ ...clip, id: uuid('c'), label: `${shot.title} · 原声` });
    if (shot.narration?.trim()) tracks[3].clips.push({ id: uuid('c'), label: shot.title, startFrame: cursor, durationFrames, text: shot.narration });
    cursor += durationFrames;
  }
  if (!cursor) throw new Error('先添加至少一个已就绪的分镜');
  return tracks.filter(t => t.clips.length);
}
