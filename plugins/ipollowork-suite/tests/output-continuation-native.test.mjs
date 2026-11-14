/** Real DSH driver coverage for the suite's automatic response continuation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const owner = process.env.IPOLLO_QA_URL;
test('native DSH records continuation and finishes the next response without human input', { skip: !owner, timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ipw-output-'));
  try {
    const login = await fetch(owner, { redirect: 'manual' });
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const call = async (path, body) => {
      const response = await fetch(new URL(path, owner), { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value)); return value;
    };
    const project = await call('/ipollo-fixture/project', { path: root, title: 'Output continuation QA' });
    const result = await call('/ipollo-fixture/run', { projectId: project.id, agentPreset: 'standard', prompt: 'TRUNCATE_ONCE' });
    assert.equal(result.continuations, 1);
    const turns = result.requests.filter(request => request.tools.length > 0);
    assert.equal(turns.length, 2);
    assert.match(JSON.stringify(turns[1].messages), /Saved partial work/);
    assert.match(JSON.stringify(turns[1].messages), /Continue the current task/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
