import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/host/config.ts';

test('the signed desktop retains the selected endpoint and required interface without losing optional preferences', () => {
  const result = resolveConfig({
    accountOrigin: 'http://localhost:3400', dedicatedDesktop: false, theme: false, account: false,
    market: false, requestTimeoutMs: 30000, automaticOutputArchive: true,
  }, true);
  assert.equal(result.accountOrigin, 'http://localhost:3400');
  assert.equal(result.dedicatedDesktop, true);
  assert.equal(result.theme, true);
  assert.equal(result.account, true);
  assert.equal(result.market, false);
  assert.equal(result.requestTimeoutMs, 30000);
  assert.equal(result.automaticOutputArchive, true);
});

test('desktop distribution endpoints remain authoritative, including the legacy official hostname', () => {
  for (const accountOrigin of ['https://accounts.example.com', 'https://work.ipollo.net', 'https://cloud.ipollo.net'])
    assert.equal(resolveConfig({ accountOrigin }, true).accountOrigin, accountOrigin);
  assert.throws(() => resolveConfig({ accountOrigin: 'http://remote.example.com' }, true), { code: 'IPW_INVALID_ACCOUNT_ORIGIN' });
});

test('ordinary DSH installations retain their deployment-owned configuration', () => {
  const result = resolveConfig({ accountOrigin: 'http://localhost:3400', theme: false, account: false });
  assert.equal(result.accountOrigin, 'http://localhost:3400');
  assert.equal(result.theme, false);
  assert.equal(result.account, false);
  assert.equal(result.dedicatedDesktop, false);
});
