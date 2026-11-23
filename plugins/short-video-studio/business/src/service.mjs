import { readFile, writeFile, open, lstat, mkdir, rename } from 'node:fs/promises';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectStore, within } from './file-store.mjs';
import { id, uuid, boundedText, finite, arrangeShots } from './project.mjs';
import { compileNativeVideo } from './native-video.mjs';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg' };
const MAX_MEDIA = 256 * 1024 * 1024;
function mediaInfo(name) { const ext = extname(name).slice(1).toLowerCase(); if (!MIME[ext]) throw new Error('支持 PNG/JPG/WebP、MP4/WebM/MOV、MP3/WAV/M4A/OGG'); return { ext, mime: MIME[ext], kind: MIME[ext].split('/')[0] }; }
function hostResult(value) { if (!value?.ok || !value.result) throw new Error(value?.message || 'Work 渠道暂不可用'); return value.result; }
function selected(object, keys) { return Object.fromEntries(keys.filter(k => object[k] !== undefined && object[k] !== '').map(k => [k, object[k]])); }

export default async function createService(runtime) {
  const store = new ProjectStore(runtime.workspace.root);
  const active = new Map();
  const host = async (name, args) => hostResult(await runtime.host.callAction(name, args));
  async function attach(projectId, sourcePath, name, metadata = {}) {
    const info = mediaInfo(sourcePath);
    const source = await within(store.root, sourcePath);
    const stat = await lstat(source); if (!stat.isFile() || !stat.size || stat.size > MAX_MEDIA) throw new Error('素材为空或超过 256 MB');
    const assetId = uuid('a'), file = `${assetId}.${info.ext}`;
    await store.copyMedia(sourcePath, `short-video/${id(projectId)}/assets/${file}`);
    const safeMetadata = selected(metadata, ['durationSeconds', 'width', 'height', 'hasAudio']);
    if (safeMetadata.durationSeconds !== undefined) finite(safeMetadata.durationSeconds, .001, 86400);
    for (const key of ['width', 'height']) if (safeMetadata[key] !== undefined) finite(safeMetadata[key], 1, 16384);
    const asset = { id: assetId, name: boundedText(name || file, 180), file, kind: info.kind, mime: info.mime, size: stat.size, ...safeMetadata };
    if (info.kind === 'video') {
      try {
        const probe = await host('video-generation/inspect', { path: `short-video/${projectId}/assets/${file}` });
        const duration = probe.duration ?? probe.durationSeconds;
        if (Number.isFinite(duration)) asset.durationSeconds = duration;
        if (typeof probe.hasAudio === 'boolean') asset.hasAudio = probe.hasAudio;
      } catch { /* The UI probes decode and duration when a local codec isn't available. */ }
    }
    const project = await store.update(projectId, undefined, p => { p.assets.push(asset); return p; });
    return { asset, project };
  }
  async function mark(projectId, requestId, patch) {
    return store.update(projectId, undefined, p => { Object.assign(p.jobs.find(j => j.id === requestId), patch); return p; });
  }
  async function runGeneration(args, context, node, job) {
    try {
      const settings = node.settings ?? {};
      const prompt = [node.prompt, settings.style && `风格：${settings.style}`, settings.camera && `镜头：${settings.camera}`].filter(Boolean).join('\n');
      if (node.kind === 'audio') {
        const outputPath = `short-video/${args.projectId}/generated/${job.id}.mp3`;
        const result = await host('media/speech_synthesize_workspace_file', { text: node.prompt, sceneId: node.id, sceneText: node.prompt,
          sceneStart: 0, sceneDuration: 1, outputPath, model: 'cosyvoice-v3-flash', ...selected(settings, ['voice']) });
        const output = result.output;
        const attached = await attach(args.projectId, output.sourcePath, `${node.title}.mp3`, { durationSeconds: output.durationSeconds });
        await store.update(args.projectId, undefined, doc => {
          const current = doc.nodes.find(n => n.id === node.id); if (current) current.assetId = attached.asset.id;
          Object.assign(doc.jobs.find(j => j.id === job.id), { status: 'succeeded', assetId: attached.asset.id }); return doc;
        });
      } else if (node.kind === 'image') {
        const input = { prompt, ...selected(settings, ['model', 'size', 'quality']) };
        const p = await store.read(args.projectId);
        const asset = p.assets.find(a => a.id === settings.referenceId);
        const result = asset
          ? await host('openai-image-generation/image_edit', { ...input, sourcePath: `short-video/${p.id}/assets/${asset.file}`,
            ...selected(settings, ['maskDataUrl']) })
          : await host('openai-image-generation/image_generate', input);
        const attached = await attach(args.projectId, result.path, `${node.title}.png`);
        await store.update(args.projectId, undefined, doc => {
          const current = doc.nodes.find(n => n.id === node.id); if (current) current.assetId = attached.asset.id;
          Object.assign(doc.jobs.find(j => j.id === job.id), { status: 'succeeded', assetId: attached.asset.id }); return doc;
        });
      } else {
        const p = await store.read(args.projectId);
        const referencePath = assetId => { const a = p.assets.find(a => a.id === assetId); if (!a) throw new Error('请先选择参考素材'); return `short-video/${p.id}/assets/${a.file}`; };
        const input = { requestId: job.id, prompt, ...selected(settings, ['model', 'operation', 'resolution', 'duration', 'ratio', 'generateAudio', 'watermark']) };
        if (['first', 'first-last'].includes(input.operation)) input.firstFrame = referencePath(settings.referenceId);
        if (input.operation === 'first-last') input.lastFrame = referencePath(settings.lastFrameId);
        if (['reference', 'edit', 'extend'].includes(input.operation)) {
          for (const [key, kind] of [['imageRefs', 'image'], ['videoRefs', 'video'], ['audioRefs', 'audio']]) {
            input[key] = (settings.referenceIds ?? []).map(assetId => p.assets.find(a => a.id === assetId)).filter(a => a?.kind === kind).map(a => referencePath(a.id)).join('\n');
          }
        }
        const result = await host('video-generation/submit', input);
        await mark(args.projectId, job.id, { status: result.job.status, upstreamJobId: result.job.id, message: result.job.message });
      }
    } catch (e) {
      const rejected = [400,401,402,403,404,422].includes(e.status) || ['provider_unauthorized','provider_authentication_failed','provider_insufficient_balance'].includes(e.code);
      const message = String(e.message).slice(0, 550).replace(/[。.!！]+$/, '');
      await mark(args.projectId, job.id, { status: rejected ? 'failed' : 'uncertain', message: `${message}。${rejected ? '修复渠道配置后，可重新发起生成。' : '请先检查渠道任务，插件不会自动重新提交。'}` });
    }
    finally { active.delete(job.id); }
  }
  return { actions: {
    'project-list': async () => ({ projects: await store.list() }),
    'project-create': async a => ({ project: await store.create(a.title || '未命名短片') }),
    'project-read': async a => ({ project: await store.read(a.projectId) }),
    'project-save': async a => ({ project: await store.save(a.project) }),
    'project-restore': async a => {
      if (!Number.isSafeInteger(a.snapshot) || a.snapshot < 0) throw new Error('历史版本无效');
      const snapshot = JSON.parse(await readFile(await store.path(a.projectId, `history/r${a.snapshot}.json`), 'utf8'));
      const current = await store.read(a.projectId);
      return { project: await store.save({ ...snapshot, revision: a.revision, assets: current.assets }) };
    },
    'capabilities': async () => {
      const [images, videos, audio] = await Promise.allSettled([host('openai-image-generation/status', {}), host('video-generation/status', {}), host('media/status', {})]);
      return { images: images.status === 'fulfilled' ? images.value : { models: [], error: images.reason.message },
        videos: videos.status === 'fulfilled' ? videos.value : { models: [], error: videos.reason.message },
        audio: { configured: audio.status === 'fulfilled' && audio.value.output?.configured === true } };
    },
    'asset-import': async a => attach(a.projectId, boundedText(a.path, 1000), a.name || a.path.split('/').at(-1), a.metadata || {}),
    'asset-upload': async a => {
      id(a.projectId); id(a.uploadId); mediaInfo(a.filename); boundedText(a.filename, 180);
      finite(a.total, 1, MAX_MEDIA); finite(a.offset, 0, a.total);
      if (!Number.isSafeInteger(a.total) || !Number.isSafeInteger(a.offset) || typeof a.data !== 'string' || a.data.length > 1_400_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) throw new Error('上传分块无效');
      const chunk = Buffer.from(a.data, 'base64'); if (!chunk.length || chunk.length > 1024 * 1024 || a.offset + chunk.length > a.total) throw new Error('上传分块大小无效');
      await store.read(a.projectId);
      await mkdir(runtime.storage.dataDir, { recursive: true });
      const temp = await within(runtime.storage.dataDir, `uploads/${a.projectId}-${a.uploadId}.part`, true);
      return store.exclusive(a.uploadId, async () => {
        const existing = await lstat(temp).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
        if ((existing?.size ?? 0) !== a.offset) throw new Error('上传位置不同，请重新导入文件');
        const fd = await open(temp, a.offset ? 'a' : 'wx'); try { await fd.writeFile(chunk); } finally { await fd.close(); }
        const nextOffset = a.offset + chunk.length;
        if (nextOffset !== a.total) return { nextOffset };
        const info = mediaInfo(a.filename), assetId = uuid('a'), file = `${assetId}.${info.ext}`;
        if (info.kind !== 'image') finite(a.durationSeconds, .001, 86400);
        const asset = { id: assetId, name: a.filename, file, ...info, size: a.total,
          durationSeconds: a.durationSeconds, hasAudio: a.hasAudio };
        await rename(temp, await store.path(a.projectId, `assets/${file}`, true));
        if (info.kind === 'video') {
          try {
            const probe = await host('video-generation/inspect', { path: `short-video/${a.projectId}/assets/${file}` });
            if (Number.isFinite(probe.duration)) asset.durationSeconds = probe.duration;
            if (typeof probe.hasAudio === 'boolean') asset.hasAudio = probe.hasAudio;
          } catch { /* Unknown audio metadata is explicitly refused at arrangement. */ }
        }
        const project = await store.update(a.projectId, undefined, p => { p.assets.push(asset); return p; });
        return { nextOffset, asset, project };
      });
    },
    'asset-read': async a => {
      const p = await store.read(a.projectId), asset = p.assets.find(item => item.id === a.assetId);
      if (!asset) throw new Error('素材不存在');
      const path = await store.path(p.id, `assets/${asset.file}`), info = await lstat(path);
      if (!info.isFile() || info.size > MAX_MEDIA) throw new Error('素材不合法');
      const offset = a.offset ?? 0; finite(offset, 0, info.size); if (!Number.isSafeInteger(offset)) throw new Error('读取位置无效');
      const buffer = Buffer.alloc(Math.min(1024 * 1024, info.size - offset));
      const fd = await open(path, 'r'); let bytesRead; try { ({ bytesRead } = await fd.read(buffer, 0, buffer.length, offset)); } finally { await fd.close(); }
      return { data: buffer.subarray(0, bytesRead).toString('base64'), nextOffset: offset + bytesRead, size: info.size, mime: asset.mime };
    },
    'generate': async (a, context) => {
      const requestId = a.requestId;
      if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(requestId)) throw new Error('缺少生成请求 ID');
      if (!context.sessionId) throw new Error('请从 Work 对话打开短片工作台后生成');
      let node, receipt, created = false;
      const project = await store.update(a.projectId, a.revision, p => {
        receipt = p.jobs.find(j => j.id === requestId); if (receipt) return p;
        node = p.nodes.find(n => n.id === a.nodeId);
        if (!node || !['image', 'video', 'audio'].includes(node.kind) || !node.prompt.trim()) throw new Error('选择图片/视频/配音节点并填写内容');
        if (p.jobs.some(j => j.nodeId === node.id && !['succeeded', 'failed'].includes(j.status))) throw new Error('该节点已有任务；请先检查任务状态，不要重复扣费');
        receipt = { id: requestId, kind: node.kind, nodeId: node.id, title: node.title, status: 'submitting', sessionId: context.sessionId, createdAt: Date.now() };
        p.jobs.push(receipt); created = true; return p;
      });
      if (created) { const task = runGeneration(a, context, structuredClone(node), receipt); active.set(requestId, task); }
      return { project, job: receipt };
    },
    'generation-status': async (a, context) => store.exclusive(`status-${id(a.projectId)}`, async () => {
      let p = await store.read(a.projectId);
      const live = p.jobs.filter(j => !['succeeded', 'failed'].includes(j.status) && j.sessionId === context.sessionId);
      if (live.some(j => j.kind === 'video' && j.upstreamJobId)) {
        const result = await host('video-generation/jobs', {});
        for (const job of live.filter(j => j.upstreamJobId)) {
          const remote = result.jobs.find(j => j.id === job.upstreamJobId); if (!remote) continue;
          if (remote.status === 'succeeded' && remote.path) {
            const { asset } = await attach(p.id, remote.path, `${job.title}.mp4`);
            p = await store.update(p.id, undefined, doc => { const n = doc.nodes.find(n => n.id === job.nodeId); if (n) n.assetId = asset.id;
              Object.assign(doc.jobs.find(j => j.id === job.id), { status: 'succeeded', assetId: asset.id }); return doc; });
          } else if (remote.status !== job.status || remote.message !== job.message) p = await mark(p.id, job.id, { status: remote.status, message: remote.message });
        }
      }
      for (const job of live.filter(j => !j.upstreamJobId && !active.has(j.id) && j.status === 'submitting')) {
        p = await mark(p.id, job.id, { status: 'uncertain', message: '生成中断，结果未知；请检查渠道账单/任务，不会自动重新扣费。' });
      }
      return { project: await store.read(p.id) };
    }),
    'arrange': async a => ({ project: await store.update(a.projectId, a.revision, p => { p.tracks = arrangeShots(p); return p; }) }),
    'handoff': async a => store.exclusive(`export-${a.projectId}`, async () => {
      const p = await store.read(a.projectId);
      if (p.revision !== a.revision) throw new Error('项目已更新，请重新载入');
      const compiled = compileNativeVideo(p);
      const digest = createHash('sha256').update(compiled.html).digest('hex');
      const existing = p.exports.find(e => e.digest === digest);
      if (existing && await lstat(await within(store.root, existing.path)).then(s => s.isFile()).catch(() => false)) return { project: p, ...existing, absolutePath: `${store.root}/${existing.path}`, reused: true };
      const videoId = uuid('shortvideo'), path = `video/${videoId}/index.html`;
      for (const file of compiled.assetPaths) {
        if (!p.assets.some(asset => `assets/${asset.file}` === file)) throw new Error('轨道引用了未登记的素材');
        await store.copyMedia(`short-video/${p.id}/${file}`, `video/${videoId}/${file}`);
      }
      await writeFile(await within(store.root, path, true), compiled.html, { flag: 'wx' });
      const receipt = { path, digest, videoId, title: p.title, createdAt: Date.now(), clipCount: compiled.clipCount };
      const project = await store.update(p.id, undefined, doc => { doc.exports.push(receipt); return doc; });
      return { project, ...receipt, absolutePath: `${store.root}/${path}` };
    }),
  }, dispose: async () => { await Promise.allSettled(active.values()); } };
}
