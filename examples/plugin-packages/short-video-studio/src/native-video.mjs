// Output uses the host's native document contract, not a second editor format.
// After handoff the host edits this HTML; never rebuild over those user edits.

/** @typedef {{ id: string, label: string, startFrame: number, durationFrames: number,
 * source?: string, sourceStartSeconds?: number, sourceDurationSeconds?: number,
 * playbackRate?: number, volume?: number, muted?: boolean, text?: string }} Clip */
/** @typedef {{ id: string, label: string, kind: 'video'|'image'|'audio'|'caption',
 * clips: Clip[] }} Track */
/** @typedef {{ id: string, title: string, width: number, height: number,
 * fps: { numerator: number, denominator: number }, tracks: Track[] }} VideoProject */

const kinds = new Set(['video', 'image', 'audio', 'caption']);
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const seconds = value => String(Number(value.toFixed(9)));

function fail(message) { throw new Error(message); }
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(value)) fail(`${label} 无效`);
}
function text(value, label, maximum = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`);
}
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} 超出范围`);
}
function number(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} 超出范围`);
}
function assetPath(value, kind) {
  // Exported projects may outlive both the plugin and a provider's signed URL.
  // Media must already be frozen under the target project's assets directory.
  if (typeof value !== 'string' || value.length > 512 || !/^assets\/[A-Za-z0-9_./-]+$/.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) fail('素材必须是工程 assets 内的本地相对路径');
  const extension = value.split('.').at(-1).toLowerCase();
  const allowed = kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp']
    : kind === 'video' ? ['mp4', 'webm', 'mov']
    : ['mp3', 'wav', 'm4a', 'ogg', 'mp4', 'webm', 'mov'];
  if (!allowed.includes(extension)) fail('素材格式与轨道类型不匹配');
  return value;
}

/** Compile only; filesystem checks, decoding, and conflict-safe persistence are caller-owned.
 * @param {VideoProject} project
 * @returns {{ html: string, assetPaths: string[], durationSeconds: number, clipCount: number }}
 */
export function compileNativeVideo(project) {
  if (!project || typeof project !== 'object') fail('缺少视频工程');
  identifier(project.id, '工程 ID');
  text(project.title, '工程名称', 96);
  integer(project.width, '画面宽度', 16, 7680);
  integer(project.height, '画面高度', 16, 7680);
  integer(project.fps?.numerator, '帧率分子', 1, 120000);
  integer(project.fps?.denominator, '帧率分母', 1, 10000);
  const fps = project.fps.numerator / project.fps.denominator;
  number(fps, '帧率', 1, 120);
  if (!Array.isArray(project.tracks) || !project.tracks.length || project.tracks.length > 64) fail('轨道数量必须在 1–64 之间');
  const trackIds = new Set();
  const clipIds = new Set();
  const assetPaths = new Set();
  const elements = [];
  let lastFrame = 0;

  project.tracks.forEach((track, trackIndex) => {
    identifier(track.id, '轨道 ID');
    text(track.label, '轨道名称', 96);
    if (trackIds.has(track.id)) fail('轨道 ID 重复');
    trackIds.add(track.id);
    if (!kinds.has(track.kind)) fail('未知轨道类型');
    if (!Array.isArray(track.clips) || track.clips.length > 1000) fail('单轨片段数量超出范围');
    const ordered = track.clips.slice();
    for (const clip of ordered) {
      identifier(clip.id, '片段 ID');
      text(clip.label, '片段名称', 96);
      if (clipIds.has(clip.id)) fail('片段 ID 重复');
      clipIds.add(clip.id);
      if (clipIds.size > 5000) fail('工程片段数量超出范围');
      integer(clip.startFrame, '片段起点', 0, Math.floor(fps * 3600));
      integer(clip.durationFrames, '片段时长', 1, Math.floor(fps * 3600));
      if (clip.muted !== undefined && typeof clip.muted !== 'boolean') fail('静音值必须是布尔值');
    }
    ordered.sort((a, b) => a.startFrame - b.startFrame);
    let endFrame = 0;
    for (const clip of ordered) {
      if (clip.startFrame < endFrame) fail('同一轨道上的片段不能重叠，请使用另一轨道');
      endFrame = clip.startFrame + clip.durationFrames;
      if (endFrame > fps * 3600) fail('工程最长支持一小时');
      lastFrame = Math.max(lastFrame, endFrame);
      const duration = clip.durationFrames / fps;
      const common = `id="clip-${clip.id}" class="clip clip-${track.kind}" data-start="${seconds(clip.startFrame / fps)}" data-duration="${seconds(duration)}" data-track-index="${trackIndex}" data-timeline-clip-label="${escapeHtml(clip.label)}" data-short-video-track-id="${track.id}" data-short-video-track-label="${escapeHtml(track.label)}"`;
      if (track.kind === 'caption') {
        text(clip.text, '字幕内容', 5000);
        if (clip.source !== undefined) fail('字幕必须保持可编辑文字，不能用媒体替代');
        elements.push(`<div ${common} data-timeline-kind="text" data-ipw-caption="true" data-ipw-caption-style="transparent-bottom" style="position:absolute;inset:auto 5% 5%;height:auto;display:flex;align-items:flex-end;justify-content:center;background:transparent;pointer-events:none;z-index:${trackIndex}"><span id="caption-${clip.id}" class="caption-text" data-ipw-caption-text="true">${escapeHtml(clip.text)}</span></div>`);
        continue;
      }
      const source = assetPath(clip.source, track.kind);
      assetPaths.add(source);
      if (track.kind === 'image') {
        elements.push(`<img ${common} src="${source}" alt="${escapeHtml(clip.label)}" style="z-index:${trackIndex}">`);
        continue;
      }
      const offset = clip.sourceStartSeconds ?? 0;
      const rate = clip.playbackRate ?? 1;
      const volume = clip.volume ?? 1;
      number(offset, '媒体入点', 0, 86400);
      number(rate, '播放速度', 0.25, 4);
      number(volume, '音量', 0, 1);
      number(clip.sourceDurationSeconds, '源素材时长', Number.EPSILON, 86400);
      if (offset + duration * rate > clip.sourceDurationSeconds + 1e-7) fail('片段超出源素材时长');
      const media = `src="${source}" data-media-start="${seconds(offset)}" data-playback-rate="${rate}" data-source-duration="${clip.sourceDurationSeconds}" data-volume="${track.kind === 'video' || clip.muted ? 0 : volume}"`;
      // A video is visual-only. Original sound must be an explicit audio clip;
      // that prevents double audio and leaves every sound source independently editable.
      elements.push(track.kind === 'video'
        ? `<video ${common} ${media} muted playsinline data-has-audio="false" style="z-index:${trackIndex}"></video>`
        : `<audio ${common} ${media}${clip.muted ? ' muted' : ''}></audio>`);
    }
  });
  if (!clipIds.size) fail('不能交接空工程');
  const durationSeconds = lastFrame / fps;
  const variables = escapeHtml(JSON.stringify([{ id: 'captionColor', type: 'color', label: '字幕颜色', default: '#ffffff' }]));
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
${elements.join('\n')}
</div>
</body>
</html>\n`;
  // Static media compositions need no extra GSAP/runtime install: the host owns
  // clip visibility, media seeking, preview, and render, with explicit duration.
  return { html, assetPaths: [...assetPaths].sort(), durationSeconds, clipCount: clipIds.size };
}
