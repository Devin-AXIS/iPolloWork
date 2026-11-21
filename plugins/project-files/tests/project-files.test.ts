import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { changeFile, copyAttachment, emptyState, followMoves, fromRecordedPath, listFolder,
  visibleTrash, type FileState } from '../src/files.ts';
import { evidenceFor } from '../src/evidence.ts';

test('uses native attachment, reference, successful write, and delivery records', () => {
  const id = 'sha256:' + 'a'.repeat(64);
  const result = evidenceFor('session-a', [
    { type: 'user/message', time: 1, data: { source: { kind: 'user' }, content: [
      { type: 'file', attachment: { attachmentId: id, name: 'Brief.pdf', bytes: 10 } },
      { type: 'image', attachment: { attachmentId: id, bytes: 10, mediaType: 'image/png', width: 10, height: 10 } },
      { type: 'text', text: '请看 @"design assets/logo.svg" 和 @readme.md。' },
    ] } },
    { type: 'tool/call', time: 2, data: { callId: 'one', name: 'write', arguments: '{"file_path":"draft.html","content":"Hi"}' } },
    { type: 'tool/result', time: 3, data: { message: { source: { callId: 'one' } }, meta: { path: '/demo/draft.html' } } },
    { type: 'tool/call', time: 4, data: { callId: 'two', name: 'write', arguments: '{"file_path":"failed.html","content":"Hi"}' } },
    { type: 'tool/result', time: 5, data: { message: { source: { callId: 'two' }, isError: true } } },
    { type: 'deliverables/presented', time: 6, data: { files: [{ path: 'website/index.html', description: '  品牌站\n正式版  ' }] } },
    { type: 'workspace/changes', time: 7, seq: 19, data: { turn: 1 } },
  ], seq => seq === 19 ? [{ path: 'shell-created.png' }] : []);
  assert.equal(result.inputs[0]?.id, id);
  assert.equal(result.inputs[1]?.name, 'aaaaaaaa.png');
  assert.deepEqual(result.references.map(entry => entry.path), ['design assets/logo.svg', 'readme.md']);
  assert.equal(result.outputs.find(entry => entry.source === 'presented')?.title, '品牌站 正式版');
  assert.deepEqual(result.outputs.map(({ path, source }) => [path, source]),
    [['/demo/draft.html', 'written'], ['website/index.html', 'presented'], ['shell-created.png', 'written']]);
});

test('copies trees, moves recorded outputs, and recovers data from project trash without overwriting a newer file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-files-'));
  try {
    const root = await realpath(directory);
    let state: FileState = emptyState;
    const update: Parameters<typeof changeFile>[3] = async next => { state = next; };
    await changeFile(root, { kind: 'mkdir', folder: '', name: 'assets' }, state, update);
    await changeFile(root, { kind: 'mkdir', folder: '', name: 'publish' }, state, update);
    await writeFile(join(root, 'assets', 'logo.bin'), Buffer.from([0, 72, 255]));
    assert.equal(await changeFile(root, { kind: 'copy', path: 'assets', folder: 'publish' }, state, update), 'publish/assets');
    assert.deepEqual(await readFile(join(root, 'publish', 'assets', 'logo.bin')), Buffer.from([0, 72, 255]));
    await changeFile(root, { kind: 'rename', path: 'assets', name: 'graphics' }, state, update);
    assert.equal(followMoves('assets/logo.bin', 0, state.moves), 'graphics/logo.bin');
    await assert.rejects(changeFile(root, { kind: 'move', path: 'publish', folder: 'publish/assets' }, state, update), /same-folder/);
    await changeFile(root, { kind: 'trash', path: 'graphics/logo.bin' }, state, update);
    const [item] = await visibleTrash(root, state.trash);
    assert(item);
    await writeFile(join(root, 'graphics', 'logo.bin'), 'replacement');
    await assert.rejects(changeFile(root, { kind: 'restore', id: item.id }, state, update), /name-exists/);
    assert.equal(await readFile(join(root, 'graphics', 'logo.bin'), 'utf8'), 'replacement');
    await changeFile(root, { kind: 'rename', path: 'graphics/logo.bin', name: 'replacement.bin' }, state, update);
    await changeFile(root, { kind: 'restore', id: item.id }, state, update);
    assert.deepEqual(await readFile(join(root, 'graphics', 'logo.bin')), Buffer.from([0, 72, 255]));
    assert.deepEqual(await visibleTrash(root, state.trash), []);
    assert.equal(followMoves('assets/logo.bin', 0, state.moves), 'graphics/logo.bin');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rejects project escapes and does not follow symbolic links during browsing or mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-files-scope-'));
  try {
    const root = await realpath(directory);
    await mkdir(join(root, 'project'));
    await mkdir(join(root, 'other'));
    const project = join(root, 'project');
    await writeFile(join(root, 'other', 'secret.txt'), 'outside');
    await symlink(join(root, 'other'), join(project, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(fromRecordedPath(project, '../other/secret.txt'), undefined);
    assert.deepEqual((await listFolder(project, '')).entries, []);
    await assert.rejects(listFolder(project, 'alias'), /outside-project/);
    await assert.rejects(changeFile(project, { kind: 'trash', path: 'alias/secret.txt' }, emptyState, async () => {}), /outside-project/);
    assert.equal(await readFile(join(root, 'other', 'secret.txt'), 'utf8'), 'outside');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('copies attachment bytes into a folder and cleans up after an interrupted stream', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-attachment-'));
  try {
    const root = await realpath(directory);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'Brief.pdf'), 'original');
    const bytes = Buffer.from([0, 72, 255]);
    async function* read() { yield bytes; }
    const copied = await copyAttachment(root, 'assets', 'Brief.pdf', read(), new AbortController().signal);
    assert.notEqual(copied, 'assets/Brief.pdf');
    assert.deepEqual(await readFile(join(root, copied)), bytes);
    assert.equal(await readFile(join(root, 'assets', 'Brief.pdf'), 'utf8'), 'original');
    async function* interrupted() { yield bytes; throw new Error('interrupted'); }
    await assert.rejects(copyAttachment(root, 'assets', 'Missing.pdf', interrupted(), new AbortController().signal), /interrupted/);
    assert.deepEqual((await listFolder(root, 'assets')).entries.map(entry => entry.path).sort(), [copied, 'assets/Brief.pdf'].sort());
  } finally { await rm(directory, { recursive: true, force: true }); }
});
