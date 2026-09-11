import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, CAPABILITY_SCOPES, DouyinApi } from '../service/api.mjs';

const auth = { accessToken: 'act.private-token', openId: 'open+id/=' };
const tokenData = { access_token: 'act.fresh', open_id: auth.openId, refresh_token: 'rft.next', expires_in: 1296000, scope: 'user_info' };
const success = data => Response.json({ data: { error_code: 0, ...data }, extra: { error_code: 0 } });

function mocked(respond) {
  const calls = [];
  const api = new DouyinApi({ fetchImpl: async (url, init) => {
    calls.push({ url: new URL(url), ...init });
    return respond(calls.at(-1));
  } });
  return { api, calls };
}

test('OAuth exchange/refresh are form bodies; user info is JSON; credentials never enter URLs', async () => {
  const { api, calls } = mocked(() => success(tokenData));
  await api.exchangeCode({ clientKey: 'key', clientSecret: 'secret+/=', code: 'code+/=' });
  await api.refreshToken({ clientKey: 'key', refreshToken: 'rft.private+/=' });
  await api.userInfo(auth);
  assert.equal(calls[0].url.pathname, '/oauth/access_token/');
  assert.equal(calls[0].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(calls[0].body).get('client_secret'), 'secret+/=');
  assert.equal(new URLSearchParams(calls[0].body).get('code'), 'code+/=');
  assert.equal(new URLSearchParams(calls[0].body).get('grant_type'), 'authorization_code');
  assert.equal(calls[1].url.pathname, '/oauth/refresh_token/');
  assert.equal(new URLSearchParams(calls[1].body).get('grant_type'), 'refresh_token');
  assert.equal(new URLSearchParams(calls[1].body).get('refresh_token'), 'rft.private+/=');
  assert.equal(calls[2].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[2].body), { access_token: auth.accessToken, open_id: auth.openId });
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://open.douyin.com');
    assert.equal(call.url.search, '');
    assert.equal(call.redirect, 'error');
  }
});

test('legacy list/data/comment contracts keep opaque IDs encoded and use matching scopes', async () => {
  const { api, calls } = mocked(() => success({ list: [], cursor: 0, has_more: false, comment_id: 'reply' }));
  const itemId = '@id+/=&injected=oops';
  await api.listVideos({ ...auth, cursor: '9007199254740993' });
  await api.videoData({ ...auth, itemIds: [itemId] });
  await api.listComments({ ...auth, itemId });
  await api.replyComment({ ...auth, itemId, commentId: '@comment+/=', content: '谢谢观看' });
  assert.deepEqual(calls.map(call => call.url.pathname), ['/video/list/', '/video/data/', '/item/comment/list/', '/item/comment/reply/']);
  assert.equal(calls[0].url.searchParams.get('cursor'), '9007199254740993');
  assert.equal(calls[2].url.searchParams.get('item_id'), itemId);
  assert.equal(calls[2].url.searchParams.has('injected'), false);
  assert.deepEqual(JSON.parse(calls[1].body), { item_ids: [itemId] });
  assert.deepEqual(JSON.parse(calls[3].body), { item_id: itemId, comment_id: '@comment+/=', content: '谢谢观看' });
  for (const call of calls) {
    assert.equal(call.headers['access-token'], auth.accessToken);
    assert.equal(call.url.searchParams.get('open_id'), auth.openId);
    assert.equal(call.url.searchParams.has('access_token'), false);
  }
  assert.deepEqual(CAPABILITY_SCOPES.listVideos, ['video.list']);
  assert.deepEqual(CAPABILITY_SCOPES.videoData, ['video.data']);
  assert.deepEqual(CAPABILITY_SCOPES.replyComment, ['item.comment']);
  assert.deepEqual(CAPABILITY_SCOPES.publish, ['video.create.bind']);
});

test('official search uses a client credential and preserves its nested page contract', async () => {
  const expected = { cursor: 10, has_more: true, video_list: [{ item_id: '7471252140422401337', title: '示例', link: 'https://www.douyin.com/video/7471252140422401337' }], search_id: 'search-page-id' };
  const { api, calls } = mocked(call => call.url.pathname === '/oauth/client_token/'
    ? success({ access_token: 'clt.app-token', expires_in: 7200 })
    : Response.json({ err_no: 0, data: { data: expected } }));
  const credentials = await api.clientToken({ clientKey: 'key', clientSecret: 'secret' });
  assert.deepEqual(JSON.parse(calls[0].body), { client_key: 'key', client_secret: 'secret', grant_type: 'client_credential' });
  const result = await api.searchVideos({ clientToken: credentials.access_token, keyword: '抖音 & 视频', deviceId: '8241677744935186821', cursor: 10, searchId: 'search-page-id' });
  assert.deepEqual(result, expected);
  assert.equal(calls[1].url.pathname, '/dy_open_api/v1/search/video/');
  assert.equal(calls[1].headers['access-token'], 'clt.app-token');
  assert.equal(calls[1].url.searchParams.get('keyword'), '抖音 & 视频');
  assert.equal(calls[1].url.searchParams.get('device_id'), '8241677744935186821');
  assert.equal(calls[1].url.searchParams.get('search_id'), 'search-page-id');
  assert.deepEqual(CAPABILITY_SCOPES.searchVideos, ['aweme.dy.video_search']);
});

test('response Int64 cursors and IDs remain exact decimal strings', async () => {
  const { api } = mocked(() => new Response('{"data":{"error_code":0,"cursor":9007199254740993,"list":[{"video_id":7471252140422401337}]}}'));
  const result = await api.listVideos(auth);
  assert.equal(result.cursor, '9007199254740993');
  assert.equal(result.list[0].video_id, '7471252140422401337');
});

test('pagination and batch limits reject unsafe or oversized requests before fetch', async () => {
  const { api, calls } = mocked(() => success({ list: [] }));
  for (const input of [{ count: 21 }, { count: 0 }, { cursor: -1 }, { cursor: 1.1 }, { cursor: 9007199254740992 }, { cursor: '9223372036854775808' }]) {
    assert.throws(() => api.listVideos({ ...auth, ...input }), { code: 'INVALID_ARGUMENT' });
  }
  assert.throws(() => api.videoData({ ...auth, itemIds: Array(21).fill('id') }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => api.searchVideos({ clientToken: 'clt.token', keyword: '视频', deviceId: '123', cursor: 20 }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => api.searchVideos({ clientToken: 'clt.token', keyword: '视频', deviceId: 8241677744935186821 }), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls.length, 0);
});

test('HTTP 200 API failures are checked at all supported envelope locations without secret echo', async () => {
  for (const envelope of [
    { data: { error_code: 28001018, description: 'act.private-token secret code' } },
    { data: { error_code: 0, list: [] }, extra: { error_code: 28001018, description: 'act.private-token' } },
    { err_no: 28001018, err_msg: 'act.private-token', data: { error_code: 0, list: [] } },
  ]) {
    const { api, calls } = mocked(() => Response.json(envelope));
    await assert.rejects(api.listVideos(auth), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 28001018);
      assert.equal(error.uncertain, false);
      assert.match(error.message, /权限/);
      assert.doesNotMatch(error.message, /private-token|secret/);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test('a successful mutation needs its result ID, and unknown results are never retried', async () => {
  for (const response of [success({}), new Response('invalid-json'), new Response('secret', { status: 503 }), Response.json({ data: { error_code: 'act.private-token' } })]) {
    const { api, calls } = mocked(() => response);
    await assert.rejects(api.createVideo({ ...auth, videoId: '@uploaded', text: '标题' }), error => {
      assert.equal(error.uncertain, true);
      assert.doesNotMatch(error.message, /private-token|secret/);
      return true;
    });
    assert.equal(calls.length, 1);
  }
  const { api } = mocked(() => success({ item_id: '@published' }));
  assert.equal((await api.createVideo({ ...auth, videoId: '@uploaded', text: '标题' })).item_id, '@published');
});

test('timeout covers fetch and body consumption; writes are uncertain and reads are not', async () => {
  let requests = 0;
  const api = new DouyinApi({ timeoutMs: 10, fetchImpl: async () => {
    requests++;
    return new Response(new ReadableStream({ start() {} }));
  } });
  await assert.rejects(api.replyComment({ ...auth, itemId: 'item', commentId: 'comment', content: '回复' }), { code: 'TIMEOUT', uncertain: true });
  await assert.rejects(api.listVideos(auth), { code: 'TIMEOUT', uncertain: false });
  assert.equal(requests, 2);
});

test('bounded responses reject oversized Content-Length and streamed bodies', async () => {
  for (const response of [
    new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  ]) {
    const { api } = mocked(() => response);
    await assert.rejects(api.listVideos(auth), { code: 'RESPONSE_TOO_LARGE', uncertain: false });
  }
});

test('upload streams an MP4 Blob with automatic multipart boundary and validates local files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'douyin-api-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'clip.mp4');
  const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432000000086d646174', 'hex');
  await writeFile(filePath, mp4);
  const { api, calls } = mocked(async call => {
    assert.ok(call.body instanceof FormData);
    const file = call.body.get('video');
    assert.equal(file.name, 'video.mp4');
    assert.equal(file.type, 'video/mp4');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), mp4);
    assert.equal(call.headers['content-type'], undefined);
    return success({ video: { video_id: '@uploaded+/=' } });
  });
  const result = await api.uploadVideo({ ...auth, filePath });
  assert.equal(result.video.video_id, '@uploaded+/=');
  assert.equal(calls[0].url.pathname, '/api/douyin/v1/video/upload_video/');
  assert.equal(calls[0].url.searchParams.get('open_id'), auth.openId);
  await writeFile(filePath, 'This is not an MP4 file.');
  await assert.rejects(api.uploadVideo({ ...auth, filePath }), { code: 'INVALID_ARGUMENT' });
  const stillImage = Buffer.from(mp4);
  stillImage.write('avif', 8, 'ascii');
  await writeFile(filePath, stillImage);
  await assert.rejects(api.uploadVideo({ ...auth, filePath }), { code: 'INVALID_ARGUMENT' });
  const handle = await open(filePath, 'w');
  try { await handle.truncate(128 * 1024 * 1024 + 1); } finally { await handle.close(); }
  await assert.rejects(api.uploadVideo({ ...auth, filePath }), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls.length, 1);
});
