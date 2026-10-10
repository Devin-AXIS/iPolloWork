import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createService from '../src/service.mjs';
import { ProjectStore } from '../src/file-store.mjs';
import { addNode, uuid } from '../src/project.mjs';

async function setup(t, callAction = async () => { throw new Error('No provider in unit test'); }) {
  const root = await mkdtemp(join(tmpdir(), 'short-video-test-')), privateDir = join(root, 'private');
  await mkdir(privateDir); const service = await createService({ workspace: { root }, storage: { dataDir: privateDir }, host: { callAction } });
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); });
  const { project } = await service.actions['project-create']({ title: '测试短片' });
  return { root, service, actions: service.actions, project, store: new ProjectStore(root) };
}

test('project roundtrip, independent projects and service-owned fields', async t => {
  const { actions, project } = await setup(t);
  addNode(project, 'image'); project.assets.push({ id: 'forged' });
  const saved = await actions['project-save']({ project });
  assert.equal(saved.project.revision, 1); assert.equal(saved.project.assets.length, 0);
  assert.equal((await actions['project-read']({ projectId: project.id })).project.nodes.length, 1);
  const other = await actions['project-create']({ title: '另一个项目' });
  assert.equal(other.project.nodes.length, 0);
  assert.equal((await actions['project-list']()).projects.length, 2);
});
test('concurrent stale edits cannot silently overwrite', async t => {
  const { actions, project } = await setup(t);
  const results = await Promise.allSettled([actions['project-save']({ project: { ...project, title: '甲' } }), actions['project-save']({ project: { ...project, title: '乙' } })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /更新/);
});
test('asset import rejects traversal and symlinks; metadata cannot inject paths', async t => {
  const { root, actions, project } = await setup(t);
  await writeFile(join(root, 'source.png'), Buffer.from('test bytes, not decode test'));
  const outside = await mkdtemp(join(tmpdir(), 'short-video-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'hosts'), 'external fixture');
  await symlink(outside, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const path of ['../source.png', 'outside/hosts', '/etc/hosts', 'https://site/a.png']) {
    await assert.rejects(actions['asset-import']({ projectId: project.id, path }));
  }
  const result = await actions['asset-import']({ projectId: project.id, path: 'source.png', metadata: { id: 'hijack', file: '../../secret', kind: 'audio' } });
  assert.notEqual(result.asset.id, 'hijack'); assert.match(result.asset.file, /^a_.*\.png$/); assert.equal(result.asset.kind, 'image');
});
test('chunk uploads enforce order and isolated project ownership', async t => {
  const { actions, project } = await setup(t);
  const args = { projectId: project.id, uploadId: uuid('u'), filename: 'fixture.png', total: 6, offset: 0, data: Buffer.from('abc').toString('base64') };
  assert.equal((await actions['asset-upload'](args)).nextOffset, 3);
  await assert.rejects(actions['asset-upload'](args), /上传位置/);
  const complete = await actions['asset-upload']({ ...args, offset: 3, data: Buffer.from('def').toString('base64') });
  assert.equal(complete.project.assets.length, 1);
  const bytes = await actions['asset-read']({ projectId: project.id, assetId: complete.asset.id });
  assert.equal(Buffer.from(bytes.data, 'base64').toString(), 'abcdef');
  assert.equal(bytes.nextOffset, 6);
});
test('media handoff freezes assets, separates sound, captions and preserves native edits', async t => {
  const { root, actions, project } = await setup(t);
  await writeFile(join(root, 'source.mp4'), 'fixture bytes: no decode claim');
  let { asset, project: p } = await actions['asset-import']({ projectId: project.id, path: 'source.mp4', metadata: { durationSeconds: 8, hasAudio: true } });
  p.shots.push({ id: 's_one', title: '开场', prompt: '', narration: '独立字幕', duration: 4, assetId: asset.id });
  ({ project: p } = await actions['project-save']({ project: p }));
  ({ project: p } = await actions.arrange({ projectId: p.id, revision: p.revision }));
  assert.deepEqual(p.tracks.map(t => t.kind), ['video', 'audio', 'caption']);
  const result = await actions.handoff({ projectId: p.id, revision: p.revision });
  const html = await readFile(join(root, result.path), 'utf8');
  assert.match(html, /<audio/); assert.match(html, /独立字幕/);
  await writeFile(join(root, result.path), html + '<!-- native user edit -->');
  const again = await actions.handoff({ projectId: p.id, revision: result.project.revision });
  assert.equal(again.reused, true); assert.equal(again.path, result.path);
  assert.match(await readFile(join(root, result.path), 'utf8'), /native user edit/);
  const files = await readdir(join(root, 'video', result.videoId, 'assets')); assert.equal(files.length, 1);
  const current = again.project; current.title = '新的版本';
  const saved = await actions['project-save']({ project: current });
  const next = await actions.handoff({ projectId: current.id, revision: saved.project.revision });
  assert.notEqual(next.path, result.path);
});
test('generation is deduplicated and ambiguous failures never auto-resubmit', async t => {
  let calls = 0;
  const { actions, project, service } = await setup(t, async () => { calls++; throw new Error('network lost'); });
  const node = addNode(project, 'image'); node.prompt = 'test';
  let p = (await actions['project-save']({ project })).project;
  const requestId = crypto.randomUUID();
  const first = await actions.generate({ projectId: p.id, revision: p.revision, nodeId: node.id, requestId }, { sessionId: 's_test' });
  await service.dispose();
  p = (await actions['project-read']({ projectId: p.id })).project;
  assert.equal(p.jobs[0].status, 'uncertain');
  await actions.generate({ projectId: p.id, revision: p.revision, nodeId: node.id, requestId }, { sessionId: 's_test' });
  assert.equal(calls, 1);
  p = (await actions['project-read']({ projectId: p.id })).project;
  await assert.rejects(actions.generate({ projectId: p.id, revision: p.revision, nodeId: node.id, requestId: crypto.randomUUID() }, { sessionId: 's_test' }), /已有任务/);
});
test('image adapter forwards only host-supported fields and records successful output', async t => {
  const calls=[];
  const { root, actions, project, service } = await setup(t, async (name,args)=>{ calls.push({name,args}); if(name==='openai-image-generation/image_generate')return {ok:true,result:{path:'generated.png'}};throw new Error('unexpected') });
  await writeFile(join(root,'generated.png'),'image fixture');
  const node=addNode(project,'image');node.prompt='山间晨光';node.settings={model:'openai/gpt-image-2',size:'auto',quality:'auto',unknown:'must not forward'};
  const saved=await actions['project-save']({project});
  await actions.generate({projectId:project.id,revision:saved.project.revision,nodeId:node.id,requestId:crypto.randomUUID()},{sessionId:'test'});
  await service.dispose();
  assert.equal(calls[0].name,'openai-image-generation/image_generate');assert.equal(calls[0].args.unknown,undefined);
  const p=(await actions['project-read']({projectId:project.id})).project;
  assert.equal(p.jobs[0].status,'succeeded');assert.equal(p.nodes[0].assetId,p.assets[0].id);
});
test('audio synthesis keeps measured duration and a separate asset', async t=>{
  let captured;
  const {root,actions,project,service}=await setup(t,async(name,args)=>{captured={name,args};return {ok:true,result:{output:{sourcePath:'speech.mp3',durationSeconds:2.4}}}});
  await writeFile(join(root,'speech.mp3'),'unit test audio fixture');
  const node=addNode(project,'audio');node.prompt='您好';node.settings={voice:'example-voice'};
  const saved=await actions['project-save']({project});
  await actions.generate({projectId:project.id,revision:saved.project.revision,nodeId:node.id,requestId:crypto.randomUUID()},{sessionId:'test'});await service.dispose();
  const p=(await actions['project-read']({projectId:project.id})).project;
  assert.equal(captured.name,'media/speech_synthesize_workspace_file');assert.equal(captured.args.sceneText,'您好');assert.equal(p.assets[0].durationSeconds,2.4);assert.equal(p.assets[0].kind,'audio');
});
