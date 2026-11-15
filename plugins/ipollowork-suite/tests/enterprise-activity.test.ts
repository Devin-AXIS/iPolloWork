import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountService } from '../src/host/account.ts';
import { resolveConfig } from '../src/host/config.ts';
import { linkProject } from '../src/host/project-context.ts';
import { mountEnterpriseActivity, type ActivityScope } from '../src/host/enterprise-activity.ts';

test('enterprise activity reports bounded metadata and detaches without leaking arguments or results', {timeout:10000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-activity-'));
  const sent: unknown[] = [];
  let reported: () => void = () => {};
  const report = new Promise<void>(resolve => { reported = resolve; });
  let handler: Parameters<ActivityScope["on"]>[1] = () => {};
  let dispose: () => Promise<void> = async () => {};
  const scope: ActivityScope = {
    on: (_event, callback) => { handler = callback; },
    effect: (setup: () => () => Promise<void>) => { dispose = setup(); },
    logger: { warn: () => {} },
  };
  const account = new AccountService({
    readRecord: async () => ({kind: 'grant', payload: {version: 1, origin: 'https://account.test', token: 'private-fixture'}}),
    modifyRecord: async () => {}, deleteRecord: async () => {},
  }, resolveConfig({accountOrigin: 'https://account.test'}), new AbortController().signal, async (url, init) => {
    if (String(url).endsWith('/get-session')) return Response.json({user:{id:'me',name:'Me',email:'me@example.test'}});
    if (String(url).endsWith('/me/summary')) return Response.json({points:{balance:0}});
    assert.equal(String(url), 'https://account.test/api/v1/projects/project/activity');
    sent.push(JSON.parse(String(init?.body)));
    reported();
    return Response.json({recorded: true});
  });
  try {
    await linkProject(dir, 'https://account.test', 'project');
    mountEnterpriseActivity(scope, account, 'https://account.test', 2);
    const exec = { name: 'skill', arguments: {name: 'research', secret: 'do-not-send'}, callId: 'c1', agent: {session: {id: 's1', header: {cwd: dir}}} };
    handler(exec, {isError: false});
    await report;
    await dispose();
    assert.deepEqual(sent, [{sessionId:'s1', callId:'c1', kind:'skill', name:'research', succeeded:true}]);
    handler(exec, {isError:false});
    assert.equal(sent.length, 1);
    assert(!JSON.stringify(sent).includes('private'));
  } finally { await rm(dir, {recursive:true, force:true}); }
});
