import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { AccountService } from '../src/host/account.ts';
import { resolveConfig } from '../src/host/config.ts';
import { linkProject } from '../src/host/project-context.ts';
import { mountEnterpriseActivity, type ActivityScope } from '../src/host/enterprise-activity.ts';

for (const mode of ['local', 'legacy', 'cloud']) test(`enterprise activity reports only metadata for ${mode} projects`, {timeout:10000}, async () => {
  const legacy = mode === 'legacy';
  const cloud = mode === 'cloud';
  const origin = legacy ? 'https://cloud.ipollo.net' : 'https://account.test';
  const dir = await mkdtemp(join(tmpdir(), 'ipw-activity-'));
  const sent: unknown[] = [];
  const urls: string[] = [];
  const warnings: string[] = [];
  let reported: () => void = () => {};
  const report = new Promise<void>(resolve => { reported = resolve; });
  const session = {id: 's1', header: cloud ? {} : {cwd: dir}} as unknown as Session;
  type ToolListener = (exec: { name: string; arguments: unknown; callId: string; agent: { session: Session } },
    result: { isError: boolean }) => unknown;
  type SessionListener = (session: Session, event: SessionEvent) => unknown;
  let toolHandler: ToolListener = () => {};
  let sessionHandler: SessionListener = () => {};
  let dispose: () => Promise<void> = async () => {};
  const scope: ActivityScope = {
    on: (event, callback) => {
      if (event === 'tools/result') toolHandler = callback as ToolListener;
      else sessionHandler = callback as SessionListener;
    },
    agents: { get: id => id === session.id ? {session} : undefined },
    effect: (setup: () => () => Promise<void>) => { dispose = setup(); },
    logger: { warn: message => warnings.push(message) },
  };
  const lifetime = new AbortController();
  const tokenEnv = 'IPW_QA_ORG_USAGE_TOKEN';
  const previousToken = process.env[tokenEnv];
  if (cloud) process.env[tokenEnv] = 'private-runtime-fixture';
  const storageReads: string[] = [];
  const account = new AccountService({
    readRecord: async key => {
      storageReads.push(key);
      return {kind: 'grant', payload: {version: 1, origin, token: 'private-fixture'}};
    },
    modifyRecord: async () => {}, deleteRecord: async () => {},
  }, resolveConfig({accountOrigin: origin, ...(cloud ? {cloudRuntimeTokenEnv: tokenEnv} : {})}), lifetime.signal, async (url, init) => {
    urls.push(String(url));
    assert.equal(new Headers(init?.headers).get('Authorization'), cloud ? 'Bearer private-runtime-fixture' : 'Bearer private-fixture');
    sent.push(JSON.parse(String(init?.body)));
    if (sent.length === 3) reported();
    return Response.json({recorded: true});
  });
  try {
    if (!cloud) await linkProject(dir, legacy ? 'https://work.ipollo.net' : origin, 'project');
    mountEnterpriseActivity(scope, account, {origin, queueLimit: 3, signal: lifetime.signal, ...(cloud ? {cloudProjectId: 'project'} : {})});
    const exec = { name: 'skill', arguments: {name: 'research', secret: 'do-not-send'}, callId: 'c1', agent: {session} };
    const manualSkill = {seq: 12, type: 'user/message', data: {
      source: {kind: 'skill-invocation', form: 'instructions', name: 'review'}, content: [{text: 'do-not-send'}],
    }} as unknown as SessionEvent;
    sessionHandler({...session} as Session, manualSkill);
    toolHandler(exec, {isError: false});
    sessionHandler(session, manualSkill);
    toolHandler({...exec, name: 'read', callId: 'c2'}, {isError: true});
    toolHandler({...exec, name: 'queue-overflow', callId: 'c3'}, {isError: false});
    await report;
    await dispose();
    assert.deepEqual(urls, Array(3).fill(origin + '/api/v1/projects/project/activity'));
    assert.deepEqual(sent, [
      {sessionId:'s1', callId:'c1', kind:'skill', name:'research', succeeded:true},
      {sessionId:'s1', callId:'user-skill:12', kind:'skill', name:'review', succeeded:true},
      {sessionId:'s1', callId:'c2', kind:'tool', name:'read', succeeded:false},
    ]);
    assert.deepEqual(warnings, []);
    if (cloud) assert.deepEqual(storageReads, []);
    toolHandler(exec, {isError:false});
    assert.equal(sent.length, 3);
    assert(!JSON.stringify(sent).includes('private'));
  } finally {
    if (cloud) {
      if (previousToken === undefined) delete process.env[tokenEnv];
      else process.env[tokenEnv] = previousToken;
    }
    await rm(dir, {recursive:true, force:true});
  }
});
