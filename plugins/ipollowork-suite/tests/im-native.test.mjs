import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('a scanned coordinator returns fixed and temporary worker results to the original IM request', { skip: !process.env.IPOLLO_IM_QA_URL, timeout: 90000 }, async () => {
  const url = new URL(process.env.IPOLLO_IM_QA_URL);
  const login = await fetch(url, { redirect: 'manual' });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const api = async (path, input) => {
    const response = await fetch(url.origin + path, { method: input ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const catalog = await api('/ipollowork-suite/agents/catalog');
  for (const agent of catalog.agents.filter(agent => agent.enabled)) await api('/ipollowork-suite/agents/agents', { ...agent, enabled: false, skillNames: agent.skills.map(skill => skill.name) });
  const automatic = await api('/ipollo-im-replay', { mode: 'coordinator' });
  assert.equal(automatic.answer, 'COORDINATOR_COMBINED_RESULT');
  assert.ok(automatic.requests.some(request => JSON.stringify(request.messages).includes('TEMP_WORK_TASK') && !request.tools.includes('ipollo_dispatch')));
  await api('/ipollowork-suite/agents/agents', { name: 'Saved researcher', description: 'Research specialist', prompt: 'SAVED_SPECIALIST_INSTRUCTIONS', serviceNames: [], skillNames: [], model: { provider: 'ipollo-im-fixture', model: 'text' } });
  const fixed = await api('/ipollo-im-replay', { mode: 'coordinator' });
  const summary = {
    mainPreset: fixed.preset,
    finalAnswer: fixed.answer,
    temporaryWorksWithoutSavedExperts: automatic.answer === 'COORDINATOR_COMBINED_RESULT',
    separateGroupSessions: fixed.separateGroupSessions,
    savedSpecialistModel: fixed.requests.some(request => request.model === 'text' && JSON.stringify(request.messages).includes('SAVED_SPECIALIST_INSTRUCTIONS')),
    temporaryInheritsModel: fixed.requests.some(request => request.model === 'vision' && JSON.stringify(request.messages).includes('TEMP_WORK_TASK') && !request.tools.includes('ipollo_dispatch')),
    savedAndTemporaryCollected: fixed.requests.some(request => request.tools.includes('ipollo_dispatch') && JSON.stringify(request.messages).includes('SAVED_DONE') && JSON.stringify(request.messages).includes('TEMP_DONE')),
    savedCatalogSize: (await api('/ipollowork-suite/agents/catalog')).agents.filter(agent => agent.enabled).length,
  };
  assert.deepEqual(summary, JSON.parse(await readFile(new URL('./coordinator-native.expected.json', import.meta.url))));
  console.log(JSON.stringify(summary));
});

test('native menu actions create DSH sessions and read the native model catalog without an LLM turn', { skip: !process.env.IPOLLO_IM_QA_URL, timeout: 30000 }, async () => {
  const url = new URL(process.env.IPOLLO_IM_QA_URL);
  const login = await fetch(url, { redirect: 'manual' });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const response = await fetch(url.origin + '/ipollo-im-replay', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'menus' }) });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.deepEqual(value, { createdNativeSession: true, sameWorkspace: true, replayIgnored: true, modelMenuUsesNativeCatalog: true, noModelRequest: true });
});

test('native DSH replay retains IM media and logs the same content sent to the model', { skip: !process.env.IPOLLO_IM_QA_URL, timeout: 90000 }, async () => {
  const url = new URL(process.env.IPOLLO_IM_QA_URL);
  const login = await fetch(url, { redirect: 'manual' });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const summary = {};
  for (const scenario of [
    { name: 'imageVision', channel: 'wecom' },
    { name: 'imageTextFallback', channel: 'wecom', textOnly: true },
    { name: 'dingTalkSpeech', channel: 'dingtalk', speech: true },
    { name: 'dingTalkRecognition', channel: 'dingtalk', recognition: true, speech: true },
    { name: 'feishuSpeech', channel: 'feishu', speech: true },
    { name: 'feishuUnconfigured', channel: 'feishu' },
    { name: 'wecomApplicationSpeech', channel: 'wecom-app', speech: true },
    { name: 'wecomPlatformSpeech', channel: 'wecom-voice' },
  ]) {
    const response = await fetch(url.origin + '/ipollo-im-replay', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(scenario), signal: AbortSignal.timeout(25000) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.ok(result.requests.length > 0, scenario.name);
    const model = JSON.stringify(result.requests);
    const logged = JSON.stringify(result.events);
    const content = result.events.flatMap(event => event.data.message?.content ?? event.data.content ?? []);
    summary[scenario.name] = {
      answered: JSON.stringify(result.answer).includes('IM_MEDIA_VERIFIED'),
      images: content.filter(part => part.type === 'image').length,
      files: content.filter(part => part.type === 'file').length,
      nativeTranscript: model.includes('NATIVE_TRANSCRIPT') && logged.includes('NATIVE_TRANSCRIPT'),
      platformTranscript: model.includes('PLATFORM_TRANSCRIPT') || model.includes('WECOM_TRANSCRIPT'),
      unavailable: content.some(part => part.type === 'text' && part.text.includes('"status":"unavailable"')),
      speechCalls: result.speechCalls,
    };
  }
  console.log(JSON.stringify(summary, null, 2));
  const expected = JSON.parse(await readFile(new URL('./im-native.expected.json', import.meta.url)));
  assert.deepEqual(summary, expected);
});
