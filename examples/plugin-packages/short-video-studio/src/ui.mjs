import { createBridge } from './bridge.mjs';
import { addNode, uuid } from './project.mjs';
import './ui.css';
import './responsive.css';
import { requireRuntime } from '@ipollowork/ui/runtime-contract';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const names = { text: '笔记', image: '图片', video: '视频', audio: '音频', script: '剧本', storyboard: '分镜' };
const tabs = { canvas: '创作画布', shots: '分镜', script: '剧本', roles: '角色', assets: '素材', tracks: '轨道编排', jobs: '生成记录' };
const presets = { '自由创作': '', '电影分镜四宫格': '将以下内容制作成 2×2 电影分镜，保持角色一致：', '角色三视图': '同一角色的正面、侧面、背面三视图，纯色背景：', '角色设定': '角色设定表，包含全身、面部、表情，保持一致性：', '产品展示': '商业产品摄影，干净背景、柔和布光、材质细节：', '多角度场景': '同一场景不同机位的视觉设定，空间布局一致：', '时间演变': '同一场景在不同时段的四格时间演变：', '电影布光': '电影级布光，精确的光影与景深：' };
const cameraOptions = ['自动', '固定镜头', '缓慢推进', '拉远', '水平摇镜', '垂直摇镜', '环绕拍摄', '跟随镜头', '俯拍', '仰拍', '微距', '航拍', '手持纪实', '慢动作', '变焦'];
const state = { project: null, projects: [], tab: 'canvas', selection: null, capabilities: null, context: {}, zoom: 1, pan: { x: 0, y: 0 }, busy: false, undo: [], redo: [] };
const previews = new Map(); let previewEpoch = 0, toastTimer, queue = Promise.resolve(), drag;
const drafts = new Map(); let draftTimer;
async function flushDrafts() {
  clearTimeout(draftTimer); if (!drafts.size) return;
  const pending = new Map(drafts); drafts.clear();
  try { await mutate(p => [...pending.values()].forEach(edit => edit(p))); }
  catch (error) { for (const [key, edit] of pending) if (!drafts.has(key)) drafts.set(key, edit); const footer=$('footer'); if(footer)footer.textContent='保存失败：改动仍暂存，请重新载入并重试。'; throw error; }
}
function notify(message) { const toast = $('#toast'); toast.hidden = false; toast.textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 5500); }
function fail(error) { notify(error?.message || String(error)); }
function option(value, label, selected) { return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`; }
function select(options, value, attrs = '') { return `<select ${attrs}>${options.map(o => option(typeof o === 'string' ? o : o.id, typeof o === 'string' ? o : o.label, value)).join('')}</select>`; }
let fieldIndex = 0;
function field(label, control) { const key = `field-${++fieldIndex}`; return `<label for="${key}">${esc(label)}</label>${control.replace(/<(input|select|textarea)/, `<$1 id="${key}"`)}`; }
const button = (action, text, attrs = '') => `<button data-action="${action}" ${attrs}>${text}</button>`;
const empty = (title, detail, action = '') => `<div class="empty"><div class="empty-symbol">▧</div><h2>${title}</h2><p>${detail}</p>${action}</div>`;
const statuses = { submitting: '提交中', running: '生成中', saving: '保存中', succeeded: '已完成', failed: '失败', uncertain: '需确认', save_failed: '保存失败' };
const schema = properties => ({ type: 'object', properties, additionalProperties: false });
const tools = [
  { name: 'project_read', description: 'Read the open short-video project: nodes, edges, assets, shots, roles, tracks, jobs and revision.', inputSchema: schema({}) },
  { name: 'project_update', description: 'Save the full project after project_read. Preserve unrelated content and use its current revision. Assets, jobs, exports are service-owned. This does not call paid providers.', inputSchema: schema({ project: { type: 'object' } }) },
  { name: 'generate', description: 'Generate the selected image/video node using Work channels. Requires user intent to generate; may incur provider charges. requestId must be a UUID; reuse it on retries. Inspect capabilities first.', inputSchema: schema({ nodeId: { type: 'string' }, requestId: { type: 'string' } }) },
  { name: 'capabilities', description: 'Read actual connected Work image/video models and supported parameters.', inputSchema: schema({}) },
  { name: 'generation_status', description: 'Refresh existing generation jobs without generating again.', inputSchema: schema({}) },
  { name: 'import_asset', description: 'Import a user-selected workspace media path into this project. Include durationSeconds metadata for audio/video when unavailable from inspection.', inputSchema: schema({ path: { type: 'string' }, name: { type: 'string' }, metadata: { type: 'object' } }) },
  { name: 'arrange_shots', description: 'Replace current rough-cut tracks with the ordered shots; video, original sound and captions remain separate. Confirm replacement when existing manual track edits matter.', inputSchema: schema({}) },
  { name: 'handoff', description: 'Write a new native editable multitrack HTML project and freeze local assets. Return its path as a clickable local file link in left chat. Never overwrite the native editor document.', inputSchema: schema({}) },
];
const bridge = createBridge(context => { state.context = { ...state.context, ...context }; }, async (method, params) => {
  if (method === 'tools/list') return { tools };
  if (method !== 'tools/call') throw new Error('不支持的方法');
  if (!state.project) throw new Error('先创建或打开一个短片项目');
  await flushDrafts(); await queue;
  const args = params?.arguments ?? {}; let result;
  if (params.name === 'project_read') result = { project: state.project };
  else if (params.name === 'project_update') { if (args.project?.id !== state.project.id) throw new Error('不能更新其他项目'); result = await bridge.call('project-save', args); }
  else {
    const action = { generate: 'generate', capabilities: 'capabilities', generation_status: 'generation-status', import_asset: 'asset-import', arrange_shots: 'arrange', handoff: 'handoff' }[params.name];
    if (!action) throw new Error('未知工具');
    result = await bridge.call(action, { ...args, projectId: state.project.id, revision: state.project.revision });
  }
  if (result.project) { state.project = result.project; render(); }
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
});
async function dialog(title, description, initial, submit) {
  const box = $('#dialog');
  const trigger = document.activeElement;
  let busy = false, result;
  box.innerHTML = `<div><h2>${esc(title)}</h2><p class="muted" style="margin:12px 0">${esc(description)}</p>${initial !== undefined ? `<input data-ipw-control="input" name="value" aria-label="${esc(title)}" value="${esc(initial)}" maxlength="96" required>` : ''}<p id="dialog-error" role="alert" hidden></p><div class="toolbar"><button data-ipw-control="button" data-ipw-variant="outline" type="button" data-dialog="cancel">取消</button><button data-ipw-control="button" type="button" data-dialog="ok">确定</button></div></div>`;
  const error = box.querySelector('#dialog-error'), input = box.querySelector('input');
  const clearError = () => { error.hidden = true; input?.removeAttribute('aria-invalid'); input?.removeAttribute('aria-describedby'); };
  box.oninput = clearError;
  box.oncancel = event => { if (busy) event.preventDefault(); };
  box.onclick = async event => {
    const decision=event.target.closest('[data-dialog]')?.dataset.dialog;
    if (!decision || busy) return;
    if (decision === 'cancel') { box.close('cancel'); return; }
    if (input && !input.reportValidity()) return;
    if (!submit) { box.close('ok'); return; }
    busy = true; clearError(); box.setAttribute('aria-busy', 'true');
    for (const button of box.querySelectorAll('button')) button.disabled = true;
    box.querySelector('[data-dialog="ok"]').textContent = '提交中…';
    try { result = await submit(input?.value); box.close('ok'); }
    catch (reason) { error.textContent = reason.message || '保存失败，请重试'; error.hidden = false; input?.setAttribute('aria-invalid', 'true'); input?.setAttribute('aria-describedby', 'dialog-error'); input?.focus(); }
    finally { busy = false; box.removeAttribute('aria-busy'); for (const button of box.querySelectorAll('button')) button.disabled = false; box.querySelector('[data-dialog="ok"]').textContent = '确定'; }
  };
  requireRuntime().enhance(box);
  box.showModal();
  return new Promise(resolve => box.addEventListener('close', () => { trigger?.focus(); resolve(box.returnValue === 'ok' ? submit ? result : initial !== undefined ? input.value : true : false); }, { once: true }));
}
async function mutate(fn, history = true) {
  queue = queue.catch(() => {}).then(async () => {
    const before = structuredClone(state.project), next = structuredClone(before);
    fn(next); state.busy = true;
    try {
      const result = await bridge.call('project-save', { project: next });
      if (history) { state.undo.push(before); state.undo = state.undo.slice(-30); state.redo = []; }
      state.project = result.project; render();
    } finally { state.busy = false; }
  });
  return queue;
}
async function operation(name, args = {}) {
  await queue.catch(() => {});
  state.busy = true;
  try { const result = await bridge.call(name, { projectId: state.project.id, revision: state.project.revision, ...args }); if (result.project) state.project = result.project; render(); return result; }
  finally { state.busy = false; }
}
function preview(assetId, controls = false) {
  const asset = state.project.assets.find(a => a.id === assetId);
  if (!asset) return '<span>等待素材</span>';
  const url = previews.get(assetId);
  if (!url) return `<span data-preview="${assetId}">点击后载入 ${esc(asset.kind === 'image' ? '图片' : asset.kind === 'video' ? '视频' : '音频')}</span>`;
  const tag = asset.kind === 'image' ? 'img' : asset.kind;
  return `<${tag} src="${esc(url)}" ${tag === 'img' ? `alt="${esc(asset.name)}"` : `${controls ? 'controls' : 'muted'} preload="metadata" playsinline`}></${tag}>`;
}
async function loadPreview(assetId) {
  if (previews.has(assetId)) return;
  const projectId = state.project.id, chunks = []; let offset = 0, result;
  do {
    result = await bridge.call('asset-read', { projectId, assetId, offset });
    chunks.push(Uint8Array.from(atob(result.data), c => c.charCodeAt(0)));
    if (result.nextOffset <= offset && offset < result.size) throw new Error('素材读取未前进');
    offset = result.nextOffset;
  } while (offset < result.size);
  if (state.project.id !== projectId) return;
  if (previews.size >= 24) { const [key, url] = previews.entries().next().value; URL.revokeObjectURL(url); previews.delete(key); }
  previews.set(assetId, URL.createObjectURL(new Blob(chunks, { type: result.mime })));
}
function releasePreviews() { for (const url of previews.values()) URL.revokeObjectURL(url); previews.clear(); }
function nodeMarkup(node) {
  const job = [...state.project.jobs].reverse().find(j => j.nodeId === node.id);
  return `<section class="node ${state.selection === node.id ? 'selected' : ''}" data-node="${node.id}" style="left:${node.x}px;top:${node.y}px" tabindex="0" role="button" aria-label="编辑 ${esc(node.title)}"><div class="node-head"><span class="dot"></span><b>${esc(node.title)}</b><span class="spacer"></span><small>${names[node.kind]}</small></div><div class="node-body ${node.assetId ? 'media' : ''}">${node.assetId ? preview(node.assetId) : esc(node.prompt || '选中节点，编辑创意与参数')}</div><div class="node-foot"><span>${job ? esc(statuses[job.status] || job.status) : node.assetId ? '素材已就绪' : '草稿'}</span><span>···</span></div></section>`;
}
function edgeMarkup() {
  return state.project.edges.map(e => {
    const a = state.project.nodes.find(n => n.id === e.from), b = state.project.nodes.find(n => n.id === e.to);
    if (!a || !b) return '';
    const x = a.x + 245 + 10000, y = a.y + 106 + 10000, bx = b.x + 10000, by = b.y + 106 + 10000;
    return `<path d="M${x},${y} C${x+100},${y} ${bx-100},${by} ${bx},${by}"/>`;
  }).join('');
}
function canvas() { return `<div class="canvas" id="canvas"><div class="plane" style="transform:translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})"><svg class="edges">${edgeMarkup()}</svg>${state.project.nodes.map(nodeMarkup).join('')}</div>${!state.project.nodes.length ? empty('从一个创意开始', '添加节点，或在左侧对话中描述你的短片。<br>分镜、参考素材与生成结果都保存在这里。', button('add:image', '＋ 图片节点', 'class="primary"')) : ''}<div class="floating-tools">${['text', 'image', 'video', 'audio'].map(k => button(`add:${k}`, `＋ ${names[k]}`)).join('')}${button('upload', '导入素材')}</div><div class="zoom">${button('zoom-out', '−')}<small>${Math.round(state.zoom * 100)}%</small>${button('zoom-in', '+')}${button('fit', '归位')}</div></div>`; }
function inspector() {
  const n = state.project.nodes.find(n => n.id === state.selection); if (!n) return '';
  if (n.kind === 'audio') return `<aside class="inspector"><div class="inspector-head"><h3>配音 / 音频</h3>${button('close-inspector','✕','class="ghost" aria-label="关闭属性"')}</div>${field('名称',`<input data-node-field="title" value="${esc(n.title)}" maxlength="96">`)}${field('配音文本',`<textarea rows="8" data-node-field="prompt">${esc(n.prompt)}</textarea>`)}${field('音色 ID（留空使用默认音色）',`<input data-setting="voice" value="${esc(n.settings?.voice||'')}">`)}<p class="notice">使用 Work 百炼 CosyVoice 配音。${state.capabilities?.audio?.configured?'渠道已连接。':'请先在 Work 授权中心连接百炼。'}音乐和音效可直接导入；这里不会把语音接口冒充音乐生成。</p>${button('generate','生成配音',`class="primary" ${state.capabilities?.audio?.configured?'':'disabled'}`)}${field('绑定本地音频',select([{id:'',label:'不使用'},...state.project.assets.filter(a=>a.kind==='audio').map(a=>({id:a.id,label:a.name}))],n.assetId||'','data-node-field="assetId"'))}<div class="toolbar" style="margin-top:16px">${button('preview-node','预览')}${button('node-audio-track','加入音轨')}${button('delete-node','删除','class="danger"')}</div></aside>`;
  const s = n.settings ?? {}, models = n.kind === 'image' ? state.capabilities?.images?.models ?? [] : state.capabilities?.videos?.models ?? [];
  const usable = models.filter(m => m.available !== false && m.configured !== false);
  const model = usable.find(m => m.id === s.model) ?? usable[0];
  const assets = state.project.assets;
  const assetSelect = (key, kinds, label) => field(label, select([{ id: '', label: '不使用' }, ...assets.filter(a => kinds.includes(a.kind)).map(a => ({ id: a.id, label: a.name }))], s[key] || '', `data-setting="${key}"`));
  const params = n.kind === 'image' ? ['size', 'quality'].map(key => {
    const values = model?.parameters?.[key]?.values;
    return values?.length ? field(key === 'size' ? '尺寸' : '质量', select(['auto', ...values.filter(v => v !== 'auto')], s[key] || 'auto', `data-setting="${key}"`)) : '';
  }).join('') : model ? field('生成方式', select(model.operations, s.operation || 'text', 'data-setting="operation"'))
    + field('分辨率', select(model.resolutions, s.resolution || model.defaultResolution, 'data-setting="resolution"'))
    + field('时长（秒）', select(model.durations, s.duration || model.durations.find(d => d !== '-1'), 'data-setting="duration"'))
    + field('画幅', select(['first', 'first-last', 'edit', 'extend'].includes(s.operation) ? ['adaptive'] : model.ratios, s.ratio || '16:9', 'data-setting="ratio"')) : '';
  return `<aside class="inspector"><div class="inspector-head"><h3>${names[n.kind]} · 节点设置</h3>${button('close-inspector', '✕', 'class="ghost" aria-label="关闭属性"')}</div>${field('名称', `<input data-node-field="title" value="${esc(n.title)}" maxlength="96">`)}${field('创作描述', `<textarea data-node-field="prompt" rows="6" maxlength="8000">${esc(n.prompt)}</textarea>`)}${['image', 'video'].includes(n.kind) ? `${field('Work 生成渠道', select(usable.length ? usable.map(m => ({ id: m.id, label: m.label })) : [{ id: '', label: '尚未连接可用渠道' }], s.model || model?.id, 'data-setting="model"'))}${!usable.length ? '<p class="notice">请在 Work 的授权中心连接图片或视频渠道。插件不单独保存密钥。</p>' : ''}${params}${field('风格提示', select(Object.keys(presets), s.preset || '自由创作', 'data-setting="preset"'))}${field('镜头意图', select(cameraOptions, s.camera || '自动', 'data-setting="camera"'))}${assetSelect('referenceId', ['image'], n.kind === 'image' ? '参考图 / 编辑原图' : '首帧图片')}${n.kind === 'video' && s.operation === 'first-last' ? assetSelect('lastFrameId', ['image'], '尾帧图片') : ''}${n.kind === 'video' && ['reference','edit','extend'].includes(s.operation) ? field('多模态参考（按住 ⌘ 多选）', `<select multiple data-setting="referenceIds" size="4">${assets.map(a => `<option value="${a.id}" ${(s.referenceIds ?? []).includes(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`) : ''}${button('generate', '生成素材', `class="primary" ${!model ? 'disabled' : ''}`)}<small>调用真实渠道，可能产生费用。镜头和风格是提示词意图，并非精确渲染控制。</small>` : ''}<hr>${field('节点素材', select([{ id: '', label: '未绑定' }, ...assets.map(a => ({ id: a.id, label: a.name }))], n.assetId || '', 'data-node-field="assetId"'))}${field('关联前序节点', select([{ id: '', label: '添加一条连线…' }, ...state.project.nodes.filter(x => x.id !== n.id).map(x => ({ id: x.id, label: x.title }))], '', 'data-link="true"'))}<small>连线组织创作关系；生成参考以此面板所选素材为准。</small><div class="toolbar" style="margin-top:14px">${button('preview-node', '预览')}${button('node-shot', '加入分镜')}${button('duplicate-node', '复制')}${button('unlink-node', '断开连线')}${button('delete-node', '删除', 'class="danger"')}</div></aside>`;
}
function heading(title, desc, controls = '') { return `<div class="page-heading"><div><h2>${title}</h2><p>${desc}</p></div><div class="toolbar">${controls}</div></div>`; }
function shots() { return `<div class="page">${heading('分镜', '先确定故事节奏，再为每个镜头选择素材。', button('add-shot', '＋ 分镜') + button('arrange', '编排到轨道', 'class="primary"'))}${state.project.shots.length ? `<div class="cards">${state.project.shots.map((s, i) => `<article class="card" data-shot="${s.id}"><div class="card-media" data-action="preview-shot" data-id="${s.id}">${preview(s.assetId)}</div><div class="card-content"><div class="row"><span class="badge">${String(i+1).padStart(2, '0')}</span><input class="title" data-shot-field="title" value="${esc(s.title)}" aria-label="分镜名称"></div>${field('画面描述', `<textarea data-shot-field="prompt">${esc(s.prompt)}</textarea>`)}${field('旁白 / 字幕', `<textarea data-shot-field="narration" style="min-height:55px">${esc(s.narration)}</textarea>`)}${field('镜头素材', select([{ id: '', label: '选择素材' }, ...state.project.assets.filter(a => a.kind !== 'audio').map(a => ({ id: a.id, label: a.name }))], s.assetId || '', 'data-shot-field="assetId"'))}<div class="row"><input type="number" min=".1" max="3600" step=".1" value="${s.duration}" data-shot-field="duration" aria-label="秒数"><small>秒</small>${button('shot-up', '↑')}${button('shot-down', '↓')}${button('shot-node', '生成节点')}${button('shot-delete', '×', 'aria-label="删除分镜"')}</div></div></article>`).join('')}</div>` : empty('故事从第一个镜头开始', '手动添加分镜，或让左侧 AI 读取剧本后写入。') }</div>`; }
function roles() { return `<div class="page">${heading('角色档案', '人物设定和参考图片，随项目保存。', button('add-role', '＋ 角色', 'class="primary"'))}<div class="cards">${state.project.roles.map(r => `<article class="card" data-role="${r.id}"><div class="card-media">${preview(r.assetId)}</div><div class="card-content"><input class="title" value="${esc(r.name)}" data-role-field="name" aria-label="角色名称">${field('外貌 / 性格 / 服装 / 一致性说明', `<textarea rows="6" data-role-field="description">${esc(r.description)}</textarea>`)}${field('角色参考图', select([{ id:'',label:'选择参考图' }, ...state.project.assets.filter(a => a.kind === 'image').map(a => ({id:a.id,label:a.name}))], r.assetId || '', 'data-role-field="assetId"'))}<div class="row">${button('role-node', '创建角色图节点')}${button('role-delete', '删除', 'class="danger"')}</div></div></article>`).join('')}</div>${!state.project.roles.length ? empty('保持角色一致', '添加角色后，AI 可以读取这些设定；生成时仍需选择参考图。') : ''}</div>`; }
function assets() { return `<div class="page">${heading('项目素材', `${state.project.assets.length} 个文件 · 本地保存，卸载插件不会删除创作文件`, button('upload', '＋ 导入素材', 'class="primary"'))}<div class="cards">${state.project.assets.slice(-100).reverse().map(a => `<article class="card"><div class="card-media" data-action="preview-asset" data-id="${a.id}">${preview(a.id, true)}</div><div class="card-content"><h3>${esc(a.name)}</h3><small>${esc(a.kind)} · ${(a.size/1048576).toFixed(1)} MB${a.durationSeconds ? ` · ${a.durationSeconds.toFixed(1)} 秒` : ''}</small><div class="row">${button('asset-node', '加入画布', `data-id="${a.id}"`)}${button(a.kind === 'audio' ? 'asset-track' : 'asset-shot', a.kind === 'audio' ? '添加音轨' : '加入分镜', `data-id="${a.id}"`)}</div></div></article>`).join('')}</div>${!state.project.assets.length ? empty('导入你的创作素材', '支持图片、视频和音频；可直接拖入文件，单个不超过 256 MB。') : ''}</div>`; }
function tracks() {
  const p = state.project, fps = p.fps.numerator / p.fps.denominator;
  const maxFrame = Math.max(1, ...p.tracks.flatMap(t => t.clips.map(c => c.startFrame+c.durationFrames)));
  return `<div class="page">${heading('轨道编排', '保留独立视频、原声、配乐和字幕；精细剪辑交给 Work 视频工具。', button('arrange', '从分镜重新编排') + button('handoff', '交到 Work 剪辑', 'class="primary"'))}<div class="row">${field('画幅', select(['1920x1080','1080x1920','1080x1080','2560x1440'],`${p.width}x${p.height}`,'data-project-size="true"'))}${field('帧率',select(['24','25','30','60'],String(fps),'data-project-fps="true"'))}</div>${p.tracks.map(t => `<section class="track" data-track="${t.id}"><div class="track-header"><h3>${esc(t.label)}</h3><span class="badge">${t.kind}</span><span class="spacer"></span>${button('track-delete','移除轨道','class="ghost danger"')}</div><div class="track-body"><div class="ruler">${t.clips.map(c => `<div class="clip-bar" style="left:${100*c.startFrame/maxFrame}%;width:${100*c.durationFrames/maxFrame}%">${esc(c.label)}</div>`).join('')}</div>${t.clips.map(c => `<div class="clip-row" data-clip="${c.id}"><label>${t.kind==='caption'?'字幕文字':'片段'}<input data-clip-field="${t.kind==='caption'?'text':'label'}" value="${esc(t.kind==='caption'?c.text:c.label)}"></label>${[['startFrame','起点/秒',c.startFrame/fps],['durationFrames','时长/秒',c.durationFrames/fps],['sourceStartSeconds','入点/秒',c.sourceStartSeconds??0],['volume','音量',c.volume??1]].map(([key,label,value])=>`<label>${label}<input type="number" step="${key==='volume'?'.05':1/fps}" min="0" ${key==='volume'?'max="1"':''} data-clip-field="${key}" value="${Number(value.toFixed(3))}" ${t.kind==='caption'&&['sourceStartSeconds','volume'].includes(key)?'disabled':''}></label>`).join('')}${button('clip-delete','×','aria-label="删除片段"')}</div>`).join('')}</div></section>`).join('')}${!p.tracks.length?empty('还没有编排轨道','在分镜中选好素材，点击「编排到轨道」。音频可从素材库单独添加。'):''}${p.exports.length ? `<div class="notice">已交接 ${p.exports.length} 份原生工程。原生剪辑后的修改不会被画布覆盖。${p.exports.slice(-3).map(e=>`<p>${esc(e.path)}</p>`).join('')}</div>`:''}</div>`;
}
function jobs() { return `<div class="page">${heading('生成记录','任务状态来自 Work 渠道。关闭工作台后视频任务由 Work 继续查询。',button('refresh-jobs','刷新状态'))}${state.project.jobs.slice().reverse().map(j=>`<div class="job"><span class="job-status ${['submitting','running','saving'].includes(j.status)?'pulse':''}">${esc(statuses[j.status]||j.status)}</span><div><h3>${esc(j.title)}</h3><small>${esc(j.message||j.kind)} · ${new Date(j.createdAt).toLocaleString()}</small></div><span class="spacer"></span>${j.assetId?button('preview-asset','查看素材',`data-id="${j.assetId}"`):''}</div>`).join('')||empty('尚无生成任务','在画布选中图片或视频节点，填写描述后生成。')}</div>`; }
function render() {
  if (!state.project) return;
  const focused = document.activeElement;
  const focusState = focused?.id && focused.closest('#app') && ['INPUT','TEXTAREA','SELECT'].includes(focused.tagName)
    ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : null;
  fieldIndex = 0;
  const p = state.project;
  $('#app').innerHTML = `<header class="topbar"><div class="brand">▧</div><select class="project-picker" id="project-picker" aria-label="切换项目">${state.projects.some(x=>x.id===p.id)?'':option(p.id,p.title,p.id)}${state.projects.map(x=>option(x.id,x.id===p.id?p.title:x.title,p.id)).join('')}</select>${button('new-project','＋','aria-label="新建项目"')}${button('rename-project','重命名','class="ghost minor"')}<span class="spacer"></span>${button('undo','↶',`aria-label="撤销" ${!state.undo.length?'disabled':''}`)}${button('redo','↷',`aria-label="重做" ${!state.redo.length?'disabled':''}`)}${button('handoff','交到 Work 剪辑','class="primary"')}</header><nav class="tabs" aria-label="工作台视图">${Object.entries(tabs).map(([key,label])=>button(`tab:${key}`,label,`class="${state.tab===key?'active':''}"`)).join('')}</nav><div class="workspace"><main class="main">${state.tab==='canvas'?canvas():state.tab==='shots'?shots():state.tab==='roles'?roles():state.tab==='assets'?assets():state.tab==='tracks'?tracks():state.tab==='jobs'?jobs():`<div class="page">${heading('剧本','脚本和分镜都可以由左侧 AI 读取和修改。',button('split-script','按段落拆分镜')+button('ask-script','让 AI 完善','class="primary"'))}<textarea class="script-area" data-script="true" aria-label="剧本内容" placeholder="写下创意、旁白或完整剧本…">${esc(p.script)}</textarea></div>`}</main>${state.tab==='canvas'?inspector():''}</div><footer><span>iPolloWork 短片工作台 · 本地工程</span><span>已保存 · r${p.revision} · ${p.nodes.length} 个节点</span></footer>`;
  $('.topbar .spacer').insertAdjacentHTML('beforebegin',button('reload-project','重新载入','class="ghost minor"'));
  if(state.tab==='tracks')for(const track of p.tracks.filter(t=>t.kind==='video'))for(const input of document.querySelectorAll(`[data-track="${track.id}"] [data-clip-field="volume"]`)){input.disabled=true;input.title='视频轨不混入声音，请在独立原声轨调节音量';}
  if (focusState) { const next=document.getElementById(focusState.id); next?.focus({preventScroll:true}); if (next && typeof focusState.start==='number' && ['text','textarea'].includes(next.type)) next.setSelectionRange(focusState.start,focusState.end); }
  bridge.context(p,state.selection); const epoch = ++previewEpoch;
  // Load visible thumbnails without replacing focused form elements.
  void (async () => {
    const pending = [...document.querySelectorAll('[data-preview]')].filter(el => p.assets.find(a => a.id === el.dataset.preview)?.kind === 'image').slice(0, 12);
    for (const element of pending) {
      if (epoch !== previewEpoch) break;
      try { await loadPreview(element.dataset.preview); if (element.isConnected) element.outerHTML = preview(element.dataset.preview); } catch { if (element.isConnected) element.textContent = '点击重试预览'; }
    }
  })();
}

async function importFiles(files) {
  for (const file of files) {
    if (!file.size || file.size > 256*1024*1024) throw new Error(`${file.name} 为空或超过 256 MB`);
    let durationSeconds;
    if (/\.(mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(file.name)) {
      const url=URL.createObjectURL(file), media=document.createElement('video');media.preload='metadata';media.src=url;
      try { durationSeconds=await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('媒体无法解码，请转换为 MP4 或 WAV')),15000);media.onloadedmetadata=()=>{clearTimeout(timer);resolve(media.duration)};media.onerror=()=>{clearTimeout(timer);reject(new Error('浏览器无法读取媒体，请转换格式'))}; }); }
      finally { media.removeAttribute('src');media.load();URL.revokeObjectURL(url); }
      if (!Number.isFinite(durationSeconds)||durationSeconds<=0) throw new Error('无法读取媒体时长');
    }
    const uploadId=uuid('u');
    for(let offset=0;offset<file.size;offset+=1024*1024){
      notify(`正在导入 ${file.name} · ${Math.round(offset/file.size*100)}%`);
      const blob=file.slice(offset,offset+1024*1024), dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});
      await operation('asset-upload',{uploadId,filename:file.name,total:file.size,offset,data:dataUrl.split(',')[1],durationSeconds});
    }
  }
  state.tab='assets';render();notify('素材已导入');
}
function shotFromAsset(p,assetId){const a=p.assets.find(a=>a.id===assetId);if(!a||a.kind==='audio')throw new Error('请选择图片或视频');p.shots.push({id:uuid('s'),title:a.name.slice(0,96),prompt:'',narration:'',duration:Math.min(a.durationSeconds||4,6),assetId});}
async function action(name, target) {
  // Keep the browser's file chooser in the original user-activation stack.
  if (name === 'upload') { $('#upload').click(); return; }
  if (name === 'reload-project') { const result=await bridge.call('project-read',{projectId:state.project.id}); state.project=result.project; await flushDrafts(); render(); notify('项目已重新载入'); return; }
  await flushDrafts();
  const [key,value]=name.split(':'), p=state.project, node=p.nodes.find(n=>n.id===state.selection), shotId=target.closest('[data-shot]')?.dataset.shot, roleId=target.closest('[data-role]')?.dataset.role;
  if(key==='tab'){state.tab=value;state.selection=null;render();return;}
  if(key==='add'){await mutate(p=>{state.selection=addNode(p,value).id});return;}
  if(key==='new-project'){const created=await dialog('新建短片','每个项目独立保存。','未命名短片',title=>bridge.call('project-create',{title}));if(!created)return;releasePreviews();state.project=created.project;state.projects=(await bridge.call('project-list')).projects;state.selection=null;state.undo=[];state.redo=[];state.tab='canvas';render();document.querySelector('[aria-label="新建项目"]')?.focus();return;}
  if(key==='rename-project'){const title=await dialog('项目名称','',p.title);if(title)await mutate(p=>p.title=title);return;}
  if(['zoom-in','zoom-out','fit'].includes(key)){if(key==='fit'){state.zoom=1;state.pan={x:0,y:0}}else state.zoom=Math.max(.25,Math.min(2,state.zoom+(key==='zoom-in'?.1:-.1)));render();return;}
  if(key==='close-inspector'){state.selection=null;render();return;}
  if(key==='delete-node'){await mutate(p=>{p.nodes=p.nodes.filter(n=>n.id!==node.id);p.edges=p.edges.filter(e=>e.from!==node.id&&e.to!==node.id)});state.selection=null;render();return;}
  if(key==='duplicate-node'){await mutate(p=>{const copy={...structuredClone(node),id:uuid('n'),x:node.x+35,y:node.y+35};p.nodes.push(copy);state.selection=copy.id});return;}
  if(key==='unlink-node'){await mutate(p=>p.edges=p.edges.filter(e=>e.to!==node.id&&e.from!==node.id));return;}
  if(key==='node-shot'){await mutate(p=>shotFromAsset(p,node.assetId));notify('已加入分镜');return;}
  if(key==='node-audio-track'){if(!node.assetId)throw new Error('先生成或选择音频');await action('asset-track',{dataset:{id:node.assetId},closest:()=>null});return;}
  if(key==='upload'){$('#upload').click();return;}
  if(key==='generate'){
    if(!await dialog('生成素材','将通过 Work 已连接的渠道生成，可能产生费用。继续吗？'))return;
    await mutate(p=>{
      const n=p.nodes.find(x=>x.id===node.id),s=n.settings??={};
      if(n.kind==='audio'){if(!state.capabilities?.audio?.configured)throw new Error('请先连接 Work 百炼配音渠道');return;}
      const models=(n.kind==='image'?state.capabilities?.images?.models:state.capabilities?.videos?.models)||[],m=models.find(m=>m.id===s.model)||models.find(m=>m.available!==false&&m.configured!==false);
      if(!m)throw new Error('尚未配置可用渠道');s.model=m.id;
      if(n.kind==='video'){s.operation||='text';s.resolution||=m.defaultResolution;s.duration||=m.durations.find(d=>d!=='-1');s.ratio||='16:9';if(['first','first-last','edit','extend'].includes(s.operation))s.ratio='adaptive';if(s.operation==='edit')s.duration='-1';}
    });
    await operation('generate',{nodeId:node.id,requestId:crypto.randomUUID()});notify('已提交，请在生成记录中查看');return;
  }
  if(key==='refresh-jobs'){await operation('generation-status');return;}
  if(key==='add-shot'){await mutate(p=>p.shots.push({id:uuid('s'),title:`镜头 ${p.shots.length+1}`,prompt:'',narration:'',duration:4}));return;}
  if(key==='shot-delete'){await mutate(p=>p.shots=p.shots.filter(s=>s.id!==shotId));return;}
  if(key==='shot-up'||key==='shot-down'){await mutate(p=>{const i=p.shots.findIndex(s=>s.id===shotId),j=i+(key==='shot-up'?-1:1);if(j>=0&&j<p.shots.length)[p.shots[i],p.shots[j]]=[p.shots[j],p.shots[i]]});return;}
  if(key==='shot-node'){await mutate(p=>{const s=p.shots.find(s=>s.id===shotId),n=addNode(p,'image');n.title=s.title;n.prompt=s.prompt;state.selection=n.id});state.tab='canvas';render();return;}
  if(key==='split-script'){if(p.shots.length&&!await dialog('替换分镜？','现有分镜会被剧本段落替换，可撤销。'))return;await mutate(p=>{p.shots=p.script.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean).map((text,i)=>({id:uuid('s'),title:`镜头 ${i+1}`,prompt:text,narration:'',duration:4}))});state.tab='shots';render();return;}
  if(key==='ask-script'){await bridge.request('ui/message',{role:'user',content:[{type:'text',text:'请读取短片工作台当前项目，完善剧本并规划分镜，保留我的创意。先规划，不要自动付费生成素材。'}]});return;}
  if(key==='add-role'){await mutate(p=>p.roles.push({id:uuid('r'),name:'新角色',description:''}));return;}
  if(key==='role-delete'){await mutate(p=>p.roles=p.roles.filter(r=>r.id!==roleId));return;}
  if(key==='role-node'){await mutate(p=>{const r=p.roles.find(r=>r.id===roleId),n=addNode(p,'image');n.title=r.name;n.prompt=`角色设定图：${r.description}`;n.settings={referenceId:r.assetId||''};state.selection=n.id});state.tab='canvas';render();return;}
  if(key==='asset-node'){await mutate(p=>{const a=p.assets.find(a=>a.id===target.dataset.id),n=addNode(p,a.kind);n.title=a.name.slice(0,96);n.assetId=a.id;state.selection=n.id});state.tab='canvas';render();return;}
  if(key==='asset-shot'){await mutate(p=>shotFromAsset(p,target.dataset.id));notify('已加入分镜');return;}
  if(key==='asset-track'){await mutate(p=>{const a=p.assets.find(a=>a.id===target.dataset.id),fps=p.fps.numerator/p.fps.denominator;p.tracks.push({id:uuid('t'),label:a.name.slice(0,96),kind:'audio',clips:[{id:uuid('c'),label:a.name.slice(0,96),startFrame:0,durationFrames:Math.floor(a.durationSeconds*fps),source:`assets/${a.file}`,sourceDurationSeconds:a.durationSeconds,sourceStartSeconds:0,volume:1,playbackRate:1}]})});state.tab='tracks';render();return;}
  if(key==='track-delete'){const trackId=target.closest('[data-track]').dataset.track;await mutate(p=>p.tracks=p.tracks.filter(t=>t.id!==trackId));return;}
  if(key==='clip-delete'){const clipId=target.closest('[data-clip]').dataset.clip;await mutate(p=>p.tracks.forEach(t=>t.clips=t.clips.filter(c=>c.id!==clipId)));return;}
  if(key==='arrange'){if(p.tracks.length&&!await dialog('重新编排？','将替换现有轨道，包括手动添加的配乐。原生剪辑文件不受影响。'))return;await operation('arrange');state.tab='tracks';render();return;}
  if(key==='handoff'){
    const result=await operation('handoff');
    const path=result.absolutePath||`${state.context['ai.ipollo/workspace']?.workspaceRoot||''}/${result.path}`;
    if (!await dialog('分轨工程已保存',`${result.clipCount} 个独立片段，原声、配乐、字幕保持可编辑。\n${result.path}\n点击确定，在左侧对话提供打开入口。`)) return;
    const response=await bridge.request('ui/message',{role:'user',content:[{type:'text',text:`短片工作台已生成原生多轨工程：${path}。请直接给我这个 index.html 文件的可点击本地链接，在现有视频工具打开继续剪辑。不要重新生成、不要扁平化、不要覆盖它。`}]});
    if(response?.isError)notify(`工程已保存，请让左侧 AI 打开：${result.path}`);return;
  }
  if(key.startsWith('preview')){const assetId=key==='preview-node'?node.assetId:key==='preview-shot'?p.shots.find(s=>s.id===target.dataset.id)?.assetId:target.dataset.id;if(!assetId)throw new Error('还没有素材');notify('正在读取素材…');await loadPreview(assetId);render();return;}
  if(key==='undo'||key==='redo'){const from=key==='undo'?state.undo:state.redo,to=key==='undo'?state.redo:state.undo,old=from.pop();if(!old)return;to.push(structuredClone(state.project));const result=await bridge.call('project-save',{project:{...old,revision:state.project.revision}});state.project=result.project;render();return;}
}

document.body.innerHTML='<div id="app"><div class="loading">正在连接 Work 短片工作台…</div></div><div id="toast" role="status" hidden></div><dialog id="dialog"></dialog><input id="upload" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg" hidden>';
document.addEventListener('click',e=>{if(e.target.closest('video,audio'))return;const target=e.target.closest('[data-action]');if(target)void action(target.dataset.action,target).catch(fail);else{const node=e.target.closest('[data-node]');if(node&&!drag){void flushDrafts().then(()=>{state.selection=node.dataset.node;render()}).catch(fail)}}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#dialog').open){state.selection=null;render()}if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-node]')){e.preventDefault();state.selection=e.target.dataset.node;render()}});
async function handleField(e) {
  const target=e.target, value=target.type==='number'?Number(target.value):target.value;
  if(e.type==='input'&&target.id==='project-picker')return;
  if(target.id==='upload'){void importFiles([...target.files]).catch(fail);target.value='';return;}
  if(target.id==='project-picker'){try{await flushDrafts();const r=await bridge.call('project-read',{projectId:value});releasePreviews();state.project=r.project;state.selection=null;state.undo=[];state.redo=[];render()}catch(e){target.value=state.project.id;throw e}return;}
  const nodeId=state.selection,shotId=target.closest('[data-shot]')?.dataset.shot,roleId=target.closest('[data-role]')?.dataset.role,clipId=target.closest('[data-clip]')?.dataset.clip;
  const dataset={...target.dataset},selectedValues=target.multiple?[...target.selectedOptions].map(o=>o.value):[];
  if(!Object.keys(dataset).some(k=>['nodeField','setting','link','shotField','roleField','script','projectSize','projectFps','clipField'].includes(k)))return;
  drafts.set(target.id||JSON.stringify([dataset,nodeId,shotId,roleId,clipId]),p=>{
    const n=p.nodes.find(n=>n.id===nodeId);
    if(dataset.nodeField&&n)n[dataset.nodeField]=value;
    else if(dataset.setting&&n){const s=n.settings??={},key=dataset.setting;s[key]=key==='referenceIds'?selectedValues:value;if(key==='preset'&&presets[value])n.prompt=`${presets[value]}\n${n.prompt}`;if(key==='model'){n.settings={model:value}}}
    else if(dataset.link&&n&&value&&!p.edges.some(e=>e.from===value&&e.to===n.id))p.edges.push({id:uuid('e'),from:value,to:n.id});
    else if(dataset.shotField)p.shots.find(s=>s.id===shotId)[dataset.shotField]=value;
    else if(dataset.roleField)p.roles.find(r=>r.id===roleId)[dataset.roleField]=value;
    else if(dataset.script)p.script=value;
    else if(dataset.projectSize)[p.width,p.height]=value.split('x').map(Number);
    else if(dataset.projectFps){if(p.tracks.some(t=>t.clips.length))throw new Error('已有轨道时请在 Work 视频工具调整帧率，避免改变片段时长');p.fps={numerator:Number(value),denominator:1}}
    else if(dataset.clipField){const c=p.tracks.flatMap(t=>t.clips).find(c=>c.id===clipId),key=dataset.clipField;c[key]=['startFrame','durationFrames'].includes(key)?Math.round(value*p.fps.numerator/p.fps.denominator):value;}
  });
  const footer=$('footer');if(footer)footer.textContent='正在保存改动…';
  clearTimeout(draftTimer); draftTimer=setTimeout(()=>void flushDrafts().catch(fail),e.type==='change'?0:500);
}
document.addEventListener('change',e=>void handleField(e).catch(fail));
document.addEventListener('input',e=>{if(e.target.type!=='file')void handleField(e).catch(fail)});
document.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('button,input,textarea,select,video,audio'))return;
  const head=e.target.closest('.node-head'),canvas=e.target.closest('#canvas');if(!canvas)return;
  const node=head?state.project.nodes.find(n=>n.id===head.closest('[data-node]').dataset.node):null;
  if(!head&&e.target.closest('.node'))return;
  drag={node,element:head?.closest('[data-node]'),startX:e.clientX,startY:e.clientY,x:node?.x??state.pan.x,y:node?.y??state.pan.y,moved:false};canvas.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;drag.moved||=Math.abs(dx)+Math.abs(dy)>4;if(drag.node){drag.element.style.left=`${drag.x+dx/state.zoom}px`;drag.element.style.top=`${drag.y+dy/state.zoom}px`}else{state.pan={x:drag.x+dx,y:drag.y+dy};$('.plane').style.transform=`translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`}});
document.addEventListener('pointerup',e=>{if(!drag)return;const d=drag;drag=null;if(d.node&&d.moved){const x=Math.max(-10000,Math.min(10000,d.x+(e.clientX-d.startX)/state.zoom)),y=Math.max(-10000,Math.min(10000,d.y+(e.clientY-d.startY)/state.zoom));void mutate(p=>Object.assign(p.nodes.find(n=>n.id===d.node.id),{x,y})).catch(fail)}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()});
document.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();void importFiles([...e.dataTransfer.files]).catch(fail)}});
await Promise.resolve().then(()=>{requireRuntime();return bridge.start();}).then(async()=>{state.capabilities=await bridge.call('capabilities');state.projects=(await bridge.call('project-list')).projects;state.project=state.projects.length?(await bridge.call('project-read',{projectId:state.projects[0].id})).project:(await bridge.call('project-create',{title:'我的第一部短片'})).project;render();}).catch(e=>{$('#app').innerHTML=`<div class="empty"><h2>暂未连接</h2><p role="alert">${esc(e.message)}</p></div>`});
async function pollJobs() {
  try {
    if(state.project && !document.hidden && !state.busy && !drafts.size && !document.activeElement?.matches('input,textarea,select') && state.project.jobs.some(j=>['submitting','running','saving'].includes(j.status))) {
      const projectId=state.project.id;
      const result=await bridge.call('generation-status',{projectId});
      if(state.project.id===projectId && !state.busy && !drafts.size && result.project.revision!==state.project.revision){state.project=result.project;render();}
    }
  } catch { /* The explicit refresh action reports errors without a repeated toast storm. */ }
  finally { setTimeout(pollJobs,5000); }
}
setTimeout(pollJobs,5000);
