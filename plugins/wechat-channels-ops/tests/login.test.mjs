import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Operations } from '../business/service/operations.mjs';
import { Store } from '../business/service/store.mjs';

test('a connected WeChat session replaces the pending account with its visible identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipw-channels-login-'));
  const store = new Store(directory);
  try {
    const operations = new Operations({ store, dataDir: directory, workspaceRoot: directory });
    const { account } = await operations.action('connect-account');
    const { browserProfileId } = account;
    const context = { trusted: true, sessionId: 'fixture-session' };
    const observe = (url, tree) => operations.action('observe-browser-session', { url, tree, browserProfileId }, context);
    const identity = 'StaticText "视频号 ID"\nStaticText "："\nStaticText "sph_fixture"\n'
      + 'StaticText "帐号名称："\nStaticText "样例视频号"';
    const homepage = 'https://channels.weixin.qq.com/platform/home/';

    assert.equal((await observe('https://weixin.qq.com/platform/home/', identity)).connected, false);
    assert.equal((await observe('https://channels.weixin.qq.com/login.html', identity)).connected, false);
    assert.equal((await observe(homepage, 'heading "视频号助手"\nStaticText "视频号 ID：sph_fixture"')).connected, false);
    assert.equal(operations.state().accounts[0].status, 'connecting');
    assert.deepEqual(await observe(homepage, identity), { connected: true, accountId: account.id });
    assert.deepEqual(operations.state().accounts.map(item => [item.id, item.browserProfileId, item.name, item.channelId, item.status]), [
      [account.id, browserProfileId, '样例视频号', 'sph_fixture', 'verified'],
    ]);
    assert.equal((await observe(homepage, 'heading "其他账号"\nStaticText "视频号ID：sph_other"')).reason, 'identity_mismatch');
    assert.equal(operations.state().accounts[0].channelId, 'sph_fixture');
    assert.equal((await observe(homepage, 'heading "样例视频号"\nStaticText "视频号ID：sph_fixture"')).connected, true);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
