import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { createServer } from 'node:http';

/** Isolated native-engine fixtures; no external model or paid generation is used. */
export async function seedResourceLifecycleFixtures(root, connection) {
  if (!root || !isAbsolute(root)) throw new Error('An absolute isolated proof directory is required');
  const projects = join(resolve(root), 'projects');
  const state = JSON.parse(await readFile(join(root, 'electron/ipollowork-server-state.json'), 'utf8'));
  const tokens = connection ?? Object.values(JSON.parse(await readFile(join(root, 'electron/ipollowork-server-tokens.json'), 'utf8')).workspaces)[0];
  const base = connection?.baseUrl ?? `http://127.0.0.1:${Object.values(state.workspacePorts)[0]}`;
  const headers = { Authorization: `Bearer ${tokens.clientToken}`, 'X-iPolloWork-Host-Token': tokens.hostToken, 'Content-Type': 'application/json' };
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers, signal: AbortSignal.timeout(120000), ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${value.message || JSON.stringify(value)}`);
    return value;
  }
  for (const workspace of (await request('/workspaces')).items) {
    if (!resolve(workspace.path || '').startsWith(projects + sep)) continue;
    await request(`/workspaces/${workspace.id}?deleteFiles=true`, 'DELETE');
    if (await access(workspace.path).then(() => true, () => false)) throw new Error('Previous proof project was not deleted');
  }
  const items = [];
  for (const [engineId, label] of [['opencode', 'OpenCode'], ['codex-harness', 'Codex'], ['deepseek-harness', 'DeepSeek']]) {
   for (const projectScope of ['files', 'software']) {
    const name = `${label} ${projectScope} 删除验证`;
    const path = join(projects, `${engineId}-${projectScope}`);
    const { activeId: workspaceId } = await request('/workspaces/local', 'POST', { name, folderPath: path, engineId });
    for (const sessionScope of projectScope === 'files' ? ['software', 'files'] : ['project']) {
    const title = `${label} ${projectScope} ${sessionScope} 会话`;
    const item = { engineId, name, title, path, workspaceId, projectScope, sessionScope };
    const { item: session } = await request(`/workspace/${workspaceId}/sessions`, 'POST', { title, engineId });
    item.sessionId = session.id;
    if (engineId === 'opencode') {
      await request(`/workspace/${workspaceId}/opencode/session/${session.id}/message`, 'POST', {
        noReply: true, parts: [{ type: 'text', text: 'Resource lifecycle verification. No model reply requested.' }],
      });
    } else if (engineId === 'codex-harness') {
      await request(`/workspace/${workspaceId}/engine/codex-harness/rpc`, 'POST', {
        method: 'thread/shellCommand', payload: { threadId: session.id, command: 'echo Lifecycle verification' },
      });
      const { item: binding } = await request(`/workspace/${workspaceId}/sessions/${session.id}/workflow`);
      await request(`/workspace/${workspaceId}/work-items/${binding.id}`, 'PATCH', {
        expectedVersion: binding.version, description: 'Resource lifecycle verification fixture',
      });
    } else {
      // Exercise the real DSH session writer with a loopback-only model fixture.
      // No external model request or paid generation is needed for lifecycle proof.
      let modelRequests = 0;
      const model = createServer((incoming, response) => {
        incoming.resume(); modelRequests++;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta, finish_reason = null) => ({ id: 'lifecycle-proof', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fixture', choices: [{ index: 0, delta, finish_reason }] });
        response.end(`data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Lifecycle verification complete.' }))}\n\ndata: ${JSON.stringify(chunk({}, 'stop'))}\n\ndata: [DONE]\n\n`);
      });
      await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
      try {
        const rpc = (method, payload) => request(`/workspace/${workspaceId}/engine/deepseek-harness/rpc`, 'POST', { method, payload });
        await rpc('settings.mutate', { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'ipollowork-lifecycle-proof'], value: {
          api: 'openai-completions', baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKeyEnv: 'IPOLLOWORK_LIFECYCLE_PROOF_API_KEY',
          models: [{ id: 'fixture', contextWindow: 8192, maxTokens: 1024, input: ['text'] }],
        } }] });
        await rpc('credentials.set', { ref: 'IPOLLOWORK_LIFECYCLE_PROOF_API_KEY', value: 'local-fixture-only' });
        await rpc('session.selectModel', { sessionId: session.id, provider: 'ipollowork-lifecycle-proof', model: 'fixture' });
        await request(`/workspace/${workspaceId}/sessions/${session.id}/prompt`, 'POST', { text: 'Reply with the lifecycle verification result.' });
        let completed = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const { item: current } = await request(`/workspace/${workspaceId}/sessions/${session.id}`);
          if (modelRequests && current.dsh?.blank === false && current.dsh?.running === false) { completed = true; break; }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!completed) throw new Error('Native DSH did not complete its loopback model turn');
        item.nativeSessionProof = 'DSH 0.1.6-alpha.2 with a loopback-only model fixture';
        const runtime = join(root, 'electron/ipollowork-dev-data/xdg/config/ipollowork');
        item.nativeSessionDirectories = [];
        for (const home of [join(runtime, 'deepseek-harness'), join(runtime, 'deepseek-harness-workspaces', workspaceId)]) {
          for (const project of await readdir(join(home, 'sessions'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
            if (!project.isDirectory() || project.isSymbolicLink()) continue;
            const directory = join(home, 'sessions', project.name, session.id);
            if (await access(directory).then(() => true, () => false)) item.nativeSessionDirectories.push(directory);
          }
        }
        if (!item.nativeSessionDirectories.length) throw new Error('DSH did not persist its native session directory');
      } finally { model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); }
    }
    await mkdir(join(path, 'design', session.id), { recursive: true });
    await writeFile(join(path, 'design', session.id, 'index.html'), '<h1>生命周期验证文件</h1>');
    if (engineId === 'codex-harness') {
      const home = join(root, 'electron/ipollowork-dev-data/xdg/config/ipollowork/codex-harness-workspaces', workspaceId);
      item.nativeSessionDirectories = (await findFiles(home)).filter(file => file.includes(session.id) && file.endsWith('.jsonl'));
      if (!item.nativeSessionDirectories.length) throw new Error('Codex did not persist its native rollout');
    }
    items.push(item);
    }
   }
  }
  const fixture = { base, items };
  await writeFile(join(root, 'fixtures.json'), JSON.stringify(fixture, null, 2));
  return fixture;
}

async function findFiles(path) {
  const out = [];
  for (const entry of await readdir(path, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) out.push(...await findFiles(child));
    else out.push(child);
  }
  return out;
}

/** Read-only native history witness, independent of host tombstone filtering. */
export async function nativeHistoryExists(root, item) {
  if (item.engineId !== 'opencode') {
    const states = await Promise.all(item.nativeSessionDirectories.map(path => access(path).then(() => true, () => false)));
    return states.some(Boolean);
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(root, 'electron/ipollowork-dev-data/xdg/data/opencode/opencode.db'), { readOnly: true });
  try { return Boolean(db.prepare('SELECT id FROM session WHERE id = ?').get(item.sessionId)); }
  finally { db.close(); }
}
